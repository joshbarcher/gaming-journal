import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'expo-router'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { getAlerts } from '@/api/alerts'
import { getFeatured } from '@/api/discover'
import { getFlags } from '@/api/flags'
import { getPosters } from '@/api/posters'
import { getSettings } from '@/api/settings'
import { useApiHost } from '@/hooks/useApiHost'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useHomeData } from '@/hooks/useHomeData'
import { colors, fonts, radius, spacing } from '@/theme/tokens'
import { FlipMosaic, type MosaicPoster } from '@/components/shared/FlipMosaic'
import { openGameCardMenu } from '@/components/shared/useGameCardMenu'
import { makeShouldShow } from '@/utils/gameFilter'
import type { AlertResult } from 'gaming-journal-contracts/alerts'
import type { FlagsStore } from 'gaming-journal-contracts/flags'

// Port of docs/features/global/home.md, rebuilt against the real source (Home.svelte,
// HomeMosaic.svelte, home.css) after a side-by-side screenshot comparison found the earlier
// version was missing real structure, not just polish: two fixed rows (not one continuous
// scroll), a release/sale/resume top row (0-3 cards), and a THIRD bottom-row mosaic (Discover) —
// the mosaic label is an overlaid pill on top of the art, not a separate row underneath it.
// No standalone "Now Playing" card here — that's now the sidebar's job (DrawerContent.tsx), which
// web's Home.svelte never duplicated either.
export default function HomeScreen() {
    const homeQuery = useHomeData()
    const apiHostQuery = useApiHost()
    const breakpoint = useBreakpoint()
    const apiHost = apiHostQuery.data
    const resume = homeQuery.data?.resume
    const release = homeQuery.data?.release

    const libraryPostersQuery  = useQuery({ queryKey: ['posters', 'library'],  queryFn: () => getPosters('library', 50) })
    const wishlistPostersQuery = useQuery({ queryKey: ['posters', 'wishlist'], queryFn: () => getPosters('wishlist', 50) })
    const discoverFeaturedQuery = useQuery({ queryKey: ['discover', 'featured'], queryFn: getFeatured })
    const alertsQuery = useQuery({ queryKey: ['alerts'], queryFn: getAlerts })
    const flagsQuery = useQuery({ queryKey: ['flags'], queryFn: getFlags })
    const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings })

    const shouldShowPoster = (appid: number) =>
        flagsQuery.data && settingsQuery.data ? makeShouldShow(flagsQuery.data, settingsQuery.data)(appid) : true

    const toMosaicPosters = (items: { appid: number; poster: string }[] | undefined): MosaicPoster[] =>
        apiHost && items ? items.filter(p => shouldShowPoster(p.appid)).map(p => ({ appid: p.appid, poster: `${apiHost}${p.poster}` })) : []
    const libraryPosters  = toMosaicPosters(libraryPostersQuery.data)
    const wishlistPosters = toMosaicPosters(wishlistPostersQuery.data)

    // Ports +page.server.ts's sampleDiscover(): flatten every featured section's items, drop
    // blocklisted titles + hidden flags, shuffle, cap at 50. Random each time new data arrives
    // (matches the server picking a fresh random sample per page load), not on every re-render.
    const discoverPosters = useMemo<MosaicPoster[]>(() => {
        if (!apiHost || !discoverFeaturedQuery.data || !flagsQuery.data || !settingsQuery.data) return []
        const shouldShow = makeShouldShow(flagsQuery.data, settingsQuery.data)
        const hideAdult = settingsQuery.data.hideAdultContent ?? true
        const blocked = (settingsQuery.data.titleBlocklist ?? []).map(t => t.toLowerCase())
        const items = discoverFeaturedQuery.data
            .flatMap(section => section.items ?? [])
            .filter(item => {
                if (!shouldShow(item.appid)) return false
                if (hideAdult && item.isAdult) return false
                if (blocked.length && blocked.some(t => item.name.toLowerCase().includes(t))) return false
                return true
            })
        const copy = [...items]
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1))
            ;[copy[i], copy[j]] = [copy[j], copy[i]]
        }
        return copy.slice(0, 50).map(item => ({ appid: item.appid, poster: `${apiHost}${item.headerImage}` }))
        // eslint-disable-next-line react-hooks/exhaustive-deps -- re-sample only when the underlying data changes
    }, [apiHost, discoverFeaturedQuery.data, flagsQuery.data, settingsQuery.data])

    // Ports +page.server.ts's saleGame pick: one random onSale alert per load, not re-rolled per render.
    const saleGame = useMemo<AlertResult | null>(() => {
        const onSale = alertsQuery.data?.onSale ?? []
        return onSale.length ? onSale[Math.floor(Math.random() * onSale.length)] : null
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [alertsQuery.data])

    const topRowCards = [
        release && { kind: 'release' as const, release },
        saleGame && { kind: 'sale' as const, saleGame },
        resume && { kind: 'resume' as const, resume },
    ].filter((c): c is NonNullable<typeof c> => Boolean(c))

    const stackMosaics = breakpoint === 'mobilePortrait' // matches home.css's ≤479 single-column rule
    // home.css: `.home-wrap { height:100vh; overflow:hidden; grid-template-rows:45fr 55fr }`,
    // overridden to `height:auto; overflow:visible` only below 800px (mobileLandscapeTabletPortrait/
    // mobilePortrait). Above that, Home fills the viewport with two proportional rows and no
    // scroll — cards stretch to fill their row instead of a small fixed height (the earlier
    // version used fixed 160/180px cards, which read as flat and undersized next to the real app).
    const isFixedHeightTier = breakpoint === 'tabletLandscape' || breakpoint === 'desktop'
    const hasTopRow = topRowCards.length > 0
    const spacingForTier = {
        mobilePortrait:                { padding: 16, gap: 12 },
        mobileLandscapeTabletPortrait: { padding: 20, gap: 16 },
        tabletLandscape:               { padding: 24, gap: 24 },
        desktop:                       { padding: 24, gap: 24 },
    }[breakpoint]

    const topRow = (
        <View style={[styles.row, !isFixedHeightTier && styles.rowAutoHeight, { gap: spacingForTier.gap }, isFixedHeightTier && { flex: 45 }]}>
            {topRowCards.map(card => (
                <TopRowCard key={card.kind} card={card} apiHost={apiHost} flags={flagsQuery.data} fixedHeight={isFixedHeightTier} />
            ))}
        </View>
    )
    const bottomRow = (
        <View style={[
            styles.row,
            stackMosaics && styles.rowStacked,
            !isFixedHeightTier && styles.rowAutoHeight,
            { gap: spacingForTier.gap },
            isFixedHeightTier && { flex: hasTopRow ? 55 : 100 },
        ]}>
            <MosaicPanel testID="mosaic-library"  title="View Library"   href="/library"  posters={libraryPosters}  fixedHeight={isFixedHeightTier} />
            <MosaicPanel testID="mosaic-wishlist" title="View Wishlist"  href="/wishlist" posters={wishlistPosters} fixedHeight={isFixedHeightTier} />
            <MosaicPanel testID="mosaic-discover" title="Discover Games" href="/discover" posters={discoverPosters} cols={2} fixedHeight={isFixedHeightTier} />
        </View>
    )

    if (isFixedHeightTier) {
        return (
            <View style={[styles.container, styles.content, { padding: spacingForTier.padding, gap: spacingForTier.gap }]}>
                {hasTopRow && topRow}
                {bottomRow}
            </View>
        )
    }

    return (
        <ScrollView
            style={styles.container}
            contentContainerStyle={[styles.content, { padding: spacingForTier.padding, gap: spacingForTier.gap }]}
        >
            {hasTopRow && topRow}
            {bottomRow}
        </ScrollView>
    )
}

type TopRowCardData =
    | { kind: 'release'; release: NonNullable<ReturnType<typeof useHomeData>['data']>['release'] }
    | { kind: 'sale'; saleGame: AlertResult }
    | { kind: 'resume'; resume: NonNullable<ReturnType<typeof useHomeData>['data']>['resume'] }

// Wraps the background Image + scrim in an absolutely-positioned View, giving each an explicit
// 100%/100% size relative to that already-sized wrapper — matching FlipMosaic's working pattern.
// Putting `StyleSheet.absoluteFill` directly on the <Image>/<LinearGradient> themselves (the
// original version here) rendered the image cropped to a fraction of the card's actual width on
// Android once the card's own size came from a flex weight instead of a literal pixel height —
// expo-image's cover-crop calc doesn't reliably resolve from inset-only absolute sizing alone.
function CardBackground({ uri }: { uri: string | undefined }) {
    return (
        <View style={StyleSheet.absoluteFill}>
            {uri && <Image source={{ uri }} style={styles.bgFill} contentFit="cover" />}
            <LinearGradient
                colors={['rgba(8,7,6,0)', 'rgba(8,7,6,0.75)', 'rgba(8,7,6,0.97)']}
                style={styles.bgFill}
            />
        </View>
    )
}

// The outer flex:1 element must be a plain View, not a Link-wrapped Pressable — `Link asChild`
// clones its child through Expo Router's Slot mechanism, and on Android that clone doesn't reliably
// inherit flex-basis sizing from the row it's in (found live: cards shrank to content width,
// leaving dead space to the right, while MosaicPanel — a plain View outer element — filled
// correctly). Fix: plain `View` carries the flex:1 sizing; the Link+Pressable is a separate,
// absolutely-positioned full-cover overlay on top purely for the tap target.
function TopRowCard({ card, apiHost, flags, fixedHeight }: { card: TopRowCardData; apiHost: string | undefined; flags: FlagsStore | undefined; fixedHeight: boolean }) {
    if (card.kind === 'release' && card.release) {
        const { release } = card
        return (
            <View style={[styles.topCard, !fixedHeight && styles.topCardAutoHeight]}>
                <CardBackground uri={apiHost ? `${apiHost}${release.header}` : undefined} />
                <View style={styles.topCardBody}>
                    <Text style={[styles.chip, { backgroundColor: '#c9a84c', color: '#0d0c0a' }]}>★ Released Today</Text>
                    <Text style={styles.topCardTitle} numberOfLines={1}>{release.name}</Text>
                    <Text style={styles.topCardMeta}>Available now on Steam</Text>
                </View>
                <Link href={`/game/${release.appid}` as never} asChild>
                    <Pressable
                        style={StyleSheet.absoluteFill}
                        onLongPress={(e) => openGameCardMenu(release.appid, flags?.[release.appid], { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
                    />
                </Link>
            </View>
        )
    }

    if (card.kind === 'sale') {
        const { saleGame } = card
        const cut = saleGame.bestPrice?.cut ?? 0
        const price = saleGame.bestPrice?.price != null ? `$${saleGame.bestPrice.price.toFixed(2)}` : ''
        const store = saleGame.bestPrice?.store ?? ''
        const external = saleGame.bestPrice?.url?.startsWith('http')
        const href = external ? saleGame.bestPrice!.url! : `/game/${saleGame.appid}`
        return (
            <View style={[styles.topCard, !fixedHeight && styles.topCardAutoHeight]}>
                <CardBackground uri={apiHost ? `${apiHost}/relay/images/steam/games/${saleGame.appid}/header.jpg` : undefined} />
                <View style={styles.topCardBody}>
                    <Text style={[styles.chip, { backgroundColor: '#4caf50', color: '#0a160a' }]}>On Sale −{cut}%</Text>
                    <Text style={styles.topCardTitle} numberOfLines={1}>{saleGame.name}</Text>
                    <Text style={styles.topCardMeta}>{price ? `${price} · ` : ''}{store}</Text>
                </View>
                <Link href={href as never} asChild>
                    <Pressable
                        style={StyleSheet.absoluteFill}
                        onLongPress={(e) => openGameCardMenu(saleGame.appid, flags?.[saleGame.appid], { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
                    />
                </Link>
            </View>
        )
    }

    if (card.kind === 'resume' && card.resume) {
        const { resume } = card
        return (
            <View style={[styles.topCard, !fixedHeight && styles.topCardAutoHeight]}>
                <CardBackground uri={apiHost ? `${apiHost}${resume.header}` : undefined} />
                <View style={styles.topCardBody}>
                    <Text style={[styles.chip, { backgroundColor: '#4ecdc4', color: '#061313' }]}>▶ Resume</Text>
                    <Text style={styles.topCardTitle} numberOfLines={1}>{resume.name}</Text>
                    <Text style={styles.topCardMeta}>
                        {resume.hours.toFixed(1)}h played · {resume.daysAgo === 0 ? 'Today' : resume.daysAgo === 1 ? 'Yesterday' : `${resume.daysAgo} days ago`}
                    </Text>
                </View>
                <Link href={`/game/${resume.appid}` as never} asChild>
                    <Pressable
                        style={StyleSheet.absoluteFill}
                        onLongPress={(e) => openGameCardMenu(resume.appid, flags?.[resume.appid], { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })}
                    />
                </Link>
            </View>
        )
    }

    return null
}

function MosaicPanel({ testID, title, href, posters, cols = 3, fixedHeight }: {
    testID: string; title: string; href: string; posters: MosaicPoster[]; cols?: 2 | 3; fixedHeight: boolean
}) {
    return (
        <View style={[styles.mosaicPanel, !fixedHeight && styles.mosaicPanelAutoHeight]} testID={testID}>
            {/* The individual mosaic poster tiles each link to /game/{appid}, but that per-tile
                Pressable lives inside the shared FlipMosaic component (7 call sites app-wide), not here.
                Wiring the game-card long-press menu onto them belongs in FlipMosaic itself so every
                caller gets it consistently — out of scope for this screen's edit. */}
            <FlipMosaic posters={posters} cols={cols} />
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <LinearGradient colors={['rgba(8,7,6,0.42)', 'rgba(8,7,6,0.12)']} style={styles.bgFill} />
            </View>
            <Link href={href as never} asChild>
                <Pressable style={styles.mosaicLabelWrap}>
                    <Text style={styles.mosaicLabel}>{title}</Text>
                </Pressable>
            </Link>
        </View>
    )
}

const styles = StyleSheet.create({
    container: {
        flex:            1,
        backgroundColor: colors.bg,
    },
    bgFill: {
        width:  '100%',
        height: '100%',
    },
    content: {
        // padding/gap set inline per-breakpoint above
    },
    row: {
        flexDirection: 'row',
        // gap set inline per-breakpoint above; flex weight (45/55/100) set inline on fixed tiers
    },
    rowStacked: {
        flexDirection: 'column',
    },
    rowAutoHeight: {
        // Mobile/scrollable tiers have no bounding row height to stretch into (ScrollView content
        // grows to fit) — cards fall back to their own explicit height instead.
    },
    topCard: {
        flex:            1,
        borderRadius:    radius,
        borderWidth:     1,
        borderColor:     colors.border,
        overflow:        'hidden',
        justifyContent:  'flex-end',
        backgroundColor: colors.bgHover,
    },
    topCardAutoHeight: {
        height: 160,
    },
    topCardBody: {
        padding: spacing.lg,
        gap:     4,
    },
    chip: {
        alignSelf:         'flex-start',
        fontFamily:        fonts.uiBold,
        fontSize:          10,
        letterSpacing:     1,
        textTransform:     'uppercase',
        paddingVertical:   3,
        paddingHorizontal: 8,
        borderRadius:      3,
        marginBottom:      2,
        overflow:          'hidden',
    },
    topCardTitle: {
        color:      '#fff',
        fontFamily: fonts.title,
        fontSize:   18,
    },
    topCardMeta: {
        color:      'rgba(237, 233, 223, 0.65)',
        fontFamily: fonts.ui,
        fontSize:   12,
    },
    mosaicPanel: {
        flex:            1,
        borderRadius:    radius,
        borderWidth:     1,
        borderColor:     colors.border,
        overflow:        'hidden',
        alignItems:      'center',
        justifyContent:  'center',
        backgroundColor: colors.bgHover,
    },
    mosaicPanelAutoHeight: {
        height: 180,
    },
    mosaicLabelWrap: {
        position: 'absolute',
    },
    mosaicLabel: {
        color:             '#fff',
        fontFamily:        fonts.title,
        fontSize:          15,
        letterSpacing:     1,
        backgroundColor:   'rgba(0, 0, 0, 0.45)',
        borderWidth:       1,
        borderColor:       'rgba(255, 255, 255, 0.18)',
        paddingVertical:   10,
        paddingHorizontal: 22,
        borderRadius:      4,
        overflow:          'hidden',
    },
})
