import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { getNowPlaying } from '@/api/sidebar'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { fmtHours } from '@/utils/gameRender'
import type { GameDetail } from 'gaming-journal-contracts/gameDetail'

// Port of HltbSection.svelte. Square-root scaling (not linear) so short/long games both get a
// readable segment width: pct(h) = sqrt(h)/sqrt(maxScale)*100. Below 480px the web swaps the
// proportional bar for stacked mini-bars entirely (`.hltb-bar-wrap{display:none}` /
// `.hltb-mini{display:block}`) — ported as the same breakpoint-driven swap here, not a guess.
const SHORT_LABELS = ['MAIN', 'EXTRAS', 'COMPLETE']

export function HltbSection({ game, onRefresh }: { game: GameDetail; onRefresh: () => Promise<void> }) {
    const breakpoint = useBreakpoint()
    const [refreshing, setRefreshing] = useState(false)
    const [sessionElapsedMin, setSessionElapsedMin] = useState(0)

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

    const maxScale = Math.max(...milestones.map(m => m.h), playerHours > 0 ? playerHours : 0) * 1.08
    const pct = (h: number) => (Math.sqrt(h) / Math.sqrt(maxScale)) * 100
    const showBar = breakpoint !== 'mobilePortrait'

    return (
        <View style={styles.section}>
            <SectionTitle refreshing={refreshing} onRefresh={refresh} />
            {showBar ? (
                <View style={styles.barWrap}>
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
            ) : (
                <View style={styles.mini}>
                    {milestones.map(m => {
                        const done = playerHours >= m.h
                        const fillPct = playerHours > 0 ? Math.min(100, (playerHours / m.h) * 100) : 0
                        return (
                            <View key={m.label} style={styles.miniRow}>
                                <Text style={styles.miniLabel}>{m.label}</Text>
                                <View style={styles.miniTrack}>
                                    <View style={[styles.miniFill, { width: `${fillPct}%` }, done && styles.miniFillDone]} />
                                </View>
                                <Text style={styles.miniValue}>{fmtHours(m.h)}</Text>
                            </View>
                        )
                    })}
                    {playerHours > 0 && <Text style={styles.miniFooter}>{fmtHours(playerHours)} played</Text>}
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

const styles = StyleSheet.create({
    section: { padding: spacing.md },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 16 },
    refreshBtn: { color: colors.textMuted, fontSize: 16 },
    empty: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13 },
    barWrap: { paddingTop: 24 },
    barTrack: { flexDirection: 'row', height: 40, borderRadius: radius, overflow: 'visible', backgroundColor: colors.bgHover },
    segment: {
        backgroundColor: colors.accentBg, justifyContent: 'center', paddingHorizontal: spacing.xs,
        height: '100%', overflow: 'hidden',
    },
    segmentBorder: { borderLeftWidth: 1, borderLeftColor: colors.bg },
    segmentLabel: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 9 },
    segmentValue: { color: colors.text, fontFamily: fonts.ui, fontSize: 10 },
    pin: { position: 'absolute', top: -20, alignItems: 'center', transform: [{ translateX: -20 }] },
    pinLabel: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 9, backgroundColor: colors.bg, paddingHorizontal: 4 },
    mini: { gap: spacing.xs },
    miniRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    miniLabel: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, width: 90 },
    miniTrack: { flex: 1, height: 6, backgroundColor: colors.bgHover, borderRadius: 3, overflow: 'hidden' },
    miniFill: { height: '100%', backgroundColor: colors.accent },
    miniFillDone: { backgroundColor: '#4caf72' },
    miniValue: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 11, width: 44, textAlign: 'right' },
    miniFooter: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, marginTop: spacing.xs },
})
