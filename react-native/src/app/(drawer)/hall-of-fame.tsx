import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { Link } from 'expo-router'
import { useMemo } from 'react'
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { getFlags } from '@/api/flags'
import { getSteamGamesList } from '@/api/games'
import { useApiHost } from '@/hooks/useApiHost'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { formatPlaytime } from '@/utils/format'
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

export default function HallOfFameScreen() {
    const flagsQuery = useQuery({ queryKey: ['flags'], queryFn: getFlags })
    const gamesQuery = useQuery({ queryKey: ['steamGamesList'], queryFn: getSteamGamesList })
    const apiHostQuery = useApiHost()
    const breakpoint = useBreakpoint()
    const featuredColumns = breakpoint === 'mobilePortrait' ? 1 : 3 // matches web's explicit ≤479 override
    const standardColumns = breakpoint === 'mobilePortrait' ? 2 : 3
    const apiHost = apiHostQuery.data

    const items: CompletedItem[] = useMemo(() => {
        const flags = flagsQuery.data
        const games = gamesQuery.data
        if (!flags || !games) return []
        const gameMap = new Map(games.map(g => [g.appid, g]))
        const ids = Object.entries(flags).filter(([, f]) => f.completed).map(([id]) => Number(id))
        return ids
            .map((appid): CompletedItem => {
                const g: SteamGameRaw | undefined = gameMap.get(appid)
                return { appid, name: g?.name ?? `App ${appid}`, playtime: g?.playtime_forever ?? 0 }
            })
            .sort((a, b) => b.playtime - a.playtime)
    }, [flagsQuery.data, gamesQuery.data])

    const grouped = useMemo(() => {
        const map = new Map<string, CompletedItem[]>(TIERS.map(t => [t.key, []]))
        for (const item of items) map.get(tierFor(item.playtime).key)!.push(item)
        return map
    }, [items])

    const totalMin = items.reduce((s, i) => s + i.playtime, 0)
    const subtitle = `${items.length} game${items.length !== 1 ? 's' : ''} conquered · ${formatPlaytime(totalMin)} total`
    const isLoading = flagsQuery.isLoading || gamesQuery.isLoading

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
            <View style={styles.header}>
                <Text style={styles.eyebrow}>Collection</Text>
                <Text style={styles.title}>Completed</Text>
                <Text style={styles.subtitle}>{subtitle}</Text>
            </View>
            {TIERS.map(tier => {
                const tierGames = grouped.get(tier.key) ?? []
                if (!tierGames.length) return null
                const numColumns = tier.featured ? featuredColumns : standardColumns
                return (
                    <View key={tier.key} style={styles.section}>
                        <View style={styles.sectionHeading}>
                            <Text style={[styles.sectionSymbol, { color: tier.color }]}>{tier.symbol}</Text>
                            <Text style={[styles.sectionName, { color: tier.color }]}>{tier.label}</Text>
                            <Text style={styles.sectionMeta}>{tier.sublabel} · {tierGames.length} game{tierGames.length !== 1 ? 's' : ''}</Text>
                        </View>
                        <FlatList
                            key={`${tier.key}-${numColumns}`}
                            data={tierGames}
                            numColumns={numColumns}
                            keyExtractor={(item) => String(item.appid)}
                            scrollEnabled={false}
                            contentContainerStyle={styles.grid}
                            columnWrapperStyle={numColumns > 1 ? styles.gridRow : undefined}
                            renderItem={({ item }) => {
                                const hours = item.playtime > 0 ? formatPlaytime(item.playtime) : null
                                const cardStyle = StyleSheet.flatten([
                                    styles.card,
                                    tier.featured && styles.cardFeatured,
                                    { flex: 1 / numColumns },
                                ])
                                return (
                                    <Link href={`/game/${item.appid}` as never} asChild>
                                        <Pressable style={cardStyle}>
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
    eyebrow: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, textTransform: 'uppercase' },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 22 },
    subtitle: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12, marginTop: 2 },
    section: { marginBottom: spacing.lg },
    sectionHeading: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
    sectionSymbol: { fontSize: 14 },
    sectionName: { fontFamily: fonts.title, fontSize: 15 },
    sectionMeta: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 11, marginLeft: spacing.xs },
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
        position: 'absolute', top: 4, right: 4, color: colors.text, fontFamily: fonts.uiBold, fontSize: 10,
        backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2,
    },
    cardBody: { padding: spacing.xs, gap: 2 },
    cardName: { color: colors.text, fontFamily: fonts.ui, fontSize: 12 },
    cardLabel: { fontFamily: fonts.uiBold, fontSize: 10 },
})
