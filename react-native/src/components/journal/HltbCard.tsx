import { LinearGradient } from 'expo-linear-gradient'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { colors, fonts, spacing } from '@/theme/tokens'
import { fmtHours } from '@/utils/gameRender'
import type { GameDetail } from 'gaming-journal-contracts/gameDetail'

// Port of JournalDashboard.svelte's HLTB card (public/css/game.css .hltb-*). Segments are positioned
// CUMULATIVELY — each one starts at the previous milestone's mark and the last extends to 100% — so
// MAIN / EXTRAS / COMPLETE tile the track 0→100% (they are NOT laid out in a flex row, which made the
// widths sum past 100% and pushed COMPLETE off-screen). A gold `hltb-fill` runs 0→the played mark.
// Same sqrt scale as HltbSection; no refresh button (the web dashboard's HLTB card never had one).
const HLTB_SHORT_LABELS = ['MAIN', 'EXTRAS', 'COMPLETE']

export function HltbCard({ game }: { game: GameDetail }) {
    const [pinWidth, setPinWidth] = useState(0)

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

    // Sqrt scale — prevents wide ranges from clustering left. Matches JournalDashboard.svelte exactly.
    const maxScale = Math.max(...milestones.map(m => m.h), ...(playerHours > 0 ? [playerHours] : [])) * 1.08
    const pct = (h: number) => (Math.sqrt(h) / Math.sqrt(maxScale)) * 100

    const pinPct = playerHours > 0 ? pct(playerHours) : null
    const fillPct = pinPct ?? pct(milestones[0].h)

    const segments = milestones.map((m, i) => {
        const leftPct = i === 0 ? 0 : pct(milestones[i - 1].h)
        const isLast = i === milestones.length - 1
        return {
            shortLabel: HLTB_SHORT_LABELS[i] ?? m.label.toUpperCase(),
            h: m.h,
            leftPct,
            widthPct: (isLast ? 100 : pct(m.h)) - leftPct,
        }
    })

    return (
        <View style={styles.card}>
            <View style={styles.barWrap}>
                {pinPct != null && (
                    <View
                        style={[styles.pin, { left: `${pinPct}%`, transform: [{ translateX: -pinWidth / 2 }] }]}
                        onLayout={e => setPinWidth(e.nativeEvent.layout.width)}
                    >
                        <Text style={styles.pinLabel}>{fmtHours(playerHours)} played</Text>
                        <View style={styles.pinArrow} />
                    </View>
                )}
                <View style={styles.track}>
                    <LinearGradient
                        colors={['#a07828', '#c9a84c']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={[styles.fill, { width: `${fillPct}%` }]}
                    />
                    {segments.map((seg, i) => (
                        i > 0 ? <View key={`d${i}`} style={[styles.divider, { left: `${seg.leftPct}%` }]} /> : null
                    ))}
                    {segments.map((seg, i) => (
                        <View key={`s${i}`} style={[styles.segment, { left: `${seg.leftPct}%`, width: `${seg.widthPct}%` }]}>
                            <Text style={styles.segLabel}>{seg.shortLabel}</Text>
                            <Text style={styles.segHours}>{fmtHours(seg.h)}</Text>
                        </View>
                    ))}
                </View>
            </View>
        </View>
    )
}

const SEG_SHADOW = { textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 } as const

const styles = StyleSheet.create({
    card: { backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: spacing.md },
    noData: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12 },
    // .hltb-bar-wrap — 34px of headroom above the track for the pin bubble.
    barWrap: { position: 'relative' },
    // .hltb-pin — gold pill floated above the played mark, centered via measured translateX.
    pin: { position: 'absolute', top: 2, alignItems: 'center', zIndex: 10 },
    pinLabel: {
        backgroundColor: colors.accent, color: '#fff', fontFamily: fonts.uiBold, fontSize: 11,
        paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, overflow: 'hidden',
    },
    pinArrow: {
        width: 0, height: 0, borderStyle: 'solid',
        borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 5,
        borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: colors.accent,
    },
    // .hltb-track — the dark bar that clips the fill.
    track: { position: 'relative', height: 36, marginTop: 34, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 6, overflow: 'hidden' },
    // .hltb-fill — gold played bar from 0 to the played mark.
    fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
    // .hltb-seg-divider — thin separators at each milestone boundary.
    divider: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.13)', zIndex: 2 },
    // .hltb-segment — label + hours centered within each cumulative cell.
    segment: { position: 'absolute', top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 6, zIndex: 3, overflow: 'hidden' },
    segLabel: { fontFamily: fonts.uiBold, fontSize: 9, letterSpacing: 1, color: '#fff', ...SEG_SHADOW },
    segHours: { fontFamily: fonts.ui, fontSize: 11, color: '#fff', ...SEG_SHADOW },
})
