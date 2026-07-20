import { Feather } from '@expo/vector-icons'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'

import { colors, fonts, spacing } from '@/theme/tokens'
import type { ProtonDbRaw } from 'gaming-journal-contracts/protondb'

// Port of ProtonDB.svelte's dedicated `.protondb-row` section (game.css:2201-2409). Renders only if
// data?.tier is truthy (double-guarded — GamePage already nulls a no-tier result before it reaches
// here). Desktop layout: a metallic tier-badge column, three dashed-outline stat boxes
// (Confidence / Score / Reports, each icon + value-over-label), and a bar box holding the log-scale
// "Community Reports" meter. Log-scale bar position: logPct(n) = log(clamp(n,1,5000))/log(5000)*100.
const LOG_TICKS = [
    { label: '1', n: 1 }, { label: '10', n: 10 }, { label: '100', n: 100 },
    { label: '1K', n: 1000 }, { label: '5K+', n: 5000 },
]
function logPct(n: number) {
    const clamped = Math.min(Math.max(n, 1), 5000)
    return (Math.log(clamped) / Math.log(5000)) * 100
}
function cap(s: string | null | undefined) {
    if (!s) return '—'
    return s.charAt(0).toUpperCase() + s.slice(1)
}

// Solid approximations of the web `.proton-badge--{tier}` metallic gradients (game.css:2151-2157),
// identical to the palette GameHero uses for the hero badge so the two proton badges read the same.
const PROTON_TIERS: Record<string, { clr: string; bg: string; border: string }> = {
    native:   { clr: '#7dda84',              bg: 'rgba(28,52,30,0.82)', border: 'rgba(125,218,132,0.30)' },
    platinum: { clr: '#8aaac8',              bg: 'rgba(34,52,80,0.82)', border: 'rgba(130,165,200,0.24)' },
    gold:     { clr: '#d4a843',              bg: 'rgba(58,40,10,0.82)', border: 'rgba(200,155,45,0.35)' },
    silver:   { clr: '#b0bcc8',              bg: 'rgba(44,50,56,0.82)', border: 'rgba(155,170,185,0.28)' },
    bronze:   { clr: '#c8904a',              bg: 'rgba(54,32,12,0.82)', border: 'rgba(185,125,55,0.30)' },
    borked:   { clr: '#d46060',              bg: 'rgba(58,16,16,0.82)', border: 'rgba(200,70,70,0.30)' },
    pending:  { clr: 'rgba(200,200,200,0.55)', bg: 'rgba(10,9,8,0.82)', border: 'rgba(255,255,255,0.14)' },
}

export function ProtonDB({ appid, data, refreshing, onRefresh }: {
    appid: number
    data: ProtonDbRaw | null | undefined
    refreshing: boolean
    onRefresh: () => void
}) {
    if (!data?.tier) return null
    const t = PROTON_TIERS[data.tier.toLowerCase()] ?? PROTON_TIERS.pending
    const total = data.total ?? 0
    const totalStr = total.toLocaleString()
    const markerPct = logPct(total)
    const scoreStr = data.score != null ? `${Math.round(data.score * 100)}%` : '—'

    return (
        <View style={styles.section}>
            <View style={styles.titleRow}>
                <Text style={styles.title}>Linux Compatibility</Text>
                <Pressable onPress={() => Linking.openURL(`https://www.protondb.com/app/${appid}`)} hitSlop={8}>
                    <Feather name="external-link" size={14} color={colors.textMuted} />
                </Pressable>
                <Pressable onPress={onRefresh} disabled={refreshing} hitSlop={8}>
                    <Text style={styles.refreshBtn}>{refreshing ? '⟳' : '↻'}</Text>
                </Pressable>
            </View>

            <View style={styles.row}>
                {/* Metallic tier badge — award icon over the uppercase tier name */}
                <View style={[styles.badge, { backgroundColor: t.bg, borderColor: t.border }]}>
                    <Feather name="award" size={34} color={t.clr} />
                    <Text style={[styles.badgeName, { color: t.clr }]}>{cap(data.tier)}</Text>
                </View>

                <StatBox icon="shield" value={cap(data.confidence)} label="Confidence" />
                <StatBox icon="percent" value={scoreStr} label="Score" />
                <StatBox icon="users" value={totalStr} label="Reports" />

                {/* Log-scale community-reports meter */}
                <View style={styles.barBox}>
                    <Text style={styles.barLabel}>Community Reports</Text>
                    <View style={styles.barArea}>
                        <View style={styles.barTrack}>
                            <View style={[styles.barFill, { width: `${markerPct}%`, backgroundColor: t.clr }]} />
                            <View style={[styles.barMarkerWrap, { left: `${markerPct}%` }]}>
                                <View style={styles.barMarkerLine} />
                                <Text style={styles.barCount} numberOfLines={1}>{totalStr}</Text>
                            </View>
                        </View>
                        <View style={styles.ticksRow}>
                            {LOG_TICKS.map(tick => (
                                <View key={tick.label} style={[styles.tickWrap, { left: `${logPct(tick.n)}%` }]}>
                                    <Text style={styles.tick}>{tick.label}</Text>
                                </View>
                            ))}
                        </View>
                    </View>
                </View>
            </View>
        </View>
    )
}

function StatBox({ icon, value, label }: { icon: keyof typeof Feather.glyphMap; value: string; label: string }) {
    return (
        <View style={styles.statBox}>
            <Feather name={icon} size={24} color={colors.textMuted} style={styles.statIcon} />
            <View style={styles.statText}>
                <Text style={styles.statValue}>{value}</Text>
                <Text style={styles.statLabel}>{label}</Text>
            </View>
        </View>
    )
}

const styles = StyleSheet.create({
    section: { padding: spacing.md },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 16, flex: 1 },
    refreshBtn: { color: colors.textMuted, fontSize: 16 },

    // `.protondb-row` — flex row, gap 8, stretch. flexWrap lets it collapse gracefully below the
    // desktop tier (bar min-width 220 forces it onto its own row when space runs out).
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'stretch' },

    // `.protondb-col--badge` — flex 0 0 110px, metallic tier fill.
    badge: {
        flexGrow: 0, flexShrink: 0, flexBasis: 110,
        alignItems: 'center', justifyContent: 'center', gap: 10,
        padding: 16, borderRadius: 10, borderWidth: 1, overflow: 'hidden',
    },
    badgeName: { fontFamily: fonts.uiBold, fontSize: 13, letterSpacing: 0.8, textTransform: 'uppercase', textAlign: 'center' },

    // `.protondb-col--stat` — flex 0 0 auto, dashed outline, icon + value-over-label.
    statBox: {
        flexGrow: 0, flexShrink: 0,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14,
        paddingVertical: 16, paddingHorizontal: 24,
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', borderStyle: 'dashed', borderRadius: 10,
    },
    statIcon: { opacity: 0.55 },
    statText: { gap: 4, alignItems: 'flex-start', justifyContent: 'center' },
    statValue: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 18, lineHeight: 18 },
    statLabel: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 9, letterSpacing: 0.8, textTransform: 'uppercase', lineHeight: 10 },

    // `.protondb-col--bar` — flex 1, min-width 220, dashed outline.
    barBox: {
        flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 220,
        justifyContent: 'center', paddingVertical: 16, paddingHorizontal: 22,
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', borderStyle: 'dashed', borderRadius: 10,
    },
    barLabel: { color: colors.textMuted, fontFamily: fonts.uiBold, fontSize: 9, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 18 },
    barArea: { width: '100%' },
    barTrack: { position: 'relative', height: 3, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2, marginBottom: 20 },
    barFill: { position: 'absolute', left: 0, top: 0, height: '100%', borderRadius: 2, opacity: 0.7 },
    // Zero-width, center-aligned wrapper anchored at the marker %, so the line and the count text
    // both center on the exact point (RN has no percentage translateX).
    barMarkerWrap: { position: 'absolute', top: 0, width: 0, alignItems: 'center' },
    barMarkerLine: { width: 2, height: 19, marginTop: -8, backgroundColor: colors.text, borderRadius: 1 },
    barCount: { marginTop: 4, fontFamily: fonts.uiBold, fontSize: 10, color: colors.text, letterSpacing: 0.2 },
    ticksRow: { position: 'relative', height: 14 },
    tickWrap: { position: 'absolute', top: 0, width: 0, alignItems: 'center' },
    tick: { fontFamily: fonts.ui, fontSize: 9, color: 'rgba(255,255,255,0.25)' },
})
