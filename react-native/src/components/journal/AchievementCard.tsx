import { Pressable, StyleSheet, Text, View } from 'react-native'

import { AchievementIconRow } from '@/components/journal/AchievementIconRow'
import { colors, fonts, spacing } from '@/theme/tokens'
import type { AchievementItem } from 'gaming-journal-contracts/achievements'

// Port of JournalDashboard.svelte's Achievement card (summary bar + recent-unlocks strip).
// Tapping navigates to /journal/{appid}/achievements — not yet built (no TODO item exists for a
// dedicated achievements sub-page yet; the doc's route list doesn't mention one either), so this
// is a dead tap for now, same treatment as every other not-yet-built destination link in this app.
export function AchievementCard({ appid, achievements, apiHost }: { appid: number; achievements: AchievementItem[]; apiHost: string | undefined }) {
    const total = achievements.length
    const unlocked = achievements.filter(a => a.achieved).length
    const pct = total > 0 ? Math.round((unlocked / total) * 100) : 0
    const recent = [...achievements]
        .filter(a => a.achieved)
        .sort((a, b) => (b.unlocktime ?? 0) - (a.unlocktime ?? 0))
        .slice(0, 4)

    return (
        <Pressable style={styles.card} onPress={() => {}}>
            <Text style={styles.title}>Achievements</Text>
            {total > 0 ? (
                <>
                    <View style={styles.summaryLine}>
                        <Text style={styles.summaryText}>{unlocked} / {total} unlocked</Text>
                        <Text style={styles.summaryText}>{pct}%</Text>
                    </View>
                    <View style={styles.track}>
                        <View style={[styles.fill, { width: `${pct}%` }]} />
                    </View>
                    {recent.length > 0 && (
                        <>
                            <Text style={styles.recentLabel}>Recent</Text>
                            <AchievementIconRow items={recent} apiHost={apiHost} />
                        </>
                    )}
                </>
            ) : (
                <Text style={styles.noData}>No achievement data</Text>
            )}
        </Pressable>
    )
}

const styles = StyleSheet.create({
    card: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: spacing.md, gap: spacing.sm },
    title: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
    noData: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    summaryLine: { flexDirection: 'row', justifyContent: 'space-between' },
    summaryText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    track: { height: 6, backgroundColor: colors.bgHover, borderRadius: 3, overflow: 'hidden' },
    fill: { height: '100%', backgroundColor: colors.accent },
    recentLabel: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 10, textTransform: 'uppercase' },
})
