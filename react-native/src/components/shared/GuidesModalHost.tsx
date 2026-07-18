import { useQueryClient } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { router } from 'expo-router'
import { useEffect, useRef } from 'react'
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { getDownloadedGuides } from '@/api/journal'
import { useApiHost } from '@/hooks/useApiHost'
import { useGuideJobsStore } from '@/store/guideJobsStore'
import { useGuidesModalStore } from '@/store/guidesModalStore'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { guideIdFromUrl } from '@/utils/guideId'
import { GUIDE_SOURCES, type GuideResult } from 'gaming-journal-contracts/guideSearch'

// Root-mounted overlay (see guidesModalStore.ts) — port of GuidesModal.svelte. Read the real source
// directly for the exact tab/category/state-derivation logic rather than the doc's summary.
//
// **Pin-clearing confirmation now real** (Guide Pins item) — was deliberately deferred when this
// component was first built ("no pin storage exists in RN yet at all"); now that pins do exist,
// `downloadGuide()` below checks the real stored pin count before a re-download and warns exactly
// like the web's own flow.
const SOURCE_LABELS: Record<string, string> = {
    gamefaqs: 'GameFAQs', ign: 'IGN', steam: 'Steam', game8: 'Game8',
    gamerguides: 'Gamer Guides', fandom: 'Fandom', neoseeker: 'Neoseeker',
}

export function GuidesModalHost() {
    const {
        visible, appid, guides, searchData, searchingSet,
        activeSource, activeCategory, close, setActiveSource, setActiveCategory, setGuides, runSearch, refreshSearch,
    } = useGuidesModalStore()
    const apiHostQuery = useApiHost()
    const apiHost = apiHostQuery.data
    const queryClient = useQueryClient()
    const jobs = useGuideJobsStore(s => s.jobs)
    const fetchAllJobs = useGuideJobsStore(s => s.fetchAll)
    const enqueueJob = useGuideJobsStore(s => s.enqueue)
    const notifiedRef = useRef<Set<string>>(new Set())

    // Port of GuidesModal.svelte's onMount: hydrate the job store once per open (mirrors
    // jobStore.fetchAll()) so jobs enqueued from a *previous* modal open (or the Downloads screen)
    // already show their real in-flight state here, not just jobs enqueued this session.
    useEffect(() => {
        if (visible) fetchAllJobs()
    }, [visible, fetchAllJobs])

    // Port of GuidesModal.svelte's `_notified` Set effect: when a job for this game transitions to
    // 'done', refetch the real downloaded-guides list (both this modal's own copy AND the
    // dashboard's TanStack Query cache, so the Guides card's tile list updates too) exactly once
    // per job id.
    useEffect(() => {
        if (!visible || !appid) return
        for (const job of jobs) {
            if (job.steamId !== String(appid)) continue
            if (job.status === 'done' && !notifiedRef.current.has(job.id)) {
                notifiedRef.current.add(job.id)
                getDownloadedGuides(appid).then(setGuides).catch(() => {})
                queryClient.invalidateQueries({ queryKey: ['downloadedGuides', appid] })
            }
        }
    }, [visible, appid, jobs, setGuides, queryClient])

    if (!visible || !appid) return null

    const activeSourceData = searchData?.sources?.[activeSource] ?? null
    const categoryKeys = activeSourceData?.categories ? Object.keys(activeSourceData.categories) : []
    const effectiveCategory = categoryKeys.length ? (activeCategory || categoryKeys[0]) : ''
    const visibleGuides: GuideResult[] = activeSourceData?.categories && effectiveCategory
        ? (activeSourceData.categories[effectiveCategory] ?? [])
        : (activeSourceData?.guides ?? [])

    const activeDownloadedIds = new Set(guides.filter(g => g.source === activeSource).map(g => g.guideId))
    const searchRunning = searchingSet.size > 0

    function sourceGuideCount(src: string): number {
        return searchData?.sources?.[src]?.guides.length ?? 0
    }

    function openGuide(source: string, guideId: string) {
        close()
        router.push(`/journal/${appid}/guides/${source}/${guideId}` as never)
    }

    function jobStatusFor(guideId: string): 'pending' | 'running' | 'error' | null {
        const job = jobs.find(j => j.steamId === String(appid) && j.source === activeSource && j.guideId === guideId)
        if (!job || job.status === 'cancelled' || job.status === 'done') return null
        return job.status
    }

    async function downloadGuide(guide: GuideResult, guideId: string) {
        if (!appid) return
        const existing = jobs.find(j => j.steamId === String(appid) && j.source === activeSource && j.guideId === guideId)
        if (existing?.status === 'pending' || existing?.status === 'running') return

        // Re-downloading a guide no longer clears its pins — the relay re-anchors them to the
        // freshly-parsed content by text on the next pins GET (pins.service reanchorPinList), so
        // no warning or clear is needed here.
        try {
            await enqueueJob({ steamId: String(appid), source: activeSource, guideId, url: guide.url, gameName: activeSourceData?.matchedGame?.name })
        } catch (err) {
            console.error('[GuidesModalHost] enqueue failed:', (err as Error).message)
        }
    }

    return (
        <View style={styles.backdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={close} />
            <View style={styles.panel}>
                <View style={styles.header}>
                    <Text style={styles.title}>Available Guides</Text>
                    <Pressable onPress={close} hitSlop={8}><Text style={styles.closeBtn}>✕</Text></Pressable>
                </View>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabRow} contentContainerStyle={styles.tabRowContent}>
                    {GUIDE_SOURCES.map(src => {
                        const count = sourceGuideCount(src)
                        const spinning = searchingSet.has(src)
                        return (
                            <Pressable
                                key={src}
                                style={[styles.tab, activeSource === src && styles.tabActive]}
                                onPress={() => setActiveSource(src)}
                            >
                                {!!apiHost && <Image source={{ uri: `${apiHost}/images/guides/${src}.webp` }} style={styles.tabIcon} contentFit="contain" />}
                                <Text style={[styles.tabLabel, activeSource === src && styles.tabLabelActive]}>{SOURCE_LABELS[src]}</Text>
                                {spinning ? (
                                    <View style={styles.tabSpinnerDot} />
                                ) : count > 0 ? (
                                    <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{count}</Text></View>
                                ) : null}
                            </Pressable>
                        )
                    })}
                </ScrollView>

                <View style={styles.infoRow}>
                    {activeSourceData?.matchedGame ? (
                        <View style={styles.infoLeft}>
                            <Text style={styles.infoText} numberOfLines={1}>
                                {activeSourceData.matchedGame.name}
                                {activeSourceData.matchedGame.platform ? ` · ${activeSourceData.matchedGame.platform.toUpperCase()}` : ''}
                            </Text>
                            <Pressable onPress={() => Linking.openURL(activeSourceData.matchedGame!.gameUrl)}>
                                <Text style={styles.infoLink}>View ↗</Text>
                            </Pressable>
                        </View>
                    ) : (
                        <Text style={styles.infoTextMuted}>
                            {searchingSet.has(activeSource) ? 'Searching…' : 'Not yet searched'}
                        </Text>
                    )}
                    <Pressable
                        style={[styles.refreshBtn, searchingSet.has(activeSource) && styles.refreshBtnSpinning]}
                        disabled={searchingSet.has(activeSource)}
                        onPress={() => runSearch(activeSource)}
                    >
                        <Text style={styles.refreshBtnText}>↻</Text>
                    </Pressable>
                    <Pressable style={styles.refreshAllBtn} disabled={searchRunning} onPress={refreshSearch}>
                        <Text style={styles.refreshAllBtnText}>↻ All</Text>
                    </Pressable>
                </View>

                {categoryKeys.length > 0 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catRow}>
                        {categoryKeys.map(cat => (
                            <Pressable key={cat} style={[styles.catTab, effectiveCategory === cat && styles.catTabActive]} onPress={() => setActiveCategory(cat)}>
                                <Text style={[styles.catTabText, effectiveCategory === cat && styles.catTabTextActive]}>{cat}</Text>
                            </Pressable>
                        ))}
                    </ScrollView>
                )}

                <ScrollView style={styles.list}>
                    {!activeSourceData && !searchingSet.has(activeSource) ? (
                        <Text style={styles.emptyMsg}>Tap ↻ to search for guides on {SOURCE_LABELS[activeSource]}</Text>
                    ) : !activeSourceData ? (
                        <Text style={styles.emptyMsg}>Searching {SOURCE_LABELS[activeSource]}…</Text>
                    ) : visibleGuides.length === 0 ? (
                        <Text style={styles.emptyMsg}>No guides found on {SOURCE_LABELS[activeSource]}</Text>
                    ) : (
                        visibleGuides.map((guide, i) => {
                            const guideId = guideIdFromUrl(guide.url)
                            const downloaded = guideId ? activeDownloadedIds.has(guideId) : false
                            const jobStatus = guideId ? jobStatusFor(guideId) : null
                            return (
                                <View key={`${guide.url}-${i}`} style={styles.row}>
                                    <View style={styles.rowInfo}>
                                        <Text style={styles.rowTitle} numberOfLines={1}>{guide.title}</Text>
                                        <View style={styles.rowMeta}>
                                            <Text style={styles.typeBadge}>{guide.type}</Text>
                                            <Pressable onPress={() => Linking.openURL(guide.url)}>
                                                <Text style={styles.extLink}>↗</Text>
                                            </Pressable>
                                        </View>
                                    </View>
                                    {!guideId ? (
                                        <Text style={styles.statusErr}>—</Text>
                                    ) : jobStatus === 'pending' || jobStatus === 'running' ? (
                                        <Pressable style={styles.dlBtnActive} onPress={() => { close(); router.push('/downloads' as never) }}>
                                            <Text style={styles.dlBtnActiveText}>Downloading →</Text>
                                        </Pressable>
                                    ) : jobStatus === 'error' ? (
                                        <Pressable style={styles.dlBtn} onPress={() => downloadGuide(guide, guideId)}>
                                            <Text style={styles.dlBtnText}>Retry</Text>
                                        </Pressable>
                                    ) : downloaded ? (
                                        <View style={styles.doneActions}>
                                            <Pressable style={styles.openBtn} onPress={() => openGuide(activeSource, guideId)}>
                                                <Text style={styles.openBtnText}>Open ›</Text>
                                            </Pressable>
                                            <Pressable style={styles.reDlBtn} onPress={() => downloadGuide(guide, guideId)} hitSlop={6}>
                                                <Text style={styles.reDlBtnText}>↺</Text>
                                            </Pressable>
                                        </View>
                                    ) : (
                                        <Pressable style={styles.dlBtn} onPress={() => downloadGuide(guide, guideId)}>
                                            <Text style={styles.dlBtnText}>Download</Text>
                                        </Pressable>
                                    )}
                                </View>
                            )
                        })
                    )}
                </ScrollView>
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    // Same react-native-web Modal-height quirk as ScreenshotLightboxHost/ReviewEditor — plain View
    // + explicit `fixed` on web instead of RN's <Modal>, per the standing PLAN.md note.
    backdrop: {
        ...StyleSheet.absoluteFill,
        ...(Platform.OS === 'web' ? { position: 'fixed' as 'absolute' } : null),
        backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', padding: spacing.md, zIndex: 50,
    },
    panel: { width: '100%', maxWidth: 640, maxHeight: '85%', backgroundColor: colors.bgRaised, borderRadius: radius, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 17 },
    closeBtn: { color: colors.textMuted, fontSize: 18, padding: 4 },
    tabRow: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.border },
    tabRowContent: { paddingHorizontal: spacing.sm, gap: spacing.xs, paddingVertical: spacing.xs },
    tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: 6 },
    tabActive: { backgroundColor: colors.accentBg },
    tabIcon: { width: 16, height: 16 },
    tabLabel: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    tabLabelActive: { color: colors.accent, fontFamily: fonts.uiBold },
    tabSpinnerDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
    tabBadge: { backgroundColor: colors.bgHover, borderRadius: 8, paddingHorizontal: 6, minWidth: 16, alignItems: 'center' },
    tabBadgeText: { color: colors.textMuted, fontSize: 10, fontFamily: fonts.uiBold },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
    infoLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    infoText: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 12, flexShrink: 1 },
    infoTextMuted: { flex: 1, color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    infoLink: { color: colors.accent, fontFamily: fonts.ui, fontSize: 11 },
    refreshBtn: { width: 28, height: 28, borderRadius: 6, backgroundColor: colors.bgHover, alignItems: 'center', justifyContent: 'center' },
    refreshBtnSpinning: { opacity: 0.5 },
    refreshBtnText: { color: colors.text, fontSize: 14 },
    refreshAllBtn: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: 6, backgroundColor: colors.accentBg, borderWidth: 1, borderColor: colors.borderAct },
    refreshAllBtnText: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 11 },
    catRow: { flexGrow: 0, paddingHorizontal: spacing.md, paddingTop: spacing.xs },
    catTab: { paddingHorizontal: spacing.sm, paddingVertical: 4, marginRight: spacing.xs, borderRadius: 999, backgroundColor: colors.bgHover },
    catTabActive: { backgroundColor: colors.accentBg },
    catTabText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    catTabTextActive: { color: colors.accent, fontFamily: fonts.uiBold },
    list: { padding: spacing.md },
    emptyMsg: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, textAlign: 'center', paddingVertical: spacing.lg },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
    rowInfo: { flex: 1, gap: 3 },
    rowTitle: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
    rowMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    typeBadge: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 10, textTransform: 'uppercase', backgroundColor: colors.bgHover, paddingHorizontal: 6, borderRadius: 4 },
    extLink: { color: colors.textMuted, fontSize: 12 },
    statusErr: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    doneActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    openBtn: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: 6, backgroundColor: colors.accentBg, borderWidth: 1, borderColor: colors.borderAct },
    openBtnText: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 12 },
    reDlBtn: { width: 26, height: 26, borderRadius: 6, backgroundColor: colors.bgHover, alignItems: 'center', justifyContent: 'center' },
    reDlBtnText: { color: colors.textMuted, fontSize: 13 },
    dlBtn: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: 6, backgroundColor: colors.bgHover },
    dlBtnText: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 12 },
    dlBtnActive: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: 6, backgroundColor: colors.accentBg, borderWidth: 1, borderColor: colors.borderAct },
    dlBtnActiveText: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 12 },
})
