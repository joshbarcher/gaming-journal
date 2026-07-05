import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { useState } from 'react'

import { colors, fonts, radius, spacing } from '@/theme/tokens'
import type { ProtonDbRaw } from 'gaming-journal-contracts/protondb'

// Port of ProtonDB.svelte. Renders only if protonData?.tier truthy (double-guarded — GamePage
// already nulls a no-tier result before it reaches here, matching src/api/gamePage.ts's
// getProtonDbForGame()). Log-scale bar position ported exactly: logPct(n) = log(clamp(n,1,5000))/log(5000)*100.
const LOG_TICKS = [
    { label: '1', n: 1 }, { label: '10', n: 10 }, { label: '100', n: 100 },
    { label: '1K', n: 1000 }, { label: '5K+', n: 5000 },
]
function logPct(n: number) {
    const clamped = Math.min(Math.max(n, 1), 5000)
    return (Math.log(clamped) / Math.log(5000)) * 100
}
function cap(s: string | undefined) {
    if (!s) return '—'
    return s.charAt(0).toUpperCase() + s.slice(1)
}
const TIER_COLORS: Record<string, string> = {
    platinum: 'rgba(180,180,220,0.15)', gold: 'rgba(201,168,76,0.15)',
    silver: 'rgba(190,190,190,0.15)', bronze: 'rgba(180,120,70,0.15)', borked: 'rgba(224,80,80,0.15)',
}

export function ProtonDB({ appid, data, refreshing, onRefresh }: {
    appid: number
    data: ProtonDbRaw | null | undefined
    refreshing: boolean
    onRefresh: () => void
}) {
    if (!data?.tier) return null
    const markerPct = logPct(data.total ?? 0)
    const scoreStr = data.score != null ? `${Math.round(data.score * 100)}%` : '—'

    return (
        <View style={styles.section}>
            <View style={styles.titleRow}>
                <Text style={styles.title}>Linux Compatibility (ProtonDB)</Text>
                <Pressable onPress={onRefresh} disabled={refreshing} hitSlop={8}>
                    <Text style={styles.refreshBtn}>{refreshing ? '⟳' : '↻'}</Text>
                </Pressable>
                <Pressable onPress={() => Linking.openURL(`https://www.protondb.com/app/${appid}`)}>
                    <Text style={styles.link}>↗</Text>
                </Pressable>
            </View>
            <View style={styles.row}>
                <View style={StyleSheet.flatten([styles.badge, { backgroundColor: TIER_COLORS[data.tier] ?? colors.bgHover }])}>
                    <Text style={styles.badgeText}>{cap(data.tier)}</Text>
                </View>
                <StatCol label="Confidence" value={cap(data.confidence)} />
                <StatCol label="Score" value={scoreStr} />
                <StatCol label="Reports" value={(data.total ?? 0).toLocaleString()} />
            </View>
            <View style={styles.barWrap}>
                <View style={styles.barTrack}>
                    <View style={[styles.barMarker, { left: `${markerPct}%` }]} />
                </View>
                <View style={styles.tickRow}>
                    {LOG_TICKS.map(t => (
                        <Text key={t.label} style={[styles.tick, { left: `${logPct(t.n)}%` }]}>{t.label}</Text>
                    ))}
                </View>
            </View>
        </View>
    )
}

function StatCol({ label, value }: { label: string; value: string }) {
    return (
        <View style={styles.statCol}>
            <Text style={styles.statLabel}>{label}</Text>
            <Text style={styles.statValue}>{value}</Text>
        </View>
    )
}

const styles = StyleSheet.create({
    section: { padding: spacing.md },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 16, flex: 1 },
    refreshBtn: { color: colors.textMuted, fontSize: 16 },
    link: { color: colors.accent, fontSize: 14 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, alignItems: 'center', marginBottom: spacing.md },
    badge: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius, backgroundColor: colors.bgHover },
    badgeText: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 12, textTransform: 'capitalize' },
    statCol: { gap: 2 },
    statLabel: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 10, textTransform: 'uppercase' },
    statValue: { color: colors.text, fontFamily: fonts.uiBold, fontSize: 13 },
    barWrap: { marginTop: spacing.xs },
    barTrack: { height: 6, backgroundColor: colors.bgHover, borderRadius: 3, position: 'relative' },
    barMarker: { position: 'absolute', top: -3, width: 4, height: 12, backgroundColor: colors.accent, borderRadius: 2, marginLeft: -2 },
    tickRow: { height: 14, position: 'relative', marginTop: 2 },
    tick: { position: 'absolute', color: colors.textMuted, fontFamily: fonts.ui, fontSize: 9, transform: [{ translateX: -6 }] },
})
