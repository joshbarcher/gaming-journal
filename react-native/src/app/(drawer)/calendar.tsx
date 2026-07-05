import { useQuery } from '@tanstack/react-query'
import { useIsFocused } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { getAllSessions, getUpcomingReleases } from '@/api/calendar'
import { getFlags } from '@/api/flags'
import { getSteamGamesList } from '@/api/games'
import { getSettings } from '@/api/settings'
import { getNowPlaying } from '@/api/sidebar'
import { CalendarMonth } from '@/components/calendar/CalendarMonth'
import { useApiHost } from '@/hooks/useApiHost'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { getWithTTL, setWithTTL } from '@/storage/ttl'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import {
    MONTHS, buildDayMap, buildLastPlayedOverlay, buildReleaseMap, localDateStr, localMidnight,
    type CalGame, type DayEntry, type ReleaseEntry,
} from '@/utils/calendarRender'
import type { NowPlayingSession } from 'gaming-journal-contracts/nowPlaying'

const LP_CACHE_KEY = 'cal-lp-games'
const LP_CACHE_TTL = 7 * 24 * 60 * 60 * 1000

type SlimGame = { appid: number; name: string; rtime_last_played?: number }
type Mode = 'play' | 'releases'

// Port of Calendar.svelte + CalendarMonth.svelte + CalendarCell.svelte (discovery/calendar.md).
//
// **Doc-vs-source correction**: calendar.md says day cells show "colored dots or bars ... color
// mapped per game via a stable hash". Reading CalendarCell.svelte/CalendarMonth.svelte directly
// shows this is stale — the real, current implementation renders game poster/header thumbnail
// images with a duration-overlay tag (same visual language as the rest of the app's game tiles),
// not color-hash dots. Built against the real source, not the doc.
//
// **URL-mode sync dropped**: the web keeps `mode` in sync with a `?mode=releases` query param
// (history.replaceState) so the mode survives a page reload/deep-link. RN has no address bar and
// no reload-from-URL concept for a drawer screen, so `mode` is plain local state here — a
// simplification, not a missing feature.
//
// **Keyboard month nav dropped**: the web supports ArrowLeft/Right to step months (desktop-only,
// no on-screen control). Month tabs (always visible, tap-to-select) are the real touch-equivalent
// control that already exists in the web UI too — no new gesture was invented to replace it.
export default function CalendarScreen() {
    const [mode, setMode] = useState<Mode>('play')
    const [year, setYear] = useState(() => new Date().getFullYear())
    const [monthIdx, setMonthIdx] = useState(() => new Date().getMonth())
    const [dayMap, setDayMapState] = useState<Map<string, DayEntry[]>>(new Map())
    const [releaseMap, setReleaseMap] = useState<Map<string, ReleaseEntry[]>>(new Map())
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [today, setToday] = useState(() => localDateStr(new Date()))

    const apiHostQuery = useApiHost()
    const breakpoint = useBreakpoint()
    const isPhone = breakpoint === 'mobilePortrait'
    const isFocused = useIsFocused()

    const dayMapRef = useRef(dayMap)
    function setDayMap(next: Map<string, DayEntry[]>) { dayMapRef.current = next; setDayMapState(next) }

    // ── Initial load per mode (Calendar.svelte's loadData()) ────────────────────────────────────
    useEffect(() => {
        let cancelled = false
        async function load() {
            setLoading(true); setError(null)
            setDayMap(new Map())
            setReleaseMap(new Map())
            try {
                if (mode === 'play') {
                    const cachedGames = await getWithTTL<SlimGame[]>(LP_CACHE_KEY)
                    const [sessions, flags, settings] = await Promise.all([getAllSessions(), getFlags(), getSettings()])
                    const sessionsForBuild: Record<string, CalGame> = {}
                    for (const [appid, g] of Object.entries(sessions)) {
                        sessionsForBuild[appid] = {
                            name: g.name ?? '',
                            sessions: (g.sessions ?? []).map(s => ({
                                startedAt: s.startedAt, endedAt: s.endedAt, durationMin: s.durationMin ?? 0,
                            })),
                        }
                    }
                    const base = buildDayMap(sessionsForBuild, flags, settings)

                    let games: SlimGame[]
                    if (cachedGames) {
                        games = cachedGames
                    } else {
                        const raw = await getSteamGamesList()
                        games = raw.map(g => ({ appid: g.appid, name: g.name, rtime_last_played: g.rtime_last_played }))
                        await setWithTTL(LP_CACHE_KEY, games, LP_CACHE_TTL)
                    }
                    if (cancelled) return
                    setDayMap(buildLastPlayedOverlay(games, base, flags, settings))
                } else {
                    const upcoming = await getUpcomingReleases()
                    if (cancelled) return
                    setReleaseMap(buildReleaseMap(upcoming))
                }
            } catch (err) {
                if (!cancelled) setError(`Failed to load ${mode === 'play' ? 'calendar' : 'releases'}: ${(err as Error).message}`)
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        load()
        return () => { cancelled = true }
    }, [mode])

    // ── Live session poller (play mode only, focus-scoped) ──────────────────────────────────────
    const nowPlayingQuery = useQuery({
        queryKey:        ['nowPlaying'],
        queryFn:         getNowPlaying,
        enabled:         isFocused && mode === 'play',
        refetchInterval: isFocused && mode === 'play' ? 60_000 : false,
    })

    const liveSessionRef        = useRef<NowPlayingSession | null>(null)
    const liveBaseRef           = useRef(0)
    const liveEffectiveStartRef = useRef<string | null>(null)
    const liveDateRef           = useRef<string | null>(null)
    const [liveTick, setLiveTick] = useState(0)

    function commitToDay(dateStr: string, appid: number, name: string, durationMin: number) {
        const entries = [...(dayMapRef.current.get(dateStr) ?? [])]
        const idx = entries.findIndex(e => e.appid === appid)
        if (idx >= 0) entries[idx] = { ...entries[idx], durationMin }
        else entries.push({ appid, name, durationMin })
        const m = new Map(dayMapRef.current)
        m.set(dateStr, entries)
        dayMapRef.current = m
    }

    function freezeLiveSession() {
        const session = liveSessionRef.current
        if (!session) return
        const todayStr = localDateStr(new Date())
        const startMs = liveEffectiveStartRef.current
            ? new Date(liveEffectiveStartRef.current).getTime()
            : (session.sessionStartedAt ? new Date(session.sessionStartedAt).getTime() : Date.now())
        const liveMin = Math.max(1, Math.floor((Date.now() - startMs) / 60_000))
        commitToDay(todayStr, session.appid, session.name ?? '', liveBaseRef.current + liveMin)
    }

    useEffect(() => {
        if (mode !== 'play') {
            liveSessionRef.current = null
            liveBaseRef.current = 0
            liveEffectiveStartRef.current = null
            liveDateRef.current = null
        }
    }, [mode])

    useEffect(() => {
        if (!isFocused || mode !== 'play' || nowPlayingQuery.data === undefined) return
        const playing   = nowPlayingQuery.data.playing ?? null
        const todayStr  = localDateStr(new Date())
        const prevAppid = liveSessionRef.current?.appid ?? null
        const currAppid = playing?.appid ?? null
        const prevStarted = liveSessionRef.current?.sessionStartedAt ?? null
        const currStarted = playing?.sessionStartedAt ?? null
        const sessionChanged = (currAppid !== prevAppid) || (currStarted !== prevStarted)

        const activeSession = liveSessionRef.current
        if (!sessionChanged && activeSession && liveDateRef.current && liveDateRef.current !== todayStr) {
            const midnight = localMidnight(todayStr)
            const prevEffStart = liveEffectiveStartRef.current ?? activeSession.sessionStartedAt ?? new Date().toISOString()
            const prevDayMin = Math.max(1, Math.floor((midnight - new Date(prevEffStart).getTime()) / 60_000))
            commitToDay(liveDateRef.current, activeSession.appid, activeSession.name ?? '', prevDayMin)
            liveEffectiveStartRef.current = new Date(midnight).toISOString()
            liveBaseRef.current = (dayMapRef.current.get(todayStr) ?? []).find(e => e.appid === activeSession.appid)?.durationMin ?? 0
        }

        if (sessionChanged) {
            if (prevAppid !== null) freezeLiveSession()

            if (currAppid !== null && playing) {
                const sessionDay = localDateStr(playing.sessionStartedAt ?? new Date())
                if (sessionDay !== todayStr) {
                    const midnight = localMidnight(todayStr)
                    liveEffectiveStartRef.current = new Date(midnight).toISOString()
                    const startedMs = playing.sessionStartedAt ? new Date(playing.sessionStartedAt).getTime() : Date.now()
                    const prevDayMin = Math.max(1, Math.floor((midnight - startedMs) / 60_000))
                    commitToDay(sessionDay, currAppid, playing.name ?? '', prevDayMin)
                } else {
                    liveEffectiveStartRef.current = playing.sessionStartedAt ?? new Date().toISOString()
                }
                liveBaseRef.current = (dayMapRef.current.get(todayStr) ?? []).find(e => e.appid === currAppid)?.durationMin ?? 0
            } else {
                liveBaseRef.current = 0
                liveEffectiveStartRef.current = null
            }
        }

        liveDateRef.current = todayStr
        liveSessionRef.current = playing
        setDayMapState(dayMapRef.current)
        setToday(todayStr)
        setLiveTick(Date.now())
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nowPlayingQuery.data, isFocused, mode])

    const effectiveDayMap = useMemo(() => {
        const session = liveSessionRef.current
        if (!session || mode !== 'play') return dayMap
        const todayStr = localDateStr(new Date())
        const startMs = liveEffectiveStartRef.current
            ? new Date(liveEffectiveStartRef.current).getTime()
            : (session.sessionStartedAt ? new Date(session.sessionStartedAt).getTime() : Date.now())
        const liveMin  = Math.max(1, Math.floor((Date.now() - startMs) / 60_000))
        const totalMin = liveBaseRef.current + liveMin

        const baseEntries = dayMap.get(todayStr) ?? []
        const existingIdx = baseEntries.findIndex(e => e.appid === session.appid)
        const todayEntries = existingIdx >= 0
            ? baseEntries.map((e, i) => i === existingIdx ? { ...e, durationMin: totalMin, isLive: true } : e)
            : [...baseEntries, { appid: session.appid, name: session.name ?? '', durationMin: totalMin, isLive: true }]

        const m = new Map(dayMap)
        m.set(todayStr, todayEntries)
        return m
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [liveTick, dayMap, mode])

    function setModeAndReload(m: Mode) {
        if (m === mode) return
        setMode(m)
    }

    return (
        <View style={styles.page}>
            <View style={[styles.navRow1, isPhone && styles.navRow1Phone]}>
                {!isPhone && <Text style={styles.navTitle}>Calendar</Text>}
                {!isPhone && <Text style={styles.navYear}>{year}</Text>}
                <View style={styles.modeToggle}>
                    <Pressable style={[styles.modeBtn, mode === 'play' && styles.modeBtnActive]} onPress={() => setModeAndReload('play')}>
                        <Text style={[styles.modeBtnText, mode === 'play' && styles.modeBtnTextActive]}>Play</Text>
                    </Pressable>
                    <Pressable style={[styles.modeBtn, mode === 'releases' && styles.modeBtnActive]} onPress={() => setModeAndReload('releases')}>
                        <Text style={[styles.modeBtnText, mode === 'releases' && styles.modeBtnTextActive]}>Releases</Text>
                    </Pressable>
                </View>
                <View style={styles.navRight}>
                    <Pressable style={styles.navBtn} onPress={() => setYear(y => y - 1)}>
                        <Text style={styles.navBtnText}>← {year - 1}</Text>
                    </Pressable>
                    <Pressable style={styles.navBtn} onPress={() => setYear(y => y + 1)}>
                        <Text style={styles.navBtnText}>{year + 1} →</Text>
                    </Pressable>
                </View>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.monthTabs} contentContainerStyle={styles.monthTabsContent}>
                {MONTHS.map((name, m) => (
                    <Pressable key={name} style={[styles.monthTab, m === monthIdx && styles.monthTabActive]} onPress={() => setMonthIdx(m)}>
                        <Text style={[styles.monthTabText, m === monthIdx && styles.monthTabTextActive]}>{name.slice(0, 3)}</Text>
                    </Pressable>
                ))}
            </ScrollView>
            <View style={styles.grid}>
                {loading ? (
                    <Text style={styles.loadingText}>Loading…</Text>
                ) : error ? (
                    <Text style={styles.errorText}>{error}</Text>
                ) : (
                    <CalendarMonth
                        year={year}
                        monthIdx={monthIdx}
                        today={today}
                        dayMap={effectiveDayMap}
                        releaseMap={releaseMap}
                        mode={mode}
                        isPhone={isPhone}
                        apiHost={apiHostQuery.data}
                    />
                )}
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.bg },
    navRow1: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
        paddingHorizontal: spacing.lg, paddingVertical: 6,
        borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    navRow1Phone: { paddingHorizontal: spacing.sm, justifyContent: 'space-between' },
    navTitle: { fontFamily: fonts.title, fontSize: 13, fontWeight: '600', color: colors.textMuted },
    navYear: { fontFamily: fonts.title, fontSize: 13, fontWeight: '700', color: colors.text },
    modeToggle: { flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: radius, overflow: 'hidden' },
    modeBtn: { paddingHorizontal: spacing.sm, paddingVertical: 4 },
    modeBtnActive: { backgroundColor: colors.bgHover },
    modeBtnText: { fontFamily: fonts.uiBold, fontSize: 11, color: colors.textMuted, letterSpacing: 0.3 },
    modeBtnTextActive: { color: colors.text },
    navRight: { flexDirection: 'row', gap: spacing.xs, marginLeft: 'auto' },
    navBtn: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius, paddingHorizontal: spacing.sm, paddingVertical: 4 },
    navBtnText: { fontFamily: fonts.ui, fontSize: 11, color: colors.text },
    monthTabs: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.border },
    monthTabsContent: { gap: 2, paddingHorizontal: spacing.sm, paddingVertical: 6 },
    monthTab: { paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius, borderWidth: 1, borderColor: 'transparent' },
    monthTabActive: { borderColor: colors.accent, backgroundColor: 'rgba(201,168,76,0.10)' },
    monthTabText: { fontFamily: fonts.uiBold, fontSize: 11, color: colors.textMuted, letterSpacing: 0.3 },
    monthTabTextActive: { color: colors.accent },
    grid: { flex: 1, padding: spacing.sm },
    loadingText: { color: colors.textMuted, fontFamily: fonts.ui, textAlign: 'center', marginTop: spacing.xl },
    errorText: { color: colors.text, fontFamily: fonts.ui, textAlign: 'center', marginTop: spacing.xl, paddingHorizontal: spacing.lg },
})
