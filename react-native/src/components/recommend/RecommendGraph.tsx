import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
    Easing,
    useAnimatedProps,
    useSharedValue,
    withDelay,
    withSpring,
    withTiming,
} from 'react-native-reanimated'
import Svg, {
    Circle,
    ClipPath,
    Defs,
    G,
    Image as SvgImage,
    LinearGradient,
    Path,
    Rect,
    Stop,
    Text as SvgText,
} from 'react-native-svg'

import { fonts } from '@/theme/tokens'
import type { RecommendGame, RecommendQuestion } from 'gaming-journal-contracts/recommend'

// Faithful port of the web's src/lib/svelte/recommend/RecommendGraph.svelte (+ ElbowEdge /
// GraphNode / GameResultNode sub-components) using react-native-svg. This is the DESKTOP-tier
// presentation the web renders for anything wider than a phone: a radial node graph with a center
// node, option nodes on an arc, elbow-routed per-question-type-colored edges, and game-result nodes
// with header art. The phone (mobilePortrait) fallback keeps the stacked list in recommend.tsx.
// The data flow (state machine + POST /recommend) is unchanged — this only swaps the presentation.

const AnimatedG = Animated.createAnimatedComponent(G)
const AnimatedPath = Animated.createAnimatedComponent(Path)

// ── Canvas dimensions (mirror the web viewBox) ──────────────────────────────
const VW = 1000
const VH = 640
const CX = VW / 2
const CY = VH / 2
const OPTION_R = 230 // radius for option nodes
const GAME_R = 260 // radius for game result nodes

// Edge / node color keyed by the current question type (verbatim from the web).
const TYPE_COLORS: Record<string, string> = {
    genre: '#c9a84c', // gold — app accent
    length: '#4ecdc4', // teal — app progress
    tags: '#e07b54', // terracotta
    era: '#a8956a', // muted amber
    popularity: '#7db5d8', // dusty blue
    status: '#c17aad', // muted mauve
    metacritic: '#d4904a', // burnt amber
    center: '#ede9df', // warm white
}

// ── Layout helpers (verbatim from the web) ──────────────────────────────────
function optionPositions(count: number, radius: number): { x: number; y: number }[] {
    if (count === 0) return []

    if (count <= 3) {
        // Symmetric arc centred at top (−π/2), spread ~120° per step.
        const spread = (count - 1) * (Math.PI / 3)
        const startAngle = -Math.PI / 2 - spread / 2
        return Array.from({ length: count }, (_, i) => {
            const a = count === 1 ? -Math.PI / 2 : startAngle + (i * spread) / (count - 1)
            return { x: CX + Math.cos(a) * radius, y: CY + Math.sin(a) * radius }
        })
    }

    // Full circle, starting at top.
    return Array.from({ length: count }, (_, i) => {
        const a = -Math.PI / 2 + (i / count) * Math.PI * 2
        return { x: CX + Math.cos(a) * radius, y: CY + Math.sin(a) * radius }
    })
}

function splitLabel(text: string, maxLen = 14): [string, string] {
    const parenIdx = text.indexOf('(')
    if (parenIdx > 1) return [text.slice(0, parenIdx).trim(), text.slice(parenIdx)]
    if (text.length <= maxLen) return [text, '']
    const idx = text.lastIndexOf(' ', maxLen)
    if (idx < 1) return [text.slice(0, maxLen), text.slice(maxLen).trim()]
    return [text.slice(0, idx), text.slice(idx + 1)]
}

function splitName(text: string): [string, string] {
    if (text.length <= 18) return [text, '']
    const idx = text.lastIndexOf(' ', 18)
    if (idx < 1) return [text.slice(0, 18), text.slice(18).trim()]
    return [text.slice(0, idx), text.slice(idx + 1)]
}

// A stable elbow offset per index (the web randomizes 0.3–0.7 once per layout; a deterministic
// value avoids re-jiggling the knees on every React render while staying in the same band).
const elbowOffset = (i: number) => 0.35 + (i % 3) * 0.1

// SVG text has no reliable cross-platform dominant-baseline="middle"; approximate vertical centering
// by dropping the baseline ~0.34em below the intended center (matches the web's centered glyphs).
const baseY = (center: number, fontSize: number) => center + fontSize * 0.34

type NodePhase = 'entering' | 'idle' | 'chosen' | 'dismissed'

// ── Elbow edge ──────────────────────────────────────────────────────────────
function ElbowEdge({
    x1,
    y1,
    x2,
    y2,
    elbowT,
    color,
    visible,
    delay,
}: {
    x1: number
    y1: number
    x2: number
    y2: number
    elbowT: number
    color: string
    visible: boolean
    delay: number
}) {
    const knee = x1 + (x2 - x1) * elbowT
    const d = `M ${x1} ${y1} L ${knee} ${y1} L ${knee} ${y2} L ${x2} ${y2}`
    const opacity = useSharedValue(0)

    useEffect(() => {
        opacity.value = withDelay(delay, withTiming(visible ? 0.45 : 0, { duration: 300 }))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    useEffect(() => {
        opacity.value = withTiming(visible ? 0.45 : 0, { duration: 250 })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible])

    const animatedProps = useAnimatedProps(() => ({ opacity: opacity.value }))

    return (
        <AnimatedPath
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            animatedProps={animatedProps}
        />
    )
}

// ── Graph node (center + option) ────────────────────────────────────────────
function GraphNode({
    x,
    y,
    label,
    subLabel = '',
    filterType = 'center',
    isCenter = false,
    phase = 'idle',
    delay = 0,
    onPress,
}: {
    x: number
    y: number
    label: string
    subLabel?: string
    filterType?: string
    isCenter?: boolean
    phase?: NodePhase
    delay?: number
    onPress?: () => void
}) {
    const color = TYPE_COLORS[filterType] ?? '#818cf8'
    const radius = isCenter ? 68 : 50
    const [line1, line2] = splitLabel(label, 14)
    const labelFs = isCenter ? 15 : 12

    const opacity = useSharedValue(0)
    const scale = useSharedValue(0.3)

    useEffect(() => {
        opacity.value = withDelay(delay, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }))
        scale.value = withDelay(delay, withSpring(1, { damping: 12, stiffness: 150, mass: 0.6 }))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    useEffect(() => {
        if (phase === 'chosen') {
            scale.value = withTiming(1.15, { duration: 200 })
        } else if (phase === 'dismissed') {
            opacity.value = withTiming(0, { duration: 250 })
            scale.value = withTiming(0.4, { duration: 250 })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase])

    const animatedProps = useAnimatedProps(() => ({ opacity: opacity.value, scale: scale.value }))

    return (
        <AnimatedG originX={x} originY={y} animatedProps={animatedProps} onPress={onPress}>
            {isCenter && (
                <>
                    <Circle cx={x} cy={y} r={radius + 12} fill="none" stroke={color} strokeWidth={1} opacity={0.2} />
                    <Circle cx={x} cy={y} r={radius + 6} fill="none" stroke={color} strokeWidth={1} opacity={0.35} />
                </>
            )}

            <Circle
                cx={x}
                cy={y}
                r={radius}
                fill={isCenter ? 'rgba(19,18,16,0.96)' : 'rgba(27,25,22,0.92)'}
                stroke={color}
                strokeWidth={isCenter ? 2 : 1.5}
            />

            {isCenter && !!subLabel && (
                <SvgText
                    x={x}
                    y={baseY(y - radius * 0.55, 9)}
                    fill="rgba(237,233,223,0.45)"
                    fontSize={9}
                    fontFamily={fonts.ui}
                    textAnchor="middle"
                >
                    {subLabel.toUpperCase()}
                </SvgText>
            )}

            <SvgText
                x={x}
                y={baseY(line2 ? y - 8 : y, labelFs)}
                fill="#ede9df"
                fontSize={labelFs}
                fontFamily={isCenter ? fonts.uiBold : fonts.ui}
                textAnchor="middle"
            >
                {line1}
            </SvgText>
            {!!line2 && (
                <SvgText
                    x={x}
                    y={baseY(y + 10, labelFs)}
                    fill="#ede9df"
                    fontSize={labelFs}
                    fontFamily={isCenter ? fonts.uiBold : fonts.ui}
                    textAnchor="middle"
                >
                    {line2}
                </SvgText>
            )}

            {!isCenter && !!subLabel && (
                <SvgText
                    x={x}
                    y={baseY(y + radius * 0.65, 10)}
                    fill="rgba(237,233,223,0.35)"
                    fontSize={10}
                    fontFamily={fonts.ui}
                    textAnchor="middle"
                >
                    {subLabel}
                </SvgText>
            )}
        </AnimatedG>
    )
}

// ── Game result node ────────────────────────────────────────────────────────
function GameResultNode({
    x,
    y,
    appid,
    name,
    header,
    apiHost,
    phase,
    delay,
    onPress,
}: {
    x: number
    y: number
    appid: number
    name: string
    header: string | null
    apiHost: string | undefined
    phase: NodePhase
    delay: number
    onPress: () => void
}) {
    const W = 150
    const H = 70
    const host = apiHost ?? ''
    const imgUrl = header ? `${host}${header}` : `${host}/relay/images/steam/games/${appid}/header.jpg`
    const [line1, line2] = splitName(name)
    const clipId = `poster-clip-${appid}`
    const scrimId = `poster-scrim-${appid}`

    const opacity = useSharedValue(0)
    const scale = useSharedValue(0.3)

    useEffect(() => {
        opacity.value = withDelay(delay, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }))
        scale.value = withDelay(delay, withSpring(1, { damping: 12, stiffness: 150, mass: 0.6 }))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    useEffect(() => {
        if (phase === 'dismissed') {
            opacity.value = withTiming(0, { duration: 200 })
            scale.value = withTiming(0.4, { duration: 200 })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase])

    const animatedProps = useAnimatedProps(() => ({ opacity: opacity.value, scale: scale.value }))

    return (
        <AnimatedG originX={x} originY={y} animatedProps={animatedProps} onPress={onPress}>
            <Defs>
                <ClipPath id={clipId}>
                    <Rect x={x - W / 2} y={y - H / 2} width={W} height={H} rx={4} />
                </ClipPath>
                <LinearGradient id={scrimId} x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor="#000" stopOpacity={0} />
                    <Stop offset="1" stopColor="#000" stopOpacity={0.8} />
                </LinearGradient>
            </Defs>

            <Rect
                x={x - W / 2}
                y={y - H / 2}
                width={W}
                height={H}
                rx={4}
                fill="#1b1916"
                stroke="rgba(255,255,255,0.12)"
                strokeWidth={1.5}
            />
            <SvgImage
                href={{ uri: imgUrl }}
                x={x - W / 2}
                y={y - H / 2}
                width={W}
                height={H}
                preserveAspectRatio="xMidYMid slice"
                clipPath={`url(#${clipId})`}
            />
            <Rect
                x={x - W / 2}
                y={y + H / 2 - 20}
                width={W}
                height={20}
                fill={`url(#${scrimId})`}
                clipPath={`url(#${clipId})`}
            />

            <SvgText
                x={x}
                y={baseY(y + H / 2 + 11, 10)}
                fill="#ede9df"
                fontSize={10}
                fontFamily={fonts.ui}
                textAnchor="middle"
            >
                {line1}
            </SvgText>
            {!!line2 && (
                <SvgText
                    x={x}
                    y={baseY(y + H / 2 + 21, 10)}
                    fill="rgba(237,233,223,0.55)"
                    fontSize={10}
                    fontFamily={fonts.ui}
                    textAnchor="middle"
                >
                    {line2}
                </SvgText>
            )}
        </AnimatedG>
    )
}

// ── Graph ───────────────────────────────────────────────────────────────────
export function RecommendGraph({
    question,
    games,
    loading = false,
    stepIndex,
    onChoice,
    apiHost,
}: {
    question: RecommendQuestion | null
    games: RecommendGame[] | null
    loading?: boolean
    stepIndex: number
    onChoice: (type: string, value: string) => void
    apiHost: string | undefined
}) {
    const [chosen, setChosen] = useState<number | null>(null)
    const mounted = useRef(true)

    useEffect(() => () => {
        mounted.current = false
    }, [])
    // New content arrived (next question, or the final result set) — clear the chosen/dismiss state
    // so the fresh nodes enter cleanly.
    useEffect(() => {
        setChosen(null)
    }, [question, games])

    const edgeColor = question
        ? (TYPE_COLORS[question.type] ?? 'rgba(237,233,223,0.2)')
        : '#c9a84c'

    const positions = question
        ? optionPositions(question.options.length, OPTION_R)
        : games
            ? optionPositions(Math.min(games.length, 8), GAME_R)
            : []

    function choose(index: number, type: string, value: string) {
        if (chosen !== null || loading) return
        // Mirror the web: pop the chosen node / dismiss the rest, then advance after ~320ms.
        setChosen(index)
        setTimeout(() => {
            if (mounted.current) onChoice(type, value)
        }, 300)
    }

    const centerLabel = loading
        ? 'Thinking…'
        : games
            ? "Here's what to play"
            : question?.label ?? 'What should I play?'
    const centerSub = question ? question.type : ''

    return (
        <View style={styles.wrap}>
            {/* Size the SVG to FILL its flex parent — matches web's `width:100%;height:100%` CSS. The
                old onLayout-measured width/height started at 0, and because everything is drawn in a
                fixed viewBox scaled by (size / viewBox), the whole graph painted tiny for the first
                ~1.5s then snapped — and on the first question the nodes co-mounted under that zero size
                as empty circles. Filling via layout removes both first-mount races. */}
            <Svg
                width="100%"
                height="100%"
                viewBox={`0 0 ${VW} ${VH}`}
                preserveAspectRatio="xMidYMid meet"
            >
                    {/* Edges first so they sit under the nodes */}
                    {(question || games) &&
                        positions.map((p, i) => (
                            <ElbowEdge
                                key={`edge-${stepIndex}-${i}`}
                                x1={CX}
                                y1={CY}
                                x2={p.x}
                                y2={p.y}
                                elbowT={elbowOffset(i)}
                                color={edgeColor}
                                visible={chosen === null || chosen === i}
                                delay={i * 60}
                            />
                        ))}

                    {/* Option nodes */}
                    {question &&
                        question.options.map((opt, i) =>
                            positions[i] ? (
                                <GraphNode
                                    key={`opt-${stepIndex}-${i}`}
                                    x={positions[i].x}
                                    y={positions[i].y}
                                    label={opt.label}
                                    subLabel={opt.count > 0 ? String(opt.count) : ''}
                                    filterType={question.type}
                                    phase={chosen === null ? 'idle' : chosen === i ? 'chosen' : 'dismissed'}
                                    delay={i * 80}
                                    onPress={() => choose(i, question.type, opt.value)}
                                />
                            ) : null,
                        )}

                    {/* Game result nodes */}
                    {games &&
                        games.slice(0, 8).map((game, i) =>
                            positions[i] ? (
                                <GameResultNode
                                    key={`res-${game.appid}`}
                                    x={positions[i].x}
                                    y={positions[i].y}
                                    appid={game.appid}
                                    name={game.name}
                                    header={game.header}
                                    apiHost={apiHost}
                                    phase="idle"
                                    delay={i * 80}
                                    onPress={() => router.push(`/game/${game.appid}` as never)}
                                />
                            ) : null,
                        )}

                    {/* Center node — rendered last so it sits on top */}
                    <GraphNode
                        key="center"
                        x={CX}
                        y={CY}
                        label={centerLabel}
                        subLabel={centerSub}
                        filterType="center"
                        isCenter
                        phase="idle"
                    />
            </Svg>
        </View>
    )
}

const styles = StyleSheet.create({
    wrap: { flex: 1 },
})
