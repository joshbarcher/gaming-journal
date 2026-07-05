import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Svg, { Line, Path, Polygon } from 'react-native-svg'

import { colors, fonts, radius, spacing } from '@/theme/tokens'
import type { PlayerCounts } from 'gaming-journal-contracts/playerCounts'

// Port of PlayerChart.svelte. The web version renders via Chart.js onto a <canvas> (a global,
// not an importable module) — not portable 1:1. Rebuilt as a real <Svg> line+fill chart using the
// same technique as the existing Sparkline shared component, but with real axis-aware scaling
// (not 0-100 normalized) since this needs a "playing now" header value that must match the
// rendered line's actual endpoint. Granularity windows/buckets and the downsample
// last-sample-per-bucket-wins rule are ported exactly.
const GRANULARITIES = {
    '24h': { windowMs: 24 * 3600_000, bucketMs: 30 * 60_000 },
    '7d':  { windowMs: 7 * 86_400_000, bucketMs: 2 * 3600_000 },
    '30d': { windowMs: 30 * 86_400_000, bucketMs: 6 * 3600_000 },
    '1y':  { windowMs: 365 * 86_400_000, bucketMs: 86_400_000 },
} as const
type Granularity = keyof typeof GRANULARITIES

function fmtPlayerCount(n: number | null | undefined): string {
    if (!n) return '—'
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return n.toLocaleString()
}

function downsample(samples: [number, number][], granularity: Granularity) {
    const { windowMs, bucketMs } = GRANULARITIES[granularity]
    const cutoff = Date.now() - windowMs
    const buckets = new Map<number, number>()
    for (const [tSec, count] of samples) {
        const tMs = tSec * 1000
        if (tMs < cutoff) continue
        const bucket = Math.floor(tMs / bucketMs) * bucketMs
        buckets.set(bucket, count) // last sample in a bucket wins, matches web exactly
    }
    return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([x, y]) => ({ x, y }))
}

export function PlayerChart({ data }: { data: PlayerCounts | null | undefined }) {
    const [granularity, setGranularity] = useState<Granularity>('7d')
    const samples = data?.samples ?? []

    const points = useMemo(() => downsample(samples, granularity), [samples, granularity])
    const latest = samples.length ? samples[samples.length - 1][1] : 0

    if (!samples.length) {
        return (
            <View style={styles.section}>
                <Text style={styles.title}>Player Count</Text>
                <Text style={styles.empty}>No player count data collected yet.</Text>
            </View>
        )
    }

    const width = 100
    const height = 100
    // Chart.js (the web's real charting engine) doesn't set beginAtZero, so its linear y-axis
    // auto-fits to the data's actual min/max range rather than always starting at 0 — important
    // for player-count data, which often fluctuates only a few percent within a large absolute
    // count (confirmed live: ELDEN RING's real samples ranged ~36k-37.5k, a ~4% band that renders
    // as a flat line pinned to the top if the scale starts at 0). Matched here: scale from the
    // window's actual min to max, not 0 to max.
    const minY = Math.min(...points.map(p => p.y))
    const maxY = Math.max(...points.map(p => p.y))
    const spanY = Math.max(maxY - minY, 1)
    const minX = points[0]?.x ?? 0
    const maxX = points[points.length - 1]?.x ?? 1
    const spanX = Math.max(maxX - minX, 1)

    const toX = (x: number) => ((x - minX) / spanX) * width
    const toY = (y: number) => height - ((y - minY) / spanY) * height

    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.x)} ${toY(p.y)}`).join(' ')
    const fillPoints = points.length > 1
        ? `0,${height} ${points.map(p => `${toX(p.x)},${toY(p.y)}`).join(' ')} ${width},${height}`
        : ''

    return (
        <View style={styles.section}>
            <View style={styles.titleRow}>
                <Text style={styles.title}>Player Count</Text>
                <Text style={styles.nowPlaying}>{fmtPlayerCount(latest)} playing now</Text>
            </View>
            <View style={styles.tabsRow}>
                {(Object.keys(GRANULARITIES) as Granularity[]).map(g => (
                    <Pressable key={g} style={[styles.tab, granularity === g && styles.tabActive]} onPress={() => setGranularity(g)}>
                        <Text style={[styles.tabText, granularity === g && styles.tabTextActive]}>{g}</Text>
                    </Pressable>
                ))}
            </View>
            {points.length > 1 ? (
                <View style={styles.chartWrap}>
                    <Svg width="100%" height={140} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
                        {[0.25, 0.5, 0.75].map(f => (
                            <Line key={f} x1={0} x2={width} y1={height * f} y2={height * f} stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />
                        ))}
                        {fillPoints && <Polygon points={fillPoints} fill={colors.accent} fillOpacity={0.12} />}
                        <Path d={linePath} fill="none" stroke={colors.accent} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                    </Svg>
                </View>
            ) : (
                <Text style={styles.empty}>Not enough data for this range.</Text>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    section: { padding: spacing.md },
    titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 16 },
    nowPlaying: { color: colors.accent, fontFamily: fonts.uiBold, fontSize: 12 },
    empty: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13 },
    tabsRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm },
    tab: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius, backgroundColor: colors.bgHover },
    tabActive: { backgroundColor: colors.accentBg, borderWidth: 1, borderColor: colors.borderAct },
    tabText: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    tabTextActive: { color: colors.accent, fontFamily: fonts.uiBold },
    chartWrap: { backgroundColor: colors.bgHover, borderRadius: radius, overflow: 'hidden' },
})
