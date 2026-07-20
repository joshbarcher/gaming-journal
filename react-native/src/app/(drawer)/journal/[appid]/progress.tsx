import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { getGameDetail } from '@/api/gamePage'
import { createPage, deletePage, getJournalPages } from '@/api/journal'
import { confirmDialog } from '@/store/confirmDialogStore'
import { Lucide } from '@/components/shared/Lucide'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { TRACKER_META, TRACKER_TYPES, fmtDate } from '@/utils/journalRender'
import { globalSegments } from '@/utils/progressHelpers'
import type { Page } from 'gaming-journal-contracts/pages'

// Port of JournalProgress.svelte — the tracker LIST screen (create/delete), not the 4 tracker
// detail editors themselves (those are separate Phase 4 TODO items: "Tracker detail: progress
// type", "...progress-bars type", "...counter/multi-counter types"). Each list row shows a full
// globalSegments() bar — one colored block per task/bar/counter — ported verbatim, distinct from
// the Journal dashboard's simplified percentage-only heatmap cells (a deliberate simplification
// made there, not here).
export default function JournalProgressScreen() {
    const { appid: appidStr } = useLocalSearchParams<{ appid: string }>()
    const appid = Number(appidStr)
    const queryClient = useQueryClient()

    const gameQuery = useQuery({ queryKey: ['gameDetail', appid], queryFn: () => getGameDetail(appid) })
    const pagesQuery = useQuery({ queryKey: ['journalPages', appid], queryFn: () => getJournalPages(appid) })

    const createMutation = useMutation({
        mutationFn: (args: { type: Page['type']; title: string; extra?: Record<string, unknown> }) =>
            createPage({ type: args.type, title: args.title, appid: String(appid), ...args.extra }),
        onSuccess: (page) => {
            queryClient.invalidateQueries({ queryKey: ['journalPages', appid] })
            router.push(`/${page.id}` as never)
        },
    })
    const deleteMutation = useMutation({
        mutationFn: (id: string) => deletePage(id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['journalPages', appid] }),
    })

    async function onDelete(p: Page) {
        const ok = await confirmDialog(`Delete "${p.title}"?`, 'This will permanently delete the tracker and all its data.', 'Delete')
        if (!ok) return
        deleteMutation.mutate(p.id)
    }

    const trackers = (pagesQuery.data ?? []).filter(p => TRACKER_TYPES.includes(p.type))

    return (
        <ScrollView style={styles.container}>
            <View style={styles.header}>
                <Pressable onPress={() => router.push(`/journal/${appid}` as never)}>
                    <Text style={styles.breadcrumb}>
                        Home / {gameQuery.data?.name ?? '…'} / Journal / <Text style={styles.breadcrumbCurrent}>Progress Trackers</Text>
                    </Text>
                </Pressable>
                <View style={styles.newRow}>
                    <Pressable style={styles.newBtn} onPress={() => createMutation.mutate({ type: 'progress', title: 'New Tracker' })}>
                        <Text style={styles.newBtnText}>+ Progress</Text>
                    </Pressable>
                    <Pressable style={styles.newBtn} onPress={() => createMutation.mutate({ type: 'progress-bars', title: 'New Multi-Bar' })}>
                        <Text style={styles.newBtnText}>+ Multi-Bar</Text>
                    </Pressable>
                    <Pressable style={styles.newBtn} onPress={() => createMutation.mutate({ type: 'counter', title: 'New Counter', extra: { current: 0, target: 10 } })}>
                        <Text style={styles.newBtnText}>+ Counter</Text>
                    </Pressable>
                    <Pressable style={styles.newBtn} onPress={() => createMutation.mutate({ type: 'multi-counter', title: 'New Multi-Counter', extra: { counters: [] } })}>
                        <Text style={styles.newBtnText}>+ Multi-Counter</Text>
                    </Pressable>
                </View>
            </View>

            <View style={styles.list}>
                {trackers.length === 0 ? (
                    <Text style={styles.noData}>No trackers yet. Create one to start tracking progress.</Text>
                ) : (
                    trackers.map(p => {
                        const meta = TRACKER_META[p.type] ?? TRACKER_META.progress
                        const segs = globalSegments(p)
                        return (
                            <Pressable key={p.id} style={styles.item} onPress={() => router.push(`/${p.id}` as never)}>
                                <View style={styles.itemTop}>
                                    {p.type === 'progress-bars' ? (
                                        <View style={styles.itemIconWrap}><Lucide name="bar-chart" color={colors.sky} size={16} /></View>
                                    ) : (
                                        <Text style={styles.itemIcon}>{meta.icon}</Text>
                                    )}
                                    <View style={styles.itemBody}>
                                        <Text style={styles.itemTitle}>{p.title}</Text>
                                        <Text style={styles.itemMeta}>{meta.label} · Updated {fmtDate(p.updatedAt)}</Text>
                                    </View>
                                    <Pressable onPress={() => onDelete(p)} hitSlop={8}>
                                        <Text style={styles.itemDelete}>×</Text>
                                    </Pressable>
                                </View>
                                <View style={styles.segBar}>
                                    {segs.length > 0 ? segs.map((s, i) => (
                                        <View key={i} style={[styles.seg, { backgroundColor: s.color }]}>
                                            {!!s.label && <Text style={styles.segLabel} numberOfLines={1}>{s.label}</Text>}
                                            {!!s.stateLabel && <Text style={styles.segState}>{s.stateLabel}</Text>}
                                        </View>
                                    )) : (
                                        <View style={[styles.seg, styles.segEmpty]} />
                                    )}
                                </View>
                            </Pressable>
                        )
                    })
                )}
            </View>
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    header: { padding: spacing.md, gap: spacing.sm },
    breadcrumb: { color: 'rgba(237,233,223,0.5)', fontFamily: fonts.ui, fontSize: 12 },
    breadcrumbCurrent: { color: 'rgba(237,233,223,0.85)' },
    newRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
    newBtn: { backgroundColor: colors.accentBg, borderWidth: 1, borderColor: colors.borderAct, borderRadius: radius, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
    newBtnText: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 12 },
    noData: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, padding: spacing.md },
    list: { paddingHorizontal: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
    item: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius, padding: spacing.sm },
    itemTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    itemIcon: { fontSize: 16, width: 20, textAlign: 'center' },
    itemIconWrap: { width: 20, alignItems: 'center' },
    itemBody: { flex: 1, gap: 2 },
    itemTitle: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 14 },
    itemMeta: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    itemDelete: { color: colors.textMuted, fontSize: 20, paddingHorizontal: spacing.xs },
    segBar: { flexDirection: 'row', gap: 3, height: 40, marginTop: spacing.sm },
    seg: { flex: 1, minWidth: 20, borderRadius: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, overflow: 'hidden' },
    segEmpty: { backgroundColor: 'rgba(255,255,255,0.07)' },
    segLabel: { color: 'rgba(0,0,0,0.65)', fontFamily: fonts.uiBold, fontSize: 10, textAlign: 'center' },
    segState: { color: 'rgba(0,0,0,0.65)', fontFamily: fonts.uiBold, fontSize: 8, textTransform: 'uppercase', marginTop: 2, opacity: 0.7 },
})
