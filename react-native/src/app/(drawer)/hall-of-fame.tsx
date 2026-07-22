import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { Link } from 'expo-router'
import { useMemo } from 'react'
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { getFlags } from '@/api/flags'
import { getSteamGamesList } from '@/api/games'
import { getSettings } from '@/api/settings'
import { openGameCardMenu } from '@/components/shared/useGameCardMenu'
import { useApiHost } from '@/hooks/useApiHost'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useGridColumns } from '@/hooks/useGridColumns'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { formatPlaytime } from '@/utils/format'
import { makeShouldShow } from '@/utils/gameFilter'
import type { SteamGameRaw } from 'gaming-journal-contracts/steamGamesList'

// Port of collections/completed.md ("Hall of Fame"). Tier logic ported verbatim from
// HallOfFame.svelte's TIERS array + tierFor() (find first tier where hours >= minH, checked in
// descending threshold order) — read the source directly since it's exact numeric logic worth
// getting byte-for-byte right, not just "roughly 4 tiers."
//
// Doc discrepancy caught: collections/completed.md says "within each tier the order is determined
// by the flags data (insertion order)" — but the actual source sorts the FULL game list by
// playtime descending *before* grouping into tiers (`games = results.sort((a,b) => b.playtime -
// a.playtime)`, then `grouped` buckets from that already-sorted array), so within-tier order is
// really playtime-descending, not insertion order. Ported the real behavior, not the doc's claim.
const TIERS = [
    { key: 'legend',    minH: 100, symbol: '◆', label: 'Legend',    sublabel: '100h+', color: '#c9a84c', featured: true },
    { key: 'veteran',   minH: 50,  symbol: '▲', label: 'Veteran',   sublabel: '50h+',  color: '#aaaaaa', featured: false },
    { key: 'completed', minH: 20,  symbol: '●', label: 'Completed', sublabel: '20h+',  color: '#60a882', featured: false },
    { key: 'finished',  minH: 0,   symbol: '○', label: 'Finished',  sublabel: '<20h',  color: colors.textMuted, featured: false },
] as const

type CompletedItem = { appid: number; name: string; playtime: number }

function tierFor(playtimeMin: number) {
    const h = playtimeMin / 60
    return TIERS.find(t => h >= t.minH) ?? TIERS[TIERS.length - 1]
}

// FlatList doesn't add filler cells, so a partial last row of `flex: 1/numColumns` cards would each
// stretch to fill the row (flexBasis 0 grows to consume the whole width). Padding the data to a
// whole number of rows keeps every real card at its true column width, left-aligned — mirroring the
// web's `repeat(auto-fill, minmax(180px,1fr))` where trailing cards keep their column size.
function padRows<T>(data: T[], numColumns: number): (T | null)[] {
    if (numColumns <= 1) return data
    const rem = data.length % numColumns
    return rem === 0 ? data : [...data, ...Array<null>(numColumns - rem).fill(null)]
}

export default function HallOfFameScreen({ embedded = false }: { embedded?: boolean }) {
    const flagsQuery = useQuery({ queryKey: ['flags'], queryFn: getFlags })
    const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings })
    const gamesQuery = useQuery({ queryKey: ['steamGamesList'], queryFn: getSteamGamesList })
    const apiHostQuery = useApiHost()
    const breakpoint = useBreakpoint()
    const featuredColumns = breakpoint === 'mobilePortrait' ? 1 : 3 // Legend tier stays as-is (web: repeat(3,1fr), 1 col ≤479)
    // Standard tiers: fluid, mirroring the web's `minmax(180px, 1fr)` auto-fill (~6 cols at desktop
    // width) instead of a hardcoded 3.
    const standardColumns = useGridColumns(180, { gap: spacing.sm, horizontalPadding: spacing.md * 2, min: 2 })
    const apiHost = apiHostQuery.data

    const items: CompletedItem[] = useMemo(() => {
        const flags = flagsQuery.data
        const games = gamesQuery.data
        if (!flags || !games) return []
        const gameMap = new Map(games.map(g => [g.appid, g]))
        const shouldShow = makeShouldShow(flags, settingsQuery.data ?? {})
        const ids = Object.entries(flags)
            .filter(([id, f]) => f.completed && shouldShow(id))
            .map(([id]) => Number(id))
        return ids
            .map((appid): CompletedItem => {
                const g: SteamGameRaw | undefined = gameMap.get(appid)
                return { appid, name: g?.name ?? `App ${appid}`, playtime: g?.playtime_forever ?? 0 }
            })
            .sort((a, b) => b.playtime - a.playtime)
    }, [flagsQuery.data, settingsQuery.data, gamesQuery.data])

    const grouped = useMemo(() => {
        const map = new Map<string, CompletedItem[]>(TIERS.map(t => [t.key, []]))
        for (const item of items) map.get(tierFor(item.playtime).key)!.push(item)
        return map
    }, [items])

    const totalMin = items.reduce((s, i) => s + i.playtime, 0)
    const subtitle = totalMin > 0
        ? `${items.length} game${items.length !== 1 ? 's' : ''} conquered · ${formatPlaytime(totalMin)} total`
        : `${items.length} game${items.length !== 1 ? 's' : ''} conquered`
    const isLoading = flagsQuery.isLoading || settingsQuery.isLoading || gamesQuery.isLoading

    if (isLoading) {
        return <View style={styles.container}><Text style={styles.loadingText}>Loading…</Text></View>
    }

    if (!items.length) {
        return (
            <View style={styles.container}>
                <Text style={styles.emptyText}>
                    No completed games yet. Open any game page and toggle the Completed flag to enshrine it here.
                </Text>
            </View>
        )
    }

    return (
        <ScrollView style={styles.container}>
            {embedded ? (
                <Text style={styles.metaLine}>{subtitle}</Text>
            ) : (
                <View style={styles.header}>
                    <Text style={styles.eyebrow}>Collection</Text>
                    <Text style={styles.title}>Completed</Text>
                    <Text style={styles.subtitle}>{subtitle}</Text>
                </View>
            )}
            {TIERS.map(tier => {
                const tierGames = grouped.get(tier.key) ?? []
                if (!tierGames.length) return null
                const numColumns = tier.featured ? featuredColumns : standardColumns
                const data = padRows(tierGames, numColumns)
                return (
                    <View key={tier.key} style={styles.section}>
                        <View style={styles.sectionHeading}>
                            {/* Web's tier heading is an amber uppercase pill (symbol + name), not plain text */}
                            <View style={[styles.tierPill, { borderColor: tier.color }]}>
                                <Text style={[styles.tierPillSymbol, { color: tier.color }]}>{tier.symbol}</Text>
                                <Text style={[styles.tierPillLabel, { color: tier.color }]}>{tier.label}</Text>
                            </View>
                            <Text style={styles.sectionMeta}>{tier.sublabel} · {tierGames.length} game{tierGames.length !== 1 ? 's' : ''}</Text>
                        </View>
                        <View style={[styles.sectionUnderline, { backgroundColor: tier.color }]} />
                        <FlatList
                            key={`${tier.key}-${numColumns}`}
                            data={data}
                            numColumns={numColumns}
                            keyExtractor={(item, i) => (item ? String(item.appid) : `spacer-${i}`)}
                            scrollEnabled={false}
                            contentContainerStyle={styles.grid}
                            columnWrapperStyle={numColumns > 1 ? styles.gridRow : undefined}
                            renderItem={({ item }) => {
                                if (!item) return <View style={{ flex: 1 / numColumns }} />
                                const hours = item.playtime > 0 ? formatPlaytime(item.playtime) : null
                                const cardStyle = StyleSheet.flatten([
                                    styles.card,
                                    tier.featured && styles.cardFeatured,
                                    { flex: 1 / numColumns },
                                ])
                                return (
                                    <Link href={`/game/${item.appid}` as never} asChild>
                                        <Pressable
                                            style={cardStyle}
                                            onLongPress={(e) => openGameCardMenu(item.appid, flagsQuery.data?.[item.appid], { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
                                        >
                                            <View style={[styles.cardImageWrap, tier.featured && styles.cardImageWrapFeatured]}>
                                                {apiHost && (
                                                    <Image
                                                        source={{ uri: `${apiHost}/relay/images/steam/games/${item.appid}/header.jpg` }}
                                                        style={styles.cardImage}
                                                        contentFit="cover"
                                                        cachePolicy="memory-disk"
                                                        recyclingKey={String(item.appid)}
                                                    />
                                                )}
                                                <Text style={[styles.cardTierBadge, { color: tier.color }]}>{tier.symbol}</Text>
                                                {hours && <Text style={styles.cardHours}>{hours}</Text>}
                                            </View>
                                            <View style={styles.cardBody}>
                                                <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
                                                <Text style={[styles.cardLabel, { color: tier.color }]}>{tier.label}</Text>
                                            </View>
                                            {/* Amber underline bar beneath the tier label (web card accent) */}
                                            <View style={[styles.cardLabelBar, { backgroundColor: tier.color }]} />
                                        </Pressable>
                                    </Link>
                                )
                            }}
                        />
                    </View>
                )
            })}
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    loadingText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.lg },
    emptyText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.xl, textAlign: 'center' },
    header: { padding: spacing.md },
    metaLine: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 13, paddingHorizontal: spacing.md, paddingTop: 14, paddingBottom: 16 },
    eyebrow: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, textTransform: 'uppercase' },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 22 },
    subtitle: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12, marginTop: 2 },
    section: { marginBottom: spacing.lg },
    sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md },
    tierPill: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
        paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, borderWidth: 1,
        backgroundColor: 'rgba(255,255,255,0.04)',
    },
    tierPillSymbol: { fontSize: 12 },
    tierPillLabel: { fontFamily: fonts.uiBold, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
    sectionMeta: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11 },
    sectionUnderline: { height: 1, marginHorizontal: spacing.md, marginTop: spacing.sm, marginBottom: spacing.md, opacity: 0.4 },
    grid: { paddingHorizontal: spacing.md },
    gridRow: { gap: spacing.sm },
    card: {
        backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border,
        borderRadius: radius, overflow: 'hidden', marginBottom: spacing.sm,
    },
    cardFeatured: { borderColor: 'rgba(201,168,76,0.4)' },
    cardImageWrap: { width: '100%', aspectRatio: 460 / 215, backgroundColor: colors.bgHover },
    cardImageWrapFeatured: { aspectRatio: 16 / 10 },
    cardImage: { width: '100%', height: '100%' },
    cardTierBadge: {
        position: 'absolute', top: 4, left: 4, fontSize: 14,
        backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, width: 20, height: 20, textAlign: 'center', lineHeight: 20,
    },
    cardHours: {
        position: 'absolute', bottom: 4, right: 4, color: colors.accent, fontFamily: fonts.uiBold, fontSize: 11,
        backgroundColor: 'rgba(10,10,14,0.75)', borderWidth: 1, borderColor: 'rgba(201,168,76,0.3)',
        borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden',
    },
    cardBody: { padding: spacing.xs, gap: 2 },
    cardName: { color: colors.text, fontFamily: fonts.ui, fontSize: 12 },
    cardLabel: { fontFamily: fonts.uiBold, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },
    cardLabelBar: { height: 2, opacity: 0.8 },
})
