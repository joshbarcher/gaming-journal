import { router, useLocalSearchParams } from 'expo-router'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import Svg, { Line, Path, Polyline, Rect } from 'react-native-svg'

import { colors, fonts } from '@/theme/tokens'
import type { Pcgw } from 'gaming-journal-contracts/pcgw'

// Port of the CURRENT PCGW.svelte section — the glanceable "section status badges" row (a fresh icon
// set distinct from the full detail page) plus links into the dedicated /pcgw detail page. All the
// video/input/cloud/save/fixes detail now lives on that full page (game/[appid]/pcgw), matching the
// web, which moved everything out of the inline section into PcgwDetail.svelte.

// ── Section badge icons (Lucide paths, copied verbatim from PCGW.svelte's ICON map) ──────────────
type IconName = 'gauge' | 'vsync' | 'scan' | 'trend' | 'gem' | 'pad' | 'cloud'

function SBadgeIcon({ name, color }: { name: IconName; color: string }) {
    const stroke = { stroke: color, strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' as const }
    const common = { width: 24, height: 24, viewBox: '0 0 24 24' }
    switch (name) {
        case 'gauge':
            return <Svg {...common}><Path {...stroke} d="m12 14 4-4" /><Path {...stroke} d="M3.34 19a10 10 0 1 1 17.32 0" /></Svg>
        case 'vsync':
            return <Svg {...common}><Path {...stroke} d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><Path {...stroke} d="M21 3v5h-5" /></Svg>
        case 'scan':
            return <Svg {...common}><Path {...stroke} d="M3 7V5a2 2 0 0 1 2-2h2" /><Path {...stroke} d="M17 3h2a2 2 0 0 1 2 2v2" /><Path {...stroke} d="M21 17v2a2 2 0 0 1-2 2h-2" /><Path {...stroke} d="M7 21H5a2 2 0 0 1-2-2v-2" /><Rect {...stroke} x={7} y={8} width={10} height={8} rx={1} /></Svg>
        case 'trend':
            return <Svg {...common}><Polyline {...stroke} points="22 7 13.5 15.5 8.5 10.5 2 17" /><Polyline {...stroke} points="16 7 22 7 22 13" /></Svg>
        case 'gem':
            return <Svg {...common}><Path {...stroke} d="M6 3h12l4 6-10 13L2 9Z" /><Path {...stroke} d="M11 3 8 9l4 13 4-13-3-6" /><Path {...stroke} d="M2 9h20" /></Svg>
        case 'pad':
            return <Svg {...common}><Line {...stroke} x1={6} x2={10} y1={11} y2={11} /><Line {...stroke} x1={8} x2={8} y1={9} y2={13} /><Line {...stroke} x1={15} x2={15.01} y1={12} y2={12} /><Line {...stroke} x1={18} x2={18.01} y1={10} y2={10} /><Path {...stroke} d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.544-.604-6.584-.685-7.258A4 4 0 0 0 17.32 5z" /></Svg>
        case 'cloud':
            return <Svg {...common}><Path {...stroke} d="M12 13v8l-4-4" /><Path {...stroke} d="m12 21 4-4" /><Path {...stroke} d="M4.393 15.269A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.436 8.284" /></Svg>
    }
}

// on = supported, off = unsupported, neutral = caveats / unknown (see full page).
type PcgwState = 'on' | 'off' | 'neutral'
function pcgwState(raw: string | null | undefined): PcgwState {
    if (raw == null || raw === '') return 'neutral'
    if (raw === 'true' || raw === 'always on') return 'on'
    if (raw === 'false') return 'off'
    return 'neutral' // hackable, limited, etc.
}
const GLYPH: Record<PcgwState, string> = { on: '✓', off: '✕', neutral: '!' }
// --badge-clr per state (PCGW.svelte's .pcgw-sbadge--{state}).
const STATE_CLR: Record<PcgwState, string> = { on: '#4ecb8d', neutral: '#e0a24a', off: '#e0596e' }
// color-mix(in srgb, --badge-clr 34%, #1a1a24) — the gradient centre, used as a solid circle fill.
const STATE_BG: Record<PcgwState, string> = { on: '#2c5648', neutral: '#5d4831', off: '#5d2f3d' }

type Badge = { label: string; icon: IconName; value: string | null | undefined }

export function PCGW({ data, refreshing, onRefresh }: { data: Pcgw | null | undefined; refreshing: boolean; onRefresh: () => void }) {
    const { appid: appidStr } = useLocalSearchParams<{ appid: string }>()
    const appid = Number(appidStr)
    if (!data?.found) return null

    const v = (data.video ?? {}) as Record<string, string | null | undefined>
    const inp = data.input ?? {}
    const cl = (data.cloud ?? {}) as Record<string, string | null | undefined>

    const badges: Badge[] = [
        { label: '120+ FPS', icon: 'gauge', value: v.fps120 },
        { label: 'VSync', icon: 'vsync', value: v.vsync },
        { label: '4K UHD', icon: 'scan', value: v.uhd4k },
        { label: 'Upscaling', icon: 'trend', value: v.upscaling },
        { label: 'Ray Tracing', icon: 'gem', value: v.rayTracing },
        { label: 'Controller', icon: 'pad', value: inp.controller?.support ?? inp.controller?.fullSupport },
        { label: 'Cloud (Steam)', icon: 'cloud', value: cl.steam },
    ]

    const goDetail = () => router.push(`/game/${appid}/pcgw` as never)

    return (
        <View style={styles.section}>
            <View style={styles.titleRow}>
                <Text style={styles.title}>PCGamingWiki</Text>
                <Pressable onPress={goDetail} hitSlop={6}>
                    <Text style={styles.detailsLink}>Details ›</Text>
                </Pressable>
                {data.pageUrl && (
                    <Pressable onPress={() => Linking.openURL(data.pageUrl!)} hitSlop={6}>
                        <Text style={styles.wikiLink}>↗</Text>
                    </Pressable>
                )}
                <Pressable onPress={onRefresh} disabled={refreshing} hitSlop={8}>
                    <Text style={styles.refreshBtn}>{refreshing ? '⟳' : '↻'}</Text>
                </Pressable>
            </View>

            <View style={styles.sbadges}>
                {badges.map((b) => {
                    const st = pcgwState(b.value)
                    const clr = STATE_CLR[st]
                    return (
                        <Pressable key={b.label} style={styles.sbadge} onPress={goDetail}>
                            <View
                                style={[
                                    styles.circle,
                                    { backgroundColor: STATE_BG[st], borderColor: withAlpha(clr, 0.55), shadowColor: clr },
                                    st === 'off' && styles.circleOff,
                                ]}
                            >
                                <SBadgeIcon name={b.icon} color={clr} />
                                <View style={[styles.glyph, { backgroundColor: clr }]}>
                                    <Text style={styles.glyphText}>{GLYPH[st]}</Text>
                                </View>
                            </View>
                            <Text style={[styles.sbadgeLabel, st === 'on' && styles.sbadgeLabelOn]}>{b.label}</Text>
                        </Pressable>
                    )
                })}
            </View>

            <Pressable onPress={goDetail} style={styles.moreRow} hitSlop={6}>
                <Text style={styles.moreText}>Full PCGamingWiki details →</Text>
            </Pressable>
        </View>
    )
}

// #rrggbb → rgba(r,g,b,a). The three state colours are all 6-digit hex.
function withAlpha(hex: string, a: number): string {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return `rgba(${r}, ${g}, ${b}, ${a})`
}

const styles = StyleSheet.create({
    section: { padding: 12 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 16 },
    detailsLink: { color: colors.accent, fontFamily: fonts.ui, fontSize: 11, letterSpacing: 0.5, opacity: 0.9, flex: 1 },
    wikiLink: { color: colors.textMuted, fontSize: 15 },
    refreshBtn: { color: colors.textMuted, fontSize: 16 },

    sbadges: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 16, columnGap: 22 },
    sbadge: { width: 78, alignItems: 'center', gap: 8 },
    circle: {
        width: 56,
        height: 56,
        borderRadius: 28,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
        // Approximates the web's colored box-shadow glow.
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 8,
        elevation: 4,
    },
    circleOff: { opacity: 0.75, shadowOpacity: 0, elevation: 0 },
    glyph: {
        position: 'absolute',
        bottom: -3,
        right: -3,
        width: 20,
        height: 20,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: colors.bg,
    },
    glyphText: { color: '#12100a', fontFamily: fonts.uiBold, fontSize: 11, lineHeight: 13 },
    sbadgeLabel: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, textAlign: 'center', lineHeight: 13 },
    sbadgeLabelOn: { color: colors.text },

    moreRow: { marginTop: 18 },
    moreText: { color: colors.accent, fontFamily: fonts.ui, fontSize: 12, opacity: 0.9 },
})
