import { router } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { confirmDialog } from '@/store/confirmDialogStore'
import { useTrackerSuggestJobsStore } from '@/store/trackerSuggestJobsStore'
import { colors, fonts, spacing } from '@/theme/tokens'
import { pagePct, percentToColor, percentToStateLabel } from '@/utils/progressHelpers'
import type { Page } from 'gaming-journal-contracts/pages'

// Port of JournalDashboard.svelte's Progress Trackers heatmap card. Tapping the card body
// navigates to /journal/{appid}/progress. **The ✦ AI-suggest button is now real** (Auto-trackers
// item) — was left as a visible-but-inert affordance in the earlier Journal dashboard item, since
// the job-queue infrastructure this needed didn't exist yet.
export function ProgressTrackersCard({ appid, gameName, pages }: { appid: number; gameName: string; pages: Page[] }) {
    const activeJob = useTrackerSuggestJobsStore(s => s.jobFor(String(appid)))
    const enqueue = useTrackerSuggestJobsStore(s => s.enqueue)

    async function onSuggestPress() {
        if (activeJob) {
            router.push('/downloads' as never)
            return
        }
        const ok = await confirmDialog(
            'AI-suggest trackers',
            `This will search the web and generate progress trackers for ${gameName}. Continue?`,
            'Generate',
        )
        if (!ok) return
        try {
            await enqueue({ steamId: String(appid), gameName })
        } catch (err) {
            console.error('[ProgressTrackersCard] enqueue failed:', (err as Error).message)
        }
    }

    return (
        <Pressable style={styles.card} onPress={() => router.push(`/journal/${appid}/progress` as never)}>
            <View style={styles.header}>
                <Text style={styles.title}>Progress Trackers</Text>
                {activeJob ? (
                    <Pressable onPress={(e) => { e.stopPropagation(); router.push('/downloads' as never) }}>
                        <Text style={styles.suggestLink}>→ Downloads</Text>
                    </Pressable>
                ) : (
                    <Pressable onPress={(e) => { e.stopPropagation(); onSuggestPress() }}>
                        <Text style={styles.suggestBtn}>✦</Text>
                    </Pressable>
                )}
            </View>
            {pages.length > 0 ? (
                <View style={styles.grid}>
                    {pages.map(p => {
                        const pct = pagePct(p)
                        const color = percentToColor(pct)
                        const state = percentToStateLabel(pct)
                        // percentToColor returns a barely-visible translucent overlay for pct===0
                        // (DIM), too faint for dark text to read against — only the bright colored
                        // states (started/working/done) get dark text, matching visual intent.
                        const textStyle = pct > 0 ? styles.cellTextDark : styles.cellTextLight
                        return (
                            <View key={p.id} style={[styles.cell, { backgroundColor: color }]}>
                                <Text style={[styles.cellTitle, textStyle]} numberOfLines={2}>{p.title}</Text>
                                <Text style={[styles.cellPct, textStyle]}>{pct}%{state ? ` · ${state}` : ''}</Text>
                            </View>
                        )
                    })}
                </View>
            ) : (
                <Text style={styles.noData}>No trackers yet</Text>
            )}
        </Pressable>
    )
}

const styles = StyleSheet.create({
    card: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: spacing.md, gap: spacing.sm },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    title: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
    suggestBtn: { color: colors.textMuted, fontSize: 14 },
    suggestLink: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 11 },
    noData: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    cell: { width: '31%', minHeight: 52, borderRadius: 4, padding: 6, justifyContent: 'space-between' },
    cellTitle: { fontFamily: fonts.uiBold, fontSize: 10 },
    cellPct: { fontFamily: fonts.ui, fontSize: 9 },
    cellTextDark: { color: '#0d0b09' },
    cellTextLight: { color: colors.textMuted },
})
