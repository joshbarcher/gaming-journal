import { router } from 'expo-router'
import { useIsFocused } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { subscribeGuideJobs } from '@/api/guideJobs'
import { subscribeTrackerSuggestJobs } from '@/api/trackerSuggest'
import { useGuideJobsStore } from '@/store/guideJobsStore'
import { useTrackerSuggestJobsStore } from '@/store/trackerSuggestJobsStore'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { confirmDialog } from '@/store/confirmDialogStore'
import type { GuideJob } from 'gaming-journal-contracts/guideJobs'

// Port of DownloadsPage.svelte — now covers **both** sections: Guide Downloads (built in the
// earlier "Guide download/refresh" item) and AI Tracker Suggestions (this item, `progress-suggest`
// jobs — a genuinely different job store, added once its own TODO item was reached rather than
// built ahead of time, same "don't build ahead of its own TODO item" call as Reviews vs. Pricing
// on the Game detail screen).
//
// **Focus-scoped SSE, not visibilitychange**: the web opens/closes an EventSource on
// document.visibilitychange; RN has no page visibility concept, so this uses the same
// useIsFocused()-gated pattern already established for the Journal dashboard's pollers — the
// live stream only runs while this screen is the active route.
//
// **No requeue action for tracker-suggest jobs** — confirmed via `DownloadsPage.svelte`'s real
// template: the AI Tracker history table's action column only ever renders "View Trackers ›" (done)
// or a Log toggle (error), no re-run button exists for this job type at all (unlike guide
// downloads' ↺). Matched exactly, not an oversight.
const SOURCE_LABELS: Record<string, string> = {
    gamefaqs: 'GameFAQs', ign: 'IGN', steam: 'Steam', game8: 'Game8',
    gamerguides: 'Gamer Guides', fandom: 'Fandom', neoseeker: 'Neoseeker',
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
    pending:   { bg: 'rgba(255,255,255,0.06)', fg: colors.textMuted },
    running:   { bg: 'rgba(79,142,247,0.15)',  fg: '#4f8ef7' },
    done:      { bg: 'rgba(80,200,100,0.15)',  fg: '#50c864' },
    error:     { bg: 'rgba(220,80,80,0.15)',   fg: '#dc5050' },
    cancelled: { bg: 'rgba(255,255,255,0.06)', fg: colors.textMuted },
}

function fmtTime(iso: string | null): string {
    if (!iso) return '—'
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function elapsed(startedAt: string | null, completedAt: string | null): string {
    if (!startedAt) return ''
    const end = completedAt ? new Date(completedAt).getTime() : Date.now()
    const sec = Math.floor((end - new Date(startedAt).getTime()) / 1000)
    if (sec < 60) return `${sec}s`
    return `${Math.floor(sec / 60)}m ${sec % 60}s`
}

function fmtBytes(n: number | null): string {
    if (!n) return '—'
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
    return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export default function DownloadsScreen() {
    const isFocused = useIsFocused()
    const jobs = useGuideJobsStore(s => s.jobs)
    const fetchAll = useGuideJobsStore(s => s.fetchAll)
    const cancel = useGuideJobsStore(s => s.cancel)
    const enqueue = useGuideJobsStore(s => s.enqueue)
    const applyEvent = useGuideJobsStore(s => s.applyEvent)
    const [expandedLog, setExpandedLog] = useState<string | null>(null)

    const active = jobs.filter(j => j.status === 'running' || j.status === 'pending')
    const finished = [...jobs.filter(j => j.status === 'done' || j.status === 'error' || j.status === 'cancelled')].reverse()

    const tsJobs = useTrackerSuggestJobsStore(s => s.jobs)
    const tsFetchAll = useTrackerSuggestJobsStore(s => s.fetchAll)
    const tsCancel = useTrackerSuggestJobsStore(s => s.cancel)
    const tsApplyEvent = useTrackerSuggestJobsStore(s => s.applyEvent)
    const tsActive = tsJobs.filter(j => j.status === 'running' || j.status === 'pending')
    const tsFinished = [...tsJobs.filter(j => j.status === 'done' || j.status === 'error' || j.status === 'cancelled')].reverse()

    const unsubRef = useRef<(() => void) | null>(null)
    const tsUnsubRef = useRef<(() => void) | null>(null)
    useEffect(() => {
        if (!isFocused) {
            unsubRef.current?.(); unsubRef.current = null
            tsUnsubRef.current?.(); tsUnsubRef.current = null
            return
        }
        fetchAll()
        tsFetchAll()
        unsubRef.current = subscribeGuideJobs({ onEvent: applyEvent })
        tsUnsubRef.current = subscribeTrackerSuggestJobs({ onEvent: tsApplyEvent })
        return () => {
            unsubRef.current?.(); unsubRef.current = null
            tsUnsubRef.current?.(); tsUnsubRef.current = null
        }
    }, [isFocused, fetchAll, applyEvent, tsFetchAll, tsApplyEvent])

    async function requeue(job: GuideJob) {
        const inFlight = jobs.find(j => j.steamId === job.steamId && j.source === job.source && j.guideId === job.guideId && (j.status === 'pending' || j.status === 'running'))
        if (inFlight) return
        if (job.status === 'done') {
            const ok = await confirmDialog('Re-download guide', 'This will overwrite the saved guide. Continue?', 'Re-download')
            if (!ok) return
        }
        try {
            await enqueue({ steamId: job.steamId, source: job.source, guideId: job.guideId, url: job.url, gameName: job.gameName })
        } catch (err) {
            console.error('[DownloadsScreen] requeue failed:', (err as Error).message)
        }
    }

    return (
        <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
            <Text style={styles.title}>Downloads</Text>

            {active.length === 0 && finished.length === 0 && tsActive.length === 0 && tsFinished.length === 0 && (
                <Text style={styles.empty}>No downloads yet. Open a game's Journal → Guides → Find, then tap Download, or use ✦ on a journal dashboard to suggest trackers.</Text>
            )}

            {(active.length > 0 || finished.length > 0) && <Text style={styles.categoryTitle}>Guide Downloads</Text>}

            {active.length > 0 && (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>ACTIVE</Text>
                    {active.map(job => (
                        <View key={job.id} style={[styles.card, job.status === 'running' && styles.cardRunning]}>
                            <View style={styles.cardHeader}>
                                <Text style={styles.cardGame} numberOfLines={1}>{job.gameName || job.guideId}</Text>
                                <Text style={styles.cardSource}>{SOURCE_LABELS[job.source] ?? job.source}</Text>
                                <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[job.status].bg }]}>
                                    <Text style={[styles.statusBadgeText, { color: STATUS_COLORS[job.status].fg }]}>
                                        {job.status === 'pending' ? 'Queued' : 'Running'}
                                    </Text>
                                </View>
                                {job.status === 'pending' && (
                                    <Pressable style={styles.cancelBtn} onPress={() => cancel(job.id)}>
                                        <Text style={styles.cancelBtnText}>Cancel</Text>
                                    </Pressable>
                                )}
                            </View>
                            {job.status === 'running' && (
                                <View style={styles.bars}>
                                    {(['download', 'pages', 'subtask'] as const).map((key, i) => (
                                        <View key={key} style={styles.barRow}>
                                            <Text style={styles.barLabel}>{['Fetch', 'Parse', 'Index'][i]}</Text>
                                            <View style={styles.barTrack}><View style={[styles.barFill, { width: `${job.progress[key]}%` }]} /></View>
                                            <Text style={styles.barPct}>{job.progress[key]}%</Text>
                                        </View>
                                    ))}
                                    {job.log.length > 0 && (
                                        <Text style={styles.logTail} numberOfLines={1}>{job.log[job.log.length - 1]}</Text>
                                    )}
                                </View>
                            )}
                        </View>
                    ))}
                </View>
            )}

            {finished.length > 0 && (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>HISTORY</Text>
                    {finished.map(job => (
                        <View key={job.id}>
                            <View style={styles.historyRow}>
                                <View style={styles.historyMain}>
                                    <Text style={styles.historyGame} numberOfLines={1}>{job.gameName || job.guideId}</Text>
                                    <Text style={styles.historyMeta}>
                                        {SOURCE_LABELS[job.source] ?? job.source} · {fmtTime(job.startedAt)} · {elapsed(job.startedAt, job.completedAt)}
                                        {job.status === 'done' ? ` · ${fmtBytes(job.sizeBytes)}` : ''}
                                    </Text>
                                </View>
                                <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[job.status].bg }]}>
                                    <Text style={[styles.statusBadgeText, { color: STATUS_COLORS[job.status].fg }]}>{job.status}</Text>
                                </View>
                                {job.status === 'done' && (
                                    <Pressable onPress={() => router.push(`/journal/${job.steamId}/guides/${job.source}/${job.guideId}` as never)}>
                                        <Text style={styles.openLink}>Open ›</Text>
                                    </Pressable>
                                )}
                                {job.status === 'error' && (
                                    <Pressable style={styles.logBtn} onPress={() => setExpandedLog(expandedLog === job.id ? null : job.id)}>
                                        <Text style={styles.logBtnText}>{expandedLog === job.id ? 'Hide' : 'Log'}</Text>
                                    </Pressable>
                                )}
                                <Pressable style={styles.requeueBtn} onPress={() => requeue(job)} hitSlop={6}>
                                    <Text style={styles.requeueBtnText}>↺</Text>
                                </Pressable>
                            </View>
                            {expandedLog === job.id && job.log.length > 0 && (
                                <Text style={styles.logPre}>{job.log.join('\n')}</Text>
                            )}
                        </View>
                    ))}
                </View>
            )}

            {(tsActive.length > 0 || tsFinished.length > 0) && <Text style={styles.categoryTitle}>AI Tracker Suggestions</Text>}

            {tsActive.length > 0 && (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>ACTIVE</Text>
                    {tsActive.map(job => (
                        <View key={job.id} style={[styles.card, job.status === 'running' && styles.cardRunning]}>
                            <View style={styles.cardHeader}>
                                <Text style={styles.cardGame} numberOfLines={1}>{job.gameName}</Text>
                                <Text style={styles.cardSourceAi}>AI ✦</Text>
                                <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[job.status].bg }]}>
                                    <Text style={[styles.statusBadgeText, { color: STATUS_COLORS[job.status].fg }]}>
                                        {job.status === 'pending' ? 'Queued' : 'Running'}
                                    </Text>
                                </View>
                                {job.status === 'pending' && (
                                    <Pressable style={styles.cancelBtn} onPress={() => tsCancel(job.id)}>
                                        <Text style={styles.cancelBtnText}>Cancel</Text>
                                    </Pressable>
                                )}
                            </View>
                            {job.status === 'running' && (
                                <View style={styles.bars}>
                                    <View style={styles.barRow}>
                                        <Text style={styles.barLabel}>Research</Text>
                                        <View style={styles.barTrack}><View style={[styles.barFillAi, { width: `${job.progress}%` }]} /></View>
                                        <Text style={styles.barPct}>{job.progress}%</Text>
                                    </View>
                                    {job.log.length > 0 && (
                                        <Text style={styles.logTail} numberOfLines={1}>{job.log[job.log.length - 1]}</Text>
                                    )}
                                </View>
                            )}
                        </View>
                    ))}
                </View>
            )}

            {tsFinished.length > 0 && (
                <View style={styles.section}>
                    <Text style={styles.sectionTitle}>HISTORY</Text>
                    {tsFinished.map(job => (
                        <View key={job.id}>
                            <View style={styles.historyRow}>
                                <View style={styles.historyMain}>
                                    <Text style={styles.historyGame} numberOfLines={1}>{job.gameName}</Text>
                                    <Text style={styles.historyMeta}>
                                        {fmtTime(job.startedAt)} · {elapsed(job.startedAt, job.completedAt)}
                                        {job.status === 'done' ? ` · ${job.trackers?.length ?? 0} trackers` : ''}
                                    </Text>
                                </View>
                                <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[job.status].bg }]}>
                                    <Text style={[styles.statusBadgeText, { color: STATUS_COLORS[job.status].fg }]}>{job.status}</Text>
                                </View>
                                {job.status === 'done' && (
                                    <Pressable onPress={() => router.push(`/journal/${job.steamId}/progress` as never)}>
                                        <Text style={styles.openLink}>View Trackers ›</Text>
                                    </Pressable>
                                )}
                                {job.status === 'error' && (
                                    <Pressable style={styles.logBtn} onPress={() => setExpandedLog(expandedLog === job.id ? null : job.id)}>
                                        <Text style={styles.logBtnText}>{expandedLog === job.id ? 'Hide' : 'Log'}</Text>
                                    </Pressable>
                                )}
                            </View>
                            {expandedLog === job.id && (job.log.length > 0 || job.error) && (
                                <Text style={styles.logPre}>{job.error ? `${job.error}\n` : ''}{job.log.join('\n')}</Text>
                            )}
                        </View>
                    ))}
                </View>
            )}
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.bg },
    pageContent: { padding: spacing.md, paddingBottom: spacing.xl },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 22, marginBottom: spacing.md },
    empty: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, paddingVertical: spacing.lg },
    categoryTitle: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 14, marginTop: spacing.md, marginBottom: spacing.sm, paddingBottom: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border },
    section: { marginBottom: spacing.lg },
    sectionTitle: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 11, letterSpacing: 1, marginBottom: spacing.sm },
    card: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius, padding: spacing.md, marginBottom: spacing.sm },
    cardRunning: { borderColor: '#4f8ef7' },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
    cardGame: { flex: 1, color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
    cardSource: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, backgroundColor: colors.bgHover, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3 },
    cardSourceAi: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 11, backgroundColor: 'rgba(201,168,76,0.12)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3 },
    statusBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 3 },
    statusBadgeText: { fontFamily: fonts.uiBold, fontSize: 10, textTransform: 'uppercase' },
    cancelBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: 3, paddingHorizontal: spacing.sm, paddingVertical: 2 },
    cancelBtnText: { color: colors.textMuted, fontSize: 11 },
    bars: { gap: spacing.xs },
    barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    // width:44 fit the guide-download labels ("Fetch"/"Parse"/"Index", all ≤5 chars) but wrapped
    // the AI job's real "Research" label (8 chars) onto 2 lines — caught by the first live
    // screenshot of a real running job, not assumed from a static render.
    barLabel: { width: 60, color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    barTrack: { flex: 1, height: 4, backgroundColor: colors.bgHover, borderRadius: 2, overflow: 'hidden' },
    barFill: { height: '100%', backgroundColor: '#4f8ef7', borderRadius: 2 },
    barFillAi: { height: '100%', backgroundColor: colors.accent, borderRadius: 2 },
    barPct: { width: 34, color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, textAlign: 'right' },
    logTail: { marginTop: spacing.xs, color: colors.textMuted, fontSize: 10, fontFamily: 'monospace' as never },
    historyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
    historyMain: { flex: 1, gap: 2 },
    historyGame: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
    historyMeta: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    openLink: { color: colors.accent, fontFamily: fonts.ui, fontSize: 12 },
    logBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: 3, paddingHorizontal: spacing.sm, paddingVertical: 2 },
    logBtnText: { color: colors.textMuted, fontSize: 11 },
    requeueBtn: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
    requeueBtnText: { color: colors.textMuted, fontSize: 14 },
    logPre: { color: colors.textMuted, fontFamily: 'monospace' as never, fontSize: 10, backgroundColor: colors.bgHover, padding: spacing.sm, borderRadius: radius, marginBottom: spacing.sm },
})
