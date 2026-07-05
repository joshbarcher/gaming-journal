import { ScrollView, StyleSheet, Text, View } from 'react-native'

import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { chipColor, fmtAchs, fmtDate, fmtDur } from '@/utils/journalRender'
import type { JournalSession } from 'gaming-journal-contracts/journalSessions'

// Port of SessionHistoryRail.svelte. Only shows closedSessions (endedAt present, durationMin>=10)
// — filtered by the caller (JournalDashboard screen), matching the web's separation from
// LastSessionCard's unfiltered "most recent session regardless of length" logic.
export function SessionHistoryRail({ sessions }: { sessions: JournalSession[] }) {
    return (
        <View style={styles.card}>
            <View style={styles.header}>
                <Text style={styles.title}>Past Sessions</Text>
                <Text style={styles.count}>{sessions.length} total</Text>
            </View>
            {sessions.length === 0 ? (
                <Text style={styles.noData}>No sessions recorded yet</Text>
            ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {sessions.slice(0, 30).map((s, i) => {
                        const mins = s.durationMin ?? 0
                        const achs = s.achievements?.length ?? 0
                        const color = chipColor(s.startedAt)
                        return (
                            <View key={i} style={[styles.chip, { backgroundColor: color.bg, borderColor: color.border }]}>
                                <Text style={styles.chipWhen}>{fmtDate(s.startedAt)}</Text>
                                <Text style={styles.chipDur}>{mins ? fmtDur(mins) : '—'}</Text>
                                <Text style={styles.chipAchs}>{fmtAchs(achs)}</Text>
                            </View>
                        )
                    })}
                </ScrollView>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    card: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: spacing.md, gap: spacing.sm },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    title: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
    count: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    noData: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    chip: { width: 110, borderWidth: 1, borderRadius: radius, padding: spacing.sm, marginRight: spacing.xs, gap: 2 },
    chipWhen: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 11 },
    chipDur: { color: colors.text, fontFamily: fonts.ui, fontSize: 13 },
    chipAchs: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 10 },
})
