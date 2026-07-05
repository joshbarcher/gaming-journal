import { useQuery, useQueryClient } from '@tanstack/react-query'
import { router, useIsFocused, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { getGameDetail } from '@/api/gamePage'
import { getGuideSearchData } from '@/api/guides'
import { getLocalReview } from '@/api/localReview'
import {
    getDownloadedGuides, getGameAchievements, getGameSessions, getJournalNotes, getJournalPages,
} from '@/api/journal'
import { getNowPlaying } from '@/api/sidebar'
import { subscribeTrackerSuggestJobs } from '@/api/trackerSuggest'
import { AchievementCard } from '@/components/journal/AchievementCard'
import { GuidesCard } from '@/components/journal/GuidesCard'
import { HltbCard } from '@/components/journal/HltbCard'
import { JournalPagesCard } from '@/components/journal/JournalPagesCard'
import { LastSessionCard } from '@/components/journal/LastSessionCard'
import { NotesCard } from '@/components/journal/NotesCard'
import { ProgressTrackersCard } from '@/components/journal/ProgressTrackersCard'
import { RatingCard } from '@/components/journal/RatingCard'
import { SessionHistoryRail } from '@/components/journal/SessionHistoryRail'
import { useApiHost } from '@/hooks/useApiHost'
import { useTrackerSuggestJobsStore } from '@/store/trackerSuggestJobsStore'
import { colors, fonts, spacing } from '@/theme/tokens'
import { TRACKER_TYPES } from '@/utils/journalRender'

// Port of journal/overview.md's JournalDashboard.svelte. Read the actual source directly (not just
// the doc's card-position summary) for exact derived-value logic — closedSessions' >=10min filter,
// LastSessionCard's deliberately-unfiltered "most recent session regardless of length", the sqrt-
// scale HLTB math, etc.
//
// Layout: game-journal.css's own comment says it plainly — "≤1280px: collapse to single column,
// let cards stack in DOM order" — since ALL 3 of this app's required breakpoints are ≤1279px, this
// means the complex 3-column CSS grid (with the guides panel pinned to col 3/rows 2-4 and HLTB
// spanning cols 1-2) is NEVER seen at any required tier. Built directly as a single-column
// vertical stack in the same DOM order as the web source, no per-tier variation needed.
//
// Deliberately NOT built here (separate TODO items / different phases): the full Guides
// viewer/search flow (Phase 3), the Progress tracker detail screen and Notes sticky-wall corkboard
// (their own later TODO items — this dashboard only shows preview cards linking to those routes).
//
// journal/sessions.md's polling model (see the "Sessions & Now Playing detail" TODO item), ported
// as TanStack Query refetchIntervals + one manual effect for the schema-retry poller, gated by
// useIsFocused() so polling stops when navigating away and resumes on remount — matching the web's
// own onMount/onDestroy poller lifecycle, explicitly called out in the TODO item's own wording
// ("focus-scoped polling via useFocusEffect").
// **Doc-vs-reality correction**: sessions.md claims "During an active session, [LastSessionCard]
// is replaced by the 'Now Playing' live view showing elapsed time and achievementsDuring" — reading
// JournalDashboard.svelte's actual template shows this is NOT true: `activeSession` is used only
// to drive the HLTB pin's live-tick playtime and to decide whether to start the fast poller: it
// is NEVER passed to LastSessionCard, and no separate "Now Playing" card exists anywhere in the
// real template. No such card was built here either — porting the doc's claim would have added a
// UI element the real app doesn't have.
//
// Moved from journal/[appid].tsx to journal/[appid]/index.tsx (Notes/Pages item) so
// journal/[appid]/pages.tsx can exist as a sibling route — expo-router can't have both a
// [appid].tsx file and a [appid]/ directory for the same dynamic segment.
export default function JournalDashboardScreen() {
    const { appid: appidStr } = useLocalSearchParams<{ appid: string }>()
    const appid = Number(appidStr)
    const apiHostQuery = useApiHost()
    const apiHost = apiHostQuery.data
    const isFocused = useIsFocused()
    const queryClient = useQueryClient()

    const gameQuery = useQuery({
        queryKey: ['gameDetail', appid], queryFn: () => getGameDetail(appid),
        refetchInterval: isFocused ? 5 * 60_000 : false, // slow poller: refresh game data every 5min
    })
    const reviewQuery = useQuery({ queryKey: ['localReview', appid], queryFn: () => getLocalReview(appid) })
    const pagesQuery = useQuery({ queryKey: ['journalPages', appid], queryFn: () => getJournalPages(appid) })
    const notesQuery = useQuery({ queryKey: ['journalNotes', appid], queryFn: () => getJournalNotes(appid) })
    const achQuery = useQuery({
        queryKey: ['gameAchievements', appid], queryFn: () => getGameAchievements(appid),
        refetchInterval: isFocused ? 5 * 60_000 : false, // slow poller: refresh achievements every 5min
    })
    const sessionsQuery = useQuery({ queryKey: ['gameSessions', appid], queryFn: () => getGameSessions(appid) })
    const guidesQuery = useQuery({ queryKey: ['downloadedGuides', appid], queryFn: () => getDownloadedGuides(appid) })
    const guideSearchQuery = useQuery({ queryKey: ['guideSearchData', appid], queryFn: () => getGuideSearchData(appid) })
    const nowPlayingQuery = useQuery({
        queryKey: ['nowPlaying'], queryFn: getNowPlaying,
        refetchInterval: isFocused ? 60_000 : false, // fast poller: only meaningful while an active session exists, but cheap enough to always run while focused
    })

    const activeSession = nowPlayingQuery.data?.playing?.appid === appid ? nowPlayingQuery.data.playing : null

    // effectivePlaytimeMin = basePlaytimeMin + sessionElapsedMin — the dashboard's documented fix
    // for stale Steam playtime during an active session (Steam only updates playtime when a
    // session ends). Same 30s-tick pattern as HltbSection (Game detail screen).
    const [sessionElapsedMin, setSessionElapsedMin] = useState(0)
    useEffect(() => {
        if (!activeSession?.sessionStartedAt) return
        const startedAt = new Date(activeSession.sessionStartedAt).getTime()
        const tick = () => setSessionElapsedMin(Math.floor((Date.now() - startedAt) / 60_000))
        tick()
        const interval = setInterval(tick, 30_000)
        return () => clearInterval(interval)
    }, [activeSession?.sessionStartedAt])

    // Fast poller's "session ended" branch: web calls loadData() to reload everything and restart
    // pollers when activeSession transitions from set to null. TanStack Query's refetchInterval
    // already keeps nowPlayingQuery fresh; this just reacts to that transition by invalidating the
    // queries a finished session would have changed (sessions list + achievements + playtime).
    const wasActiveRef = useRef(false)
    useEffect(() => {
        if (wasActiveRef.current && !activeSession) {
            queryClient.invalidateQueries({ queryKey: ['gameSessions', appid] })
            queryClient.invalidateQueries({ queryKey: ['gameAchievements', appid] })
            queryClient.invalidateQueries({ queryKey: ['gameDetail', appid] })
        }
        wasActiveRef.current = !!activeSession
    }, [activeSession, appid, queryClient])

    // Schema poller: only if achievements are empty at load — retry every 15s, up to 8 tries,
    // matching startSchemaPoller()'s exact cadence/cap rather than polling indefinitely.
    useEffect(() => {
        if (!isFocused || achQuery.isLoading || (achQuery.data && achQuery.data.length > 0)) return
        let tries = 0
        const interval = setInterval(() => {
            tries++
            queryClient.invalidateQueries({ queryKey: ['gameAchievements', appid] })
            if (tries >= 8) clearInterval(interval)
        }, 15_000)
        return () => clearInterval(interval)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-arm when focus or the empty/non-empty transition changes, not on every achQuery identity change
    }, [isFocused, achQuery.data?.length === 0, appid])

    // Auto-trackers item: hydrate the tracker-suggest job store so the ✦ card correctly shows
    // "→ Downloads" if a job for this game is already in flight (enqueued from a previous visit),
    // AND subscribe to the live SSE stream while focused — the web opens this connection at the
    // *layout* level (survives across every page navigation for the app's whole lifetime); scoping
    // it to just this dashboard's focus lifecycle instead (same focus-scoped pattern already used
    // for the sessions/achievements pollers) is a deliberate, narrower adaptation: a mount-only
    // fetch would miss a job completing while the user stays put on the dashboard without
    // navigating away and back, which the live subscription catches correctly.
    const fetchTrackerJobs = useTrackerSuggestJobsStore(s => s.fetchAll)
    const applyTrackerJobEvent = useTrackerSuggestJobsStore(s => s.applyEvent)
    const trackerJobs = useTrackerSuggestJobsStore(s => s.jobs)
    useEffect(() => {
        if (!isFocused) return
        fetchTrackerJobs()
        const unsubscribe = subscribeTrackerSuggestJobs({ onEvent: applyTrackerJobEvent })
        return unsubscribe
    }, [isFocused, fetchTrackerJobs, applyTrackerJobEvent])

    // Real architectural discovery, not assumed: the doc (auto-trackers.md) describes the *client*
    // creating Page records from the completed job's `trackers[]` array (gated on a
    // `localStorage['tracker-jobs-created']` dedup set) — but reading `suggest-job-queue.js`
    // directly shows this is stale. The relay itself now POSTs each tracker straight to
    // `{JOURNAL_URL}/api/pages` via `_persistTrackerPages()` the instant the job completes, with an
    // explicit comment: "Persist immediately — don't rely on any browser page being open." No
    // client-side page-creation logic exists to port at all; this effect only needs to invalidate
    // the already-fetched pages list once a job for this game finishes, so the new tracker cards
    // appear without a manual refresh.
    const wasTrackerJobActiveRef = useRef(false)
    useEffect(() => {
        const activeNow = trackerJobs.some(j => j.steamId === String(appid) && (j.status === 'pending' || j.status === 'running'))
        if (wasTrackerJobActiveRef.current && !activeNow) {
            queryClient.invalidateQueries({ queryKey: ['journalPages', appid] })
        }
        wasTrackerJobActiveRef.current = activeNow
    }, [trackerJobs, appid, queryClient])

    if (gameQuery.isLoading) {
        return <View style={styles.container}><Text style={styles.loadingText}>Loading journal…</Text></View>
    }
    if (gameQuery.isError || !gameQuery.data) {
        return <View style={styles.container}><Text style={styles.emptyText}>Failed to load journal.</Text></View>
    }

    const game = gameQuery.data
    const basePlaytimeMin = game.playtimeMinutes ?? 0
    const effectivePlaytimeMin = basePlaytimeMin + (activeSession ? sessionElapsedMin : 0)
    const gameWithLivePlaytime = { ...game, playtimeMinutes: effectivePlaytimeMin }

    const sessions = sessionsQuery.data ?? []
    const closedSessions = sessions
        .filter(s => s.endedAt && (s.durationMin ?? 0) >= 10)
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    const pages = pagesQuery.data ?? []
    const progressPages = pages.filter(p => TRACKER_TYPES.includes(p.type))

    return (
        <ScrollView style={styles.container}>
            <View style={styles.header}>
                <Pressable onPress={() => router.push(`/game/${appid}` as never)}>
                    <Text style={styles.breadcrumb}>Home / {game.name} / <Text style={styles.breadcrumbCurrent}>Journal</Text></Text>
                </Pressable>
                <Text style={styles.headerTitle}>Journal</Text>
            </View>

            <View style={styles.stack}>
                <RatingCard appid={appid} review={reviewQuery.data} />
                <AchievementCard appid={appid} achievements={achQuery.data ?? []} apiHost={apiHost} />
                <LastSessionCard sessions={sessions} achievements={achQuery.data ?? []} apiHost={apiHost} />
                <GuidesCard
                    appid={appid}
                    gameName={game.name}
                    guides={guidesQuery.data ?? []}
                    searchData={guideSearchQuery.data ?? null}
                    apiHost={apiHost}
                />
                <HltbCard game={gameWithLivePlaytime} />
                <SessionHistoryRail sessions={closedSessions} />
                <ProgressTrackersCard appid={appid} gameName={game.name} pages={progressPages} />
                <NotesCard appid={appid} notes={notesQuery.data ?? []} />
                <JournalPagesCard appid={appid} pages={pages} />
            </View>
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    loadingText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.lg },
    emptyText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.xl, textAlign: 'center' },
    header: { padding: spacing.md },
    breadcrumb: { color: 'rgba(237,233,223,0.5)', fontFamily: fonts.ui, fontSize: 11 },
    breadcrumbCurrent: { color: 'rgba(237,233,223,0.85)' },
    headerTitle: { color: colors.text, fontFamily: fonts.title, fontSize: 20, marginTop: 2 },
    stack: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
})
