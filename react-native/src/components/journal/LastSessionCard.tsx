import { StyleSheet, Text, View } from 'react-native'

import { AchievementIconRow } from '@/components/journal/AchievementIconRow'
import { colors, fonts, spacing } from '@/theme/tokens'
import { fmtDate } from '@/utils/journalRender'
import type { AchievementItem } from 'gaming-journal-contracts/achievements'
import type { JournalSession } from 'gaming-journal-contracts/journalSessions'

// Port of LastSessionCard.svelte. Uses the raw (unfiltered) sessions list sorted by startedAt
// descending — deliberately NOT the same `closedSessions` (>=10min, has endedAt) filter the
// SessionHistoryRail uses, matching the web's real behavior exactly (confirmed by reading both
// components' derived values directly rather than assuming symmetry).
export function LastSessionCard({ sessions, achievements, apiHost }: {
    sessions: JournalSession[]
    achievements: AchievementItem[]
    apiHost: string | undefined
}) {
    const sorted = [...sessions].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    const last = sorted[0] ?? null
    const achMap = new Map(achievements.map(a => [a.apiname, a]))

    const duration = last ? (() => {
        const mins = last.durationMin ?? 0
        return mins >= 60 ? `${(mins / 60).toFixed(1)}h` : `${mins}m`
    })() : ''

    const earned = (last?.achievements ?? []).map(a => ({
        apiname: a.apiname,
        displayName: achMap.get(a.apiname)?.displayName,
        icon: achMap.get(a.apiname)?.icon,
        localIcon: achMap.get(a.apiname)?.localIcon,
    }))

    return (
        <View style={styles.card}>
            <View style={styles.header}>
                <Text style={styles.title}>Last Session</Text>
                {last && <Text style={styles.dateChip}>{fmtDate(last.startedAt)}</Text>}
            </View>
            {!last ? (
                <Text style={styles.noData}>No sessions recorded yet</Text>
            ) : (
                <>
                    <View style={styles.stat}>
                        <Text style={styles.big}>{duration}</Text>
                        <Text style={styles.sublabel}>played</Text>
                    </View>
                    {earned.length > 0 && <Text style={styles.recentLabel}>Earned ({earned.length})</Text>}
                    {earned.length > 0 ? (
                        <AchievementIconRow items={earned} apiHost={apiHost} />
                    ) : (
                        <Text style={styles.noData}>No achievements this session</Text>
                    )}
                </>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    card: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: spacing.md, gap: spacing.sm, minHeight: 140 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    title: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
    dateChip: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    noData: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    stat: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
    big: { color: colors.text, fontFamily: fonts.title, fontSize: 24 },
    sublabel: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    recentLabel: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 10, textTransform: 'uppercase' },
})
