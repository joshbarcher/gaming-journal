import { LinearGradient } from 'expo-linear-gradient'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { getNowPlaying } from '@/api/sidebar'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { colors, fonts, spacing } from '@/theme/tokens'
import { fmtHours } from '@/utils/gameRender'
import type { GameDetail } from 'gaming-journal-contracts/gameDetail'

// Port of src/lib/svelte/game/HltbSection.svelte (styles: public/css/game.css `.hltb-*`). Rebuilt to
// match the web exactly, reusing the CORRECT bar approach already shipped in journal/HltbCard.tsx:
//
//   • Segments are positioned CUMULATIVELY (absolute left/width), each starting at the previous
//     milestone's mark and the last extending to 100% — they tile the track 0→100%. The old game-page
//     version laid them out in a flex ROW with `width:pct(h)%`, whose widths sum past 100% and pushed
//     COMPLETE off-screen (only MAIN/EXTRAS were visible — the R2-8 bug).
//   • A GOLD gradient `.hltb-fill` (#a07828 → #c9a84c) runs 0→the played mark. The old version had no
//     fill at all (faint accentBg segments), which is the "missing gold bar" complaint.
//   • The played "Xh played" pin is a GOLD PILL with a downward arrow, floated above the played mark
//     and centred via a measured translateX(-width/2) — not raw gold text at a fixed -20px offset.
//   • Track height 36 (was 40), white segment text with a shadow (was gold-on-faint) — matching the
//     web's `.hltb-track` / `.hltb-seg-*` rules.
//
// Kept from the game-page original: the section title + refresh button, the live "currently playing"
// tick, and the ≤479px mini-bar swap (the web hides the horizontal track and shows stacked mini-bars).
const SHORT_LABELS = ['MAIN', 'EXTRAS', 'COMPLETE']

export function HltbSection({ game, onRefresh }: { game: GameDetail; onRefresh: () => Promise<void> }) {
    const breakpoint = useBreakpoint()
    const [refreshing, setRefreshing] = useState(false)
    const [sessionElapsedMin, setSessionElapsedMin] = useState(0)
    const [pinWidth, setPinWidth] = useState(0)

    const hltb = game.hltb
    const milestones = hltb?.matched
        ? ([
            hltb.gameplayMain != null && hltb.gameplayMain > 0 ? { label: 'Main', h: hltb.gameplayMain } : null,
            hltb.gameplayMainExtra != null && hltb.gameplayMainExtra > 0 ? { label: 'Main + Extras', h: hltb.gameplayMainExtra } : null,
            hltb.gameplayCompletionist != null && hltb.gameplayCompletionist > 0 ? { label: 'Completionist', h: hltb.gameplayCompletionist } : null,
        ].filter((m): m is { label: string; h: number } => m != null))
        : []

    // Live "currently playing" ticking — only if hltb.matched, matching the web's own gate.
    useEffect(() => {
        if (!hltb?.matched) return
        let interval: ReturnType<typeof setInterval> | undefined
        const mountedAt = Date.now()
        getNowPlaying().then(np => {
            if (np?.playing?.appid === game.appid) {
                interval = setInterval(() => {
                    setSessionElapsedMin(Math.floor((Date.now() - mountedAt) / 60000))
                }, 30_000)
            }
        }).catch(() => {})
        return () => { if (interval) clearInterval(interval) }
    }, [hltb?.matched, game.appid])

    const basePlaytimeMin = game.playtimeMinutes ?? 0
    const playerHours = (basePlaytimeMin + sessionElapsedMin) / 60

    async function refresh() {
        if (refreshing) return
        setRefreshing(true)
        try { await onRefresh() } finally { setRefreshing(false) }
    }

    if (!milestones.length) {
        return (
            <View style={styles.section}>
                <SectionTitle refreshing={refreshing} onRefresh={refresh} />
                <Text style={styles.empty}>No data available for this game.</Text>
            </View>
        )
    }

    // Sqrt scale (not linear) so short/long games both get a readable segment — matches the web exactly.
    const maxScale = Math.max(...milestones.map(m => m.h), ...(playerHours > 0 ? [playerHours] : [])) * 1.08
    const pct = (h: number) => (Math.sqrt(h) / Math.sqrt(maxScale)) * 100

    const pinPct = playerHours > 0 ? pct(playerHours) : null
    const fillPct = pinPct ?? pct(milestones[0].h)

    const segments = milestones.map((m, i) => {
        const leftPct = i === 0 ? 0 : pct(milestones[i - 1].h)
        const isLast = i === milestones.length - 1
        return {
            shortLabel: SHORT_LABELS[i] ?? m.label.toUpperCase(),
            h: m.h,
            leftPct,
            widthPct: (isLast ? 100 : pct(m.h)) - leftPct,
        }
    })

    const showBar = breakpoint !== 'mobilePortrait'

    return (
        <View style={styles.section}>
            <SectionTitle refreshing={refreshing} onRefresh={refresh} />
            {showBar ? (
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
            ) : (
                <View style={styles.mini}>
                    {milestones.map(m => {
                        const done = playerHours >= m.h
                        const fillW = playerHours > 0 ? Math.min(100, (playerHours / m.h) * 100) : 0
                        return (
                            <View key={m.label} style={styles.miniRow}>
                                <Text style={styles.miniLabel}>{m.label}</Text>
                                <View style={styles.miniTrack}>
                                    <LinearGradient
                                        colors={done ? ['#c9a84c', '#c9a84c'] : ['#c9a84c', 'rgba(201,168,76,0.40)']}
                                        start={{ x: 0, y: 0 }}
                                        end={{ x: 1, y: 0 }}
                                        style={[styles.miniFill, { width: `${fillW}%` }, done && styles.miniFillDone]}
                                    />
                                </View>
                                <Text style={styles.miniValue}>{fmtHours(m.h)}</Text>
                            </View>
                        )
                    })}
                    {playerHours > 0 && <Text style={styles.miniPlayed}>{fmtHours(playerHours)} played</Text>}
                </View>
            )}
        </View>
    )
}

function SectionTitle({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: () => void }) {
    return (
        <View style={styles.titleRow}>
            <Text style={styles.title}>How Long To Beat</Text>
            <Pressable onPress={onRefresh} disabled={refreshing} hitSlop={8}>
                <Text style={styles.refreshBtn}>{refreshing ? '⟳' : '↻'}</Text>
            </Pressable>
        </View>
    )
}

const SEG_SHADOW = { textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 } as const

const styles = StyleSheet.create({
    section: { padding: spacing.md },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 16 },
    refreshBtn: { color: colors.textMuted, fontSize: 16 },
    empty: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, fontStyle: 'italic' },

    // .hltb-bar-wrap — 34px of headroom above the track for the pin bubble.
    barWrap: { position: 'relative' },
    // .hltb-pin — gold pill floated above the played mark, centred via measured translateX.
    pin: { position: 'absolute', top: 2, alignItems: 'center', zIndex: 10 },
    pinLabel: {
        backgroundColor: colors.accent, color: '#fff', fontFamily: fonts.uiBold, fontSize: 11,
        paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, overflow: 'hidden',
        textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
    },
    pinArrow: {
        width: 0, height: 0, borderStyle: 'solid',
        borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 5,
        borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: colors.accent,
    },
    // .hltb-track — dark bar (height 36) that clips the gold fill.
    track: { position: 'relative', height: 36, marginTop: 34, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 6, overflow: 'hidden' },
    // .hltb-fill — gold played bar from 0 to the played mark.
    fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
    // .hltb-seg-divider — thin separators at each milestone boundary.
    divider: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(255,255,255,0.13)', zIndex: 2 },
    // .hltb-segment — label + hours centred within each cumulative cell.
    segment: { position: 'absolute', top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 6, zIndex: 3, overflow: 'hidden' },
    segLabel: { fontFamily: fonts.uiBold, fontSize: 9, letterSpacing: 1, color: '#fff', ...SEG_SHADOW },
    segHours: { fontFamily: fonts.ui, fontSize: 11, color: '#fff', ...SEG_SHADOW },

    // .hltb-mini — ≤479px stacked substitute for the horizontal track.
    mini: { gap: 0 },
    miniRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
    miniLabel: { width: 90, fontFamily: fonts.ui, fontSize: 11, color: 'rgba(237,233,223,0.45)' },
    miniTrack: { flex: 1, height: 5, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' },
    miniFill: { height: '100%', borderRadius: 3 },
    miniFillDone: { opacity: 0.85 },
    miniValue: { width: 36, textAlign: 'right', fontFamily: fonts.uiBold, fontSize: 11, color: 'rgba(237,233,223,0.65)' },
    miniPlayed: { marginTop: 4, fontFamily: fonts.uiBold, fontSize: 11, color: colors.accent },
})
