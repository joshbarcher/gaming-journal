import { StyleSheet, Text, View } from 'react-native'

import { colors, fonts, spacing } from '@/theme/tokens'
import { fmtHours } from '@/utils/gameRender'
import type { GameDetail } from 'gaming-journal-contracts/gameDetail'

// Port of JournalDashboard.svelte's HLTB card — same square-root-scale math as HltbSection (Game
// detail screen), but no refresh button here (the dashboard's own HLTB card never had one on the
// web either — confirmed by reading the source, not assumed for symmetry) and no separate
// mobile-mini-bar variant needed, since the whole dashboard is already single-column stacked at
// every required breakpoint (per game-journal.css's own ≤1279px collapse-to-one-column rule).
const SHORT_LABELS = ['MAIN', 'EXTRAS', 'COMPLETE']

export function HltbCard({ game }: { game: GameDetail }) {
    const hltb = game.hltb
    const milestones = hltb?.matched
        ? ([
            hltb.gameplayMain != null && hltb.gameplayMain > 0 ? { label: 'Main', h: hltb.gameplayMain } : null,
            hltb.gameplayMainExtra != null && hltb.gameplayMainExtra > 0 ? { label: 'Main + Extras', h: hltb.gameplayMainExtra } : null,
            hltb.gameplayCompletionist != null && hltb.gameplayCompletionist > 0 ? { label: 'Completionist', h: hltb.gameplayCompletionist } : null,
        ].filter((m): m is { label: string; h: number } => m != null))
        : []

    const playerHours = (game.playtimeMinutes ?? 0) / 60

    if (!milestones.length) {
        return (
            <View style={styles.card}>
                <Text style={styles.noData}>
                    {playerHours > 0 ? `Played ${fmtHours(playerHours)} — no HLTB data` : 'No playtime or HLTB data'}
                </Text>
            </View>
        )
    }

    const maxScale = Math.max(...milestones.map(m => m.h), playerHours > 0 ? playerHours : 0) * 1.08
    const pct = (h: number) => (Math.sqrt(h) / Math.sqrt(maxScale)) * 100

    return (
        <View style={styles.card}>
            <View style={styles.barTrack}>
                {milestones.map((m, i) => (
                    <View key={m.label} style={[styles.segment, { width: `${pct(m.h)}%` }, i > 0 && styles.segmentBorder]}>
                        <Text style={styles.segmentLabel}>{SHORT_LABELS[i] ?? m.label.toUpperCase()}</Text>
                        <Text style={styles.segmentValue}>{fmtHours(m.h)}</Text>
                    </View>
                ))}
                {playerHours > 0 && (
                    <View style={[styles.pin, { left: `${Math.min(pct(playerHours), 100)}%` }]}>
                        <Text style={styles.pinLabel}>{fmtHours(playerHours)} played</Text>
                    </View>
                )}
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    card: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: spacing.md, paddingTop: 24 },
    noData: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    barTrack: { flexDirection: 'row', height: 40, borderRadius: 4, overflow: 'visible', backgroundColor: colors.bgHover },
    segment: { backgroundColor: colors.accentBg, justifyContent: 'center', paddingHorizontal: spacing.xs, height: '100%', overflow: 'hidden' },
    segmentBorder: { borderLeftWidth: 1, borderLeftColor: colors.bg },
    segmentLabel: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 9 },
    segmentValue: { color: colors.text, fontFamily: fonts.ui, fontSize: 10 },
    pin: { position: 'absolute', top: -20, alignItems: 'center', transform: [{ translateX: -20 }] },
    pinLabel: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 9, backgroundColor: colors.bg, paddingHorizontal: 4 },
})
