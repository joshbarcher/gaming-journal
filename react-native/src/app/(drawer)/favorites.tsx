import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { getCommunityReviews } from '@/api/communityReviews'
import { getFlags } from '@/api/flags'
import { getSteamGamesList } from '@/api/games'
import { getHltbIndex } from '@/api/hltb'
import { getLocalReview } from '@/api/localReview'
import { getSettings } from '@/api/settings'
import { HeroCrossfade } from '@/components/shared/HeroCrossfade'
import { LegendaryStars } from '@/components/shared/LegendaryStars'
import { openGameCardMenu } from '@/components/shared/useGameCardMenu'
import { useApiHost } from '@/hooks/useApiHost'
import { useGridColumns } from '@/hooks/useGridColumns'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { formatPlaytime } from '@/utils/format'
import { makeShouldShow } from '@/utils/gameFilter'

// Port of collections/favorites.md. The hero is a CONTAINED portrait card (web: spans 2 cols × 3
// rows) that the rest-card grid flows around — a bordered card with crossfade art, a 5-heart love
// meter + title overlaid on the art, a bordered 4-cell chip strip (Played / Rating / Steam / HLTB),
// a flag-tags row, and an italic review quote. The rest cards fan out fluidly (web `minmax(160px)`
// → ~6 cols at desktop width) with an hours badge (bottom-right) and the 5-heart row.
//
// The hearts are NOT rating-derived: Favorites.svelte renders exactly 5 filled hearts on every card
// (hero + rest) as a static "these are loved" motif — replicated here, so no per-card review fetch.
const FAV_ACCENT = '#c45c7a'          // web --fav-accent
const FAV_ACCENT_BD = 'rgba(196,92,122,0.28)' // web --fav-accent-bd
const HAIRLINE = 'rgba(255,255,255,0.06)'
const GAP = spacing.sm
const HPAD = spacing.md

function Hearts({ small }: { small?: boolean }) {
    return (
        <View style={styles.hearts}>
            {Array.from({ length: 5 }).map((_, i) => (
                <Text key={i} style={small ? styles.heartSm : styles.heartLg}>♥</Text>
            ))}
        </View>
    )
}

export default function FavoritesScreen() {
    const flagsQuery = useQuery({ queryKey: ['flags'], queryFn: getFlags })
    const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings })
    const gamesQuery = useQuery({ queryKey: ['steamGamesList'], queryFn: getSteamGamesList })
    const hltbQuery = useQuery({ queryKey: ['hltbIndex'], queryFn: getHltbIndex })
    const apiHostQuery = useApiHost()
    // Fluid columns mirroring the web's `minmax(160px, 1fr)` auto-fill (~6 cols at desktop width).
    const numColumns = useGridColumns(160, { gap: GAP, horizontalPadding: HPAD * 2, min: 2 })
    const [flowWidth, setFlowWidth] = useState(0) // inner content width (measured, padding removed)

    // Parity with Favorites.svelte: filter through shouldShow (childLock/filtered/software),
    // sort by playtime descending, then pick a RANDOM favorite as the hero (not always the first).
    const favoriteIds = useMemo(() => {
        const flags = flagsQuery.data
        const games = gamesQuery.data
        if (!flags || !games) return []
        const gm = new Map(games.map(g => [g.appid, g]))
        const shouldShow = makeShouldShow(flags, settingsQuery.data ?? {})
        return Object.entries(flags)
            .filter(([id, f]) => f.favorite && shouldShow(id))
            .map(([id]) => Number(id))
            .sort((a, b) => (gm.get(b)?.playtime_forever ?? 0) - (gm.get(a)?.playtime_forever ?? 0))
    }, [flagsQuery.data, settingsQuery.data, gamesQuery.data])

    // Random hero index, stable across re-renders until the favorites set itself changes — the web
    // re-rolls on each page visit; this re-rolls on each data load, close enough and steadier in-session.
    const heroIdx = useMemo(() => (favoriteIds.length ? Math.floor(Math.random() * favoriteIds.length) : 0), [favoriteIds])
    const heroAppid = favoriteIds[heroIdx]
    const restIds = favoriteIds.filter((_, i) => i !== heroIdx)

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

    const isLoading = flagsQuery.isLoading || settingsQuery.isLoading || gamesQuery.isLoading || hltbQuery.isLoading

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
    const heroCommunity = heroCommunityQuery.data
    const ratingStars = heroReviewQuery.data?.stars
    // Web hero chip strip: Played (accent) / Rating (stars) / Steam (numeric %, not word-score) / HLTB (~Xh).
    const chips: { label: string; val?: string; accent?: boolean; stars?: boolean }[] = [
        { label: 'Played', val: heroGame?.playtime_forever ? formatPlaytime(heroGame.playtime_forever) : '—', accent: true },
        { label: 'Rating', stars: true },
        { label: 'Steam', val: heroCommunity?.summary?.ratio != null ? `${Math.round(heroCommunity.summary.ratio)}%` : '—' },
        { label: 'HLTB', val: heroHltb?.gameplayMain != null ? `~${Math.round(heroHltb.gameplayMain)}h` : '—' },
    ]
    const heroFlags = flagsQuery.data?.[heroAppid!]
    const heroFlagTags = [
        heroFlags?.completed && 'Completed',
        heroFlags?.revisit && 'Revisit',
        heroFlags?.inProgress && 'In Progress',
        heroFlags?.dropped && 'Dropped',
    ].filter(Boolean) as string[]

    // Layout (matches Favorites.svelte): the hero is a CONTAINED card spanning 2 cols × 3 rows in the
    // top-left, and the rest cards FLOW AROUND it — filling the (numColumns − 2) columns to its right
    // for 3 rows, then wrapping to full width below. The web's `.fav-hero { grid-column: span 2;
    // grid-row: span 3 }` inside an auto-fill minmax(160px) grid. Needs ≥3 columns for a beside column
    // to exist; narrower tiers (phone) fall back to a full-width hero on top + grid below, mirroring
    // the web's own ≤479px `grid-column: 1 / -1` hero rule.
    //
    // The earlier full-width-only version was a workaround for a real bug: wrapping the sized hero in
    // <Link asChild><Pressable style={{width}}> let Expo Router's Slot clone DROP the width, so the
    // hero filled the row. renderHero now uses a PLAIN <Pressable onPress={router.push}> (below) with
    // the width honoured, so the beside-the-grid placement is safe again.
    const cardWidth = flowWidth > 0 ? Math.floor((flowWidth - GAP * (numColumns - 1)) / numColumns) : 0
    const spanHero = numColumns >= 3
    const heroWidth = spanHero ? cardWidth * 2 + GAP : flowWidth
    const rightGridWidth = spanHero ? flowWidth - heroWidth - GAP : 0
    // Beside slots = the (numColumns − 2) columns to the hero's right × the hero's 3 rows.
    const besideCount = spanHero ? (numColumns - 2) * 3 : 0
    const besideIds = spanHero ? restIds.slice(0, besideCount) : []
    const belowIds = spanHero ? restIds.slice(besideCount) : restIds

    // Plain Pressable (NOT <Link asChild>): the asChild Slot clone drops the explicit width, which
    // would make the sized hero fill the whole row and break the beside-the-grid placement.
    const renderHero = (width: number, mode: 'tall' | 'wide') => (
        <Pressable
            style={[styles.hero, { width }]}
            onPress={() => router.push(`/game/${heroAppid}` as never)}
            onLongPress={(e) => openGameCardMenu(heroAppid!, heroFlags, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
        >
            <View style={[styles.heroArt, mode === 'tall' ? styles.heroArtTall : styles.heroArtWide]}>
                <HeroCrossfade appid={heroAppid!} />
                <LinearGradient
                    colors={['rgba(10,10,14,0)', 'rgba(10,10,14,0.92)']}
                    locations={[0.4, 1]}
                    style={StyleSheet.absoluteFill}
                    pointerEvents="none"
                />
                <View style={styles.heroArtBody}>
                    <Hearts />
                    <Text style={styles.heroName} numberOfLines={3}>{heroGame?.name ?? `App ${heroAppid}`}</Text>
                </View>
            </View>
            <View style={styles.heroChips}>
                {chips.map((chip, i) => (
                    <View key={chip.label} style={[styles.heroChip, i < chips.length - 1 && styles.heroChipBorder]}>
                        {chip.stars
                            ? (ratingStars
                                ? <LegendaryStars stars={ratingStars} variant="compact" size={10} />
                                : <Text style={styles.heroChipVal}>—</Text>)
                            : <Text style={[styles.heroChipVal, chip.accent && styles.heroChipValAccent]}>{chip.val}</Text>}
                        <Text style={styles.heroChipLabel}>{chip.label}</Text>
                    </View>
                ))}
            </View>
            {heroFlagTags.length > 0 && (
                <View style={styles.heroTags}>
                    {heroFlagTags.map(t => <Text key={t} style={styles.heroTag}>{t}</Text>)}
                </View>
            )}
            {!!heroReviewQuery.data?.review && (
                <Text style={styles.heroQuote} numberOfLines={4}>“{heroReviewQuery.data.review}”</Text>
            )}
        </Pressable>
    )

    const renderRestCard = (appid: number) => {
        const game = gameMap.get(appid)
        const hours = game?.playtime_forever ? formatPlaytime(game.playtime_forever) : null
        return (
                <Pressable
                    key={appid}
                    onPress={() => router.push(`/game/${appid}` as never)}
                    style={[styles.card, { width: cardWidth }]}
                    onLongPress={(e) => openGameCardMenu(appid, flagsQuery.data?.[appid], { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
                >
                    <View style={styles.cardImgWrap}>
                        {apiHost && (
                            <Image
                                source={{ uri: `${apiHost}/relay/images/steam/games/${appid}/header.jpg` }}
                                style={styles.cardImage}
                                contentFit="cover"
                                cachePolicy="memory-disk"
                                recyclingKey={String(appid)}
                            />
                        )}
                        {hours && <Text style={styles.cardHours}>{hours}</Text>}
                    </View>
                    <View style={styles.cardBody}>
                        <Text style={styles.cardName} numberOfLines={2}>{game?.name ?? `App ${appid}`}</Text>
                        <Hearts small />
                    </View>
                </Pressable>
        )
    }

    return (
        <ScrollView style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.eyebrow}>Collection</Text>
                <Text style={styles.title}>Favorites</Text>
                <Text style={styles.subtitle}>{subtitle}</Text>
            </View>

            <View style={styles.flow} onLayout={(e) => setFlowWidth(e.nativeEvent.layout.width - HPAD * 2)}>
                {flowWidth > 0 && (spanHero ? (
                    <View style={styles.heroRow}>
                        {renderHero(heroWidth, 'tall')}
                        <View style={[styles.grid, { width: rightGridWidth }]}>
                            {besideIds.map(renderRestCard)}
                        </View>
                    </View>
                ) : (
                    <View style={{ marginBottom: GAP }}>{renderHero(flowWidth, 'wide')}</View>
                ))}
                {flowWidth > 0 && belowIds.length > 0 && (
                    <View style={styles.grid}>{belowIds.map(renderRestCard)}</View>
                )}
            </View>
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    loadingText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.lg },
    emptyText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.xl, textAlign: 'center' },
    header: { padding: spacing.md },
    eyebrow: { color: FAV_ACCENT, fontFamily: fonts.uiBold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 },
    title: { color: colors.text, fontFamily: fonts.title, fontSize: 22 },
    subtitle: { color: colors.textMuted, fontFamily: fonts.ui, fontSize: 12, marginTop: 2 },

    flow: { paddingHorizontal: HPAD, paddingBottom: spacing.md },
    heroRow: { flexDirection: 'row', gap: GAP, marginBottom: GAP, alignItems: 'flex-start' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP, alignContent: 'flex-start' },

    // ── Hero (contained portrait card) ──
    hero: {
        flexDirection: 'column', borderWidth: 1, borderColor: FAV_ACCENT_BD, borderRadius: radius,
        overflow: 'hidden', backgroundColor: '#0d0d14',
    },
    heroArt: { position: 'relative', overflow: 'hidden', justifyContent: 'flex-end' },
    // Definite height (aspect-ratio off the known hero width) — NOT flex. A flex-derived height makes
    // HeroCrossfade's absolute-fill expo-image fail to cover-fit and render massively zoomed on Android
    // (documented gotcha). The row is top-aligned (flex-start) so the hero no longer stretches to the grid.
    heroArtTall: { aspectRatio: 16 / 10 },
    heroArtWide: { height: 200 },
    heroArtBody: { padding: spacing.md, gap: 6 },
    heroName: {
        color: '#fff', fontFamily: fonts.title, fontSize: 18, lineHeight: 22,
        textShadowColor: 'rgba(0,0,0,0.7)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 10,
    },
    heroChips: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: HAIRLINE },
    heroChip: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 4, gap: 3 },
    heroChipBorder: { borderRightWidth: 1, borderRightColor: HAIRLINE },
    heroChipVal: { color: '#e0e0e8', fontFamily: fonts.uiBold, fontSize: 13 },
    heroChipValAccent: { color: FAV_ACCENT },
    heroChipLabel: { color: '#666', fontFamily: fonts.ui, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5 },
    heroTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: HAIRLINE },
    heroTag: {
        color: FAV_ACCENT, fontFamily: fonts.uiBold, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5,
        backgroundColor: 'rgba(196,92,122,0.10)', borderWidth: 1, borderColor: 'rgba(196,92,122,0.22)',
        borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden',
    },
    heroQuote: {
        color: '#888', fontFamily: fonts.ui, fontSize: 11, fontStyle: 'italic', lineHeight: 17,
        paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderTopColor: HAIRLINE,
    },

    // ── Rest cards ──
    card: {
        flexDirection: 'column', backgroundColor: colors.bgRaised, borderWidth: 1, borderColor: colors.border,
        borderRadius: radius, overflow: 'hidden',
    },
    cardImgWrap: { width: '100%', aspectRatio: 460 / 215, backgroundColor: colors.bgHover },
    cardImage: { width: '100%', height: '100%' },
    cardHours: {
        position: 'absolute', bottom: 6, right: 6, color: FAV_ACCENT, fontFamily: fonts.uiBold, fontSize: 11,
        backgroundColor: 'rgba(10,10,14,0.75)', borderWidth: 1, borderColor: FAV_ACCENT_BD,
        borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden',
    },
    cardBody: { padding: spacing.xs, gap: 4, flex: 1 },
    cardName: { color: colors.text, fontFamily: fonts.ui, fontSize: 12, lineHeight: 16 },

    // ── Hearts ──
    hearts: { flexDirection: 'row', gap: 3 },
    heartLg: { color: FAV_ACCENT, fontSize: 13, textShadowColor: 'rgba(196,92,122,0.6)', textShadowRadius: 6 },
    heartSm: { color: FAV_ACCENT, fontSize: 10 },
})
