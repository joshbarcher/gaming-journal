import Svg, { Path } from 'react-native-svg'

// Port of TopGames.svelte's sparkline() function — same downsampling (≤30 evenly-sampled points),
// same min/max normalization to a 0-100 Y range, same non-scaling-stroke technique so the line
// weight stays constant regardless of viewport width. The web version builds this as a raw SVG
// string injected via {@html} — that specific technique doesn't exist in RN, so this builds real
// <Svg>/<Path> components instead, but the underlying math is identical.
export function Sparkline({
    samples,
    width = 88,
    height = 28,
    color = '#c9a84c',
}: {
    samples: [number, number][] | null | undefined
    width?: number
    height?: number
    color?: string
}) {
    if (!samples?.length) return null

    const raw = samples.map(s => s[1])
    const MAX = 30
    const vals = raw.length <= MAX
        ? raw
        : Array.from({ length: MAX }, (_, i) => raw[Math.round((i * (raw.length - 1)) / (MAX - 1))])

    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const range = max - min
    const n = vals.length
    const toY = (v: number) => (range === 0 ? 50 : +(100 - ((v - min) / range) * 100).toFixed(2))

    const d = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${i} ${toY(v)}`).join(' ')

    return (
        <Svg width={width} height={height} viewBox={`0 0 ${Math.max(n - 1, 1)} 100`} preserveAspectRatio="none">
            <Path d={d} fill="none" stroke={color} strokeWidth={2} strokeOpacity={0.8} vectorEffect="non-scaling-stroke" />
        </Svg>
    )
}
