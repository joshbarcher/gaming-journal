import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { Link } from 'expo-router'
import { useMemo } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'

import { getCommunityReviews } from '@/api/communityReviews'
import { getFlags } from '@/api/flags'
import { getSteamGamesList } from '@/api/games'
import { getHltbIndex } from '@/api/hltb'
import { getLocalReview } from '@/api/localReview'
import { HeroCrossfade } from '@/components/shared/HeroCrossfade'
import { LegendaryStars } from '@/components/shared/LegendaryStars'
import { useApiHost } from '@/hooks/useApiHost'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { formatPlaytime } from '@/utils/format'

// Port of collections/favorites.md. No drag-reorder here (unlike Backlog/In-Progress) — the hero
// is always the first flagged favorite, so this uses a real FlatList grid (like Library/Wishlist)
// rather than the single-column DraggableList adaptation those two needed.
//
// Star rendering now goes through the shared LegendaryStars component ('compact' variant — matches
// Favorites.svelte's real usage: starStr() feeds a plain chip value string, not a separate badge) —
// retrofit off its own inline starStr() (a 2nd/3rd independent implementation of the same rule),
// now that LegendaryStars exists (Phase 2's first item).

export default function FavoritesScreen() {
    const flagsQuery = useQuery({ queryKey: ['flags'], queryFn: getFlags })
    const gamesQuery = useQuery({ queryKey: ['steamGamesList'], queryFn: getSteamGamesList })
    const hltbQuery = useQuery({ queryKey: ['hltbIndex'], queryFn: getHltbIndex })
    const apiHostQuery = useApiHost()
    const breakpoint = useBreakpoint()
    const numColumns = breakpoint === 'mobilePortrait' ? 2 : 3

    const favoriteIds = useMemo(() => {
        const flags = flagsQuery.data
        if (!flags) return []
        return Object.entries(flags).filter(([, f]) => f.favorite).map(([id]) => Number(id))
    }, [flagsQuery.data])

    const heroAppid = favoriteIds[0]
    const restIds = favoriteIds.slice(1)

    const heroReviewQuery = useQuery({
        queryKey: ['localReview', heroAppid],
        queryFn: () => getLocalReview(heroAppid!),
        enabled: heroAppid !== undefined,
    })
    const heroCommunityQuery = useQuery({
        queryKey: ['communityReviews', heroAppid],
        queryFn: () => getCommunityReviews(heroAppid!),
        enabled: heroAppid !== undefined,
    })

    const gameMap = useMemo(() => new Map((gamesQuery.data ?? []).map(g => [g.appid, g])), [gamesQuery.data])
    const hltbMap = useMemo(() => new Map((hltbQuery.data ?? []).map(h => [h.appid, h])), [hltbQuery.data])
    const apiHost = apiHostQuery.data

    const totalMins = favoriteIds.reduce((s, id) => s + (gameMap.get(id)?.playtime_forever ?? 0), 0)
    const subtitle = `${favoriteIds.length} game${favoriteIds.length !== 1 ? 's' : ''} · ${formatPlaytime(totalMins)} played`

    const isLoading = flagsQuery.isLoading || gamesQuery.isLoading || hltbQuery.isLoading

    if (isLoading) {
        return <View style={styles.container}><Text style={styles.loadingText}>Loading favorites…</Text></View>
    }

    if (!favoriteIds.length) {
        return (
            <View style={styles.container}>
                <Text style={styles.emptyText}>
                    No favorites yet. Open any game page and toggle the Favorite flag to add it here.
                </Text>
            </View>
        )
    }

    const heroGame = gameMap.get(heroAppid!)
    const heroHltb = hltbMap.get(heroAppid!)
    const heroCommunityScore = heroCommunityQuery.data?.summary?.scoreDesc

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.eyebrow}>Collection</Text>
                <Text style={styles.title}>Favorites</Text>
                <Text style={styles.subtitle}>{subtitle}</Text>
            </View>

            <FlatList
                key={numColumns}
                data={restIds}
                numColumns={numColumns}
                keyExtractor={(id) => String(id)}
                contentContainerStyle={styles.grid}
                columnWrapperStyle={restIds.length ? styles.gridRow : undefined}
                ListHeaderComponent={
                    <Link href={`/game/${heroAppid}` as never} asChild>
                        <Pressable style={styles.hero}>
                            <HeroCrossfade appid={heroAppid!} />
                            <View style={styles.heroOverlay} />
                            <View style={styles.heroInfo}>
                                <Text style={styles.heroName} numberOfLines={2}>{heroGame?.name ?? `App ${heroAppid}`}</Text>
                                <View style={styles.heroMetaRow}>
                                    {heroReviewQuery.data?.stars ? (
                                        <LegendaryStars stars={heroReviewQuery.data.stars} variant="compact" size={12} />
                                    ) : null}
                                    {heroHltb?.gameplayMain && <Text style={styles.heroMeta}>{Math.round(heroHltb.gameplayMain)}h main</Text>}
                                    <Text style={styles.heroMeta}>{formatPlaytime(heroGame?.playtime_forever ?? 0)} played</Text>
                                    {heroCommunityScore && <Text style={styles.heroMeta}>{heroCommunityScore}</Text>}
                                </View>
                            </View>
                        </Pressable>
                    </Link>
                }
                renderItem={({ item: appid }) => {
                    const game = gameMap.get(appid)
                    const cardStyle = StyleSheet.flatten([styles.card, { flex: 1 / numColumns }])
                    return (
                        <Link href={`/game/${appid}` as never} asChild>
                            <Pressable style={cardStyle}>
                                {apiHost && (
                                    <Image
                                        source={{ uri: `${apiHost}/relay/images/steam/games/${appid}/header.jpg` }}
                                        style={styles.cardImage}
                                        contentFit="cover"
                                        cachePolicy="memory-disk"
                                        recyclingKey={String(appid)}
                                    />
                                )}
                                <Text style={styles.cardName} numberOfLines={1}>{game?.name ?? `App ${appid}`}</Text>
                            </Pressable>
                        </Link>
                    )
                }}
            />
        </View>
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
    hero: {
        height: 220, margin: spacing.md, borderRadius: radius, overflow: 'hidden',
        backgroundColor: colors.bgRaised, justifyContent: 'flex-end',
    },
    heroOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
    heroInfo: { padding: spacing.md },
    heroName: { color: colors.text, fontFamily: fonts.title, fontSize: 20 },
    heroMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
    heroMeta: { color: colors.text, fontFamily: fonts.ui, fontSize: 12 },
    grid: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
    gridRow: { gap: spacing.sm },
    card: {
        backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border,
        borderRadius: radius, overflow: 'hidden', marginBottom: spacing.sm,
    },
    cardImage: { width: '100%', aspectRatio: 460 / 215, backgroundColor: colors.bgHover },
    cardName: { color: colors.text, fontFamily: fonts.ui, fontSize: 12, padding: spacing.xs },
})
