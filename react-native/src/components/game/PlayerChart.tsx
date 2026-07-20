import { useMemo, useState } from 'react'
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native'
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg'

import { colors, fonts, radius, spacing } from '@/theme/tokens'
import type { PlayerCounts } from 'gaming-journal-contracts/playerCounts'

// Port of PlayerChart.svelte. The web version renders via Chart.js onto a <canvas> (a global,
// not an importable module) — not portable 1:1. Rebuilt as a real <Svg> line+fill chart with the
// same axis-aware scaling Chart.js uses (linear y with beginAtZero:false → "nice"-rounded bounds
// around the data's actual min/max), plus the x/y gridlines and tick labels Chart.js draws
// (grid color rgba(255,255,255,0.06); ticks rgba(255,255,255,0.35) at 10px — see the scales.x /
// scales.y config in PlayerChart.svelte:70-73). Granularity windows/buckets, the downsample
// last-sample-per-bucket-wins rule, and the fmtLabel per-granularity formatting are ported exactly.
//
// The 24h/7d/30d/1y range filters sit in the `.pc-header` row (right side), opposite the
// "N playing now" count — matching game.css:1573-1598's `justify-content: space-between` header
// rather than a standalone tab strip under the title.
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

// Per-granularity x-axis label formatting, ported from PlayerChart.svelte:34-39.
function fmtLabel(tMs: number, key: Granularity): string {
    const d = new Date(tMs)
    if (key === '24h') return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    if (key === '7d') return d.toLocaleDateString(undefined, { weekday: 'short', hour: '2-digit' })
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// "Nice" axis ticks, emulating Chart.js's linear-scale tick generation so gridlines/labels land on
// rounded values (10/20/50 × 10ⁿ) and the axis bounds round out to enclose the data.
function niceNum(range: number, round: boolean): number {
    const exp = Math.floor(Math.log10(range))
    const frac = range / Math.pow(10, exp)
    let nf: number
    if (round) nf = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10
    else nf = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10
    return nf * Math.pow(10, exp)
}
function niceTicks(min: number, max: number, count: number): number[] {
    const range = niceNum(Math.max(max - min, 1), false)
    const step = niceNum(range / Math.max(count - 1, 1), true)
    const niceMin = Math.floor(min / step) * step
    const niceMax = Math.ceil(max / step) * step
    const ticks: number[] = []
    for (let v = niceMin; v <= niceMax + step * 0.5; v += step) ticks.push(Math.round(v))
    return ticks
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

const CHART_H = 200 // web .pc-chart-wrap height: 200px
const PAD_L = 46    // y-axis label gutter
const PAD_R = 10
const PAD_T = 10
const PAD_B = 22    // x-axis label gutter
const GRID = 'rgba(255,255,255,0.06)'
const TICK = 'rgba(255,255,255,0.35)'

export function PlayerChart({ data }: { data: PlayerCounts | null | undefined }) {
    const [granularity, setGranularity] = useState<Granularity>('7d')
    const [chartW, setChartW] = useState(0)
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

    const dataMin = points.length ? Math.min(...points.map(p => p.y)) : 0
    const dataMax = points.length ? Math.max(...points.map(p => p.y)) : 1
    const yTicks = niceTicks(dataMin, dataMax, 5)
    const axisMin = yTicks[0]
    const axisMax = yTicks[yTicks.length - 1]
    const spanY = Math.max(axisMax - axisMin, 1)
    const minX = points[0]?.x ?? 0
    const maxX = points[points.length - 1]?.x ?? 1
    const spanX = Math.max(maxX - minX, 1)

    const plotW = Math.max(0, chartW - PAD_L - PAD_R)
    const plotH = CHART_H - PAD_T - PAD_B
    const baseY = PAD_T + plotH
    const toX = (x: number) => PAD_L + ((x - minX) / spanX) * plotW
    const toY = (y: number) => PAD_T + (1 - (y - axisMin) / spanY) * plotH

    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.x).toFixed(2)} ${toY(p.y).toFixed(2)}`).join(' ')
    const fillPath = points.length > 1
        ? `M${toX(points[0].x).toFixed(2)} ${baseY} ` +
          points.map(p => `L${toX(p.x).toFixed(2)} ${toY(p.y).toFixed(2)}`).join(' ') +
          ` L${toX(points[points.length - 1].x).toFixed(2)} ${baseY} Z`
        : ''

    // x ticks: evenly spaced sample points, thinned to what fits (Chart.js maxTicksLimit 8 / no rotation).
    const xTickCount = Math.max(2, Math.min(points.length, 7, Math.floor(plotW / 90) || 2))
    const xTicks = Array.from({ length: xTickCount }, (_, k) => points[Math.round((k * (points.length - 1)) / (xTickCount - 1))])

    return (
        <View style={styles.section}>
            <Text style={styles.title}>Player Count</Text>
            <View style={styles.pcHeader}>
                <Text style={styles.pcCurrent}>
                    {fmtPlayerCount(latest)} <Text style={styles.pcLabel}>playing now</Text>
                </Text>
                <View style={styles.pcTabs}>
                    {(Object.keys(GRANULARITIES) as Granularity[]).map(g => (
                        <Pressable key={g} style={[styles.tab, granularity === g && styles.tabActive]} onPress={() => setGranularity(g)}>
                            <Text style={[styles.tabText, granularity === g && styles.tabTextActive]}>{g}</Text>
                        </Pressable>
                    ))}
                </View>
            </View>
            {points.length > 1 ? (
                <View style={styles.chartWrap} onLayout={(e: LayoutChangeEvent) => setChartW(e.nativeEvent.layout.width)}>
                    {chartW > 0 && (
                        <Svg width={chartW} height={CHART_H}>
                            {/* Horizontal gridlines + y (count) axis labels */}
                            {yTicks.map(t => (
                                <Line key={`yg${t}`} x1={PAD_L} x2={PAD_L + plotW} y1={toY(t)} y2={toY(t)} stroke={GRID} strokeWidth={1} />
                            ))}
                            {yTicks.map(t => (
                                <SvgText key={`yl${t}`} x={PAD_L - 6} y={toY(t) + 3} fill={TICK} fontSize={10} textAnchor="end">
                                    {fmtPlayerCount(t)}
                                </SvgText>
                            ))}
                            {/* Vertical gridlines + x (time) axis labels */}
                            {xTicks.map((p, i) => (
                                <Line key={`xg${i}`} x1={toX(p.x)} x2={toX(p.x)} y1={PAD_T} y2={baseY} stroke={GRID} strokeWidth={1} />
                            ))}
                            {xTicks.map((p, i) => (
                                <SvgText key={`xl${i}`} x={toX(p.x)} y={CHART_H - 7} fill={TICK} fontSize={10} textAnchor="middle">
                                    {fmtLabel(p.x, granularity)}
                                </SvgText>
                            ))}
                            {fillPath ? <Path d={fillPath} fill={colors.accent} fillOpacity={0.1} /> : null}
                            <Path d={linePath} fill="none" stroke={colors.accent} strokeWidth={1.5} />
                        </Svg>
                    )}
                </View>
            ) : (
                <Text style={styles.empty}>Not enough data for this range.</Text>
            )}
        </View>
    )
}

const styles = StyleSheet.create({
    section: { padding: spacing.md },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 16, marginBottom: spacing.sm },
    empty: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13 },
    // Web .pc-header: flex row, space-between, wrap, 14px bottom margin (game.css:1573).
    pcHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
    // Web .pc-current: 22px/700; label .pc-current-label: 13px/400 muted (game.css:1582).
    pcCurrent: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 22 },
    pcLabel: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13 },
    // Web .pc-tabs: flex row, 4px gap (game.css:1595).
    pcTabs: { flexDirection: 'row', gap: 4 },
    // Web .pc-tab: 5/12 padding, 1px border, transparent, muted 12px/600 (game.css:1600).
    tab: { paddingVertical: 5, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: radius, backgroundColor: 'transparent' },
    tabActive: { borderColor: colors.accent, backgroundColor: colors.accentBg },
    tabText: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 12 },
    tabTextActive: { color: colors.accent },
    // Web .pc-chart-wrap: 200px tall, no background (transparent; game.css:1624).
    chartWrap: { height: CHART_H, position: 'relative' },
})
