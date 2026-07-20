import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, Text, View } from 'react-native'

import {
    fetchHltbColdCache, getCommunityReviewsForHero, getGameDetail, getGameFlags, getItadForGame,
    getLocalWishlistEntry, getNews, getPcgwForGame, getPlayerCounts, getProtonDbForGame, getTrailers,
    pokeNewsRefresh, refreshAboutDescription, refreshHltbForGame, refreshItadForGame, refreshNews,
    refreshPcgwForGame, refreshProtonDbForGame, syncCommunityReviews,
} from '@/api/gamePage'
import { getLocalReview } from '@/api/localReview'
import { getSteamReview } from '@/api/steamReview'
import { About } from '@/components/game/About'
import { CommunityReviews } from '@/components/game/CommunityReviews'
import { FlagsBar } from '@/components/game/FlagsBar'
import { GameHero } from '@/components/game/GameHero'
import { HltbSection } from '@/components/game/HltbSection'
import { ItadPrices } from '@/components/game/ItadPrices'
import { LocalReviewCard } from '@/components/game/LocalReviewCard'
import { MyReview } from '@/components/game/MyReview'
import { News } from '@/components/game/News'
import { NexusMods } from '@/components/game/NexusMods'
import { PCGW } from '@/components/game/PCGW'
import { ReleaseBanner } from '@/components/game/ReleaseBanner'
import { PlayerChart } from '@/components/game/PlayerChart'
import { ProtonDB } from '@/components/game/ProtonDB'
import { GameSectionRail, GAME_SECTIONS } from '@/components/game/GameSectionRail'
import { GameUpdateBadge } from '@/components/game/GameUpdateBadge'
import { Screenshots } from '@/components/game/Screenshots'
import { Trailers } from '@/components/game/Trailers'
import { useApiHost } from '@/hooks/useApiHost'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { colors, fonts, spacing } from '@/theme/tokens'
import { newsBBCodeDirty, releaseStatus } from '@/utils/gameRender'
import type { GameDetail } from 'gaming-journal-contracts/gameDetail'

// Port of game/game-page.md's base screen plus the Reviews (game/reviews.md) and Pricing
// (game/pricing.md — ITAD deal cards; GDP's current-price chip was already ported into GameHero's
// stats panel) sections. Now covers the full real GamePage.svelte section list.
//
// No Web Worker (per PLAN.md) — "Phase 2" background sections are just separate useQuery hooks,
// each independently loading/erroring, same practical effect (one hanging request doesn't block
// others) without the worker's message-passing plumbing.
//
// NavRail deliberately NOT built — it's `display:none` below 1280px in the web's own CSS, i.e.
// invisible at all 3 of this app's required breakpoints (which top out at 1279px). Building and
// screenshot-verifying a component that can never be seen at any required tier isn't a good use of
// this already-large item's effort; revisit if/when a true desktop-width tier becomes a target.
export default function GameDetailScreen() {
    const { appid: appidStr } = useLocalSearchParams<{ appid: string }>()
    const appid = Number(appidStr)
    const apiHostQuery = useApiHost()
    const apiHost = apiHostQuery.data
    const queryClient = useQueryClient()

    const gameQuery = useQuery({ queryKey: ['gameDetail', appid], queryFn: () => getGameDetail(appid) })
    const communityQuery = useQuery({ queryKey: ['communityReviewsHero', appid], queryFn: () => getCommunityReviewsForHero(appid) })
    const playerCountsQuery = useQuery({ queryKey: ['playerCounts', appid], queryFn: () => getPlayerCounts(appid) })
    const flagsQuery = useQuery({ queryKey: ['gameFlags', appid], queryFn: () => getGameFlags(appid) })
    const trailersQuery = useQuery({ queryKey: ['trailers', appid], queryFn: () => getTrailers(appid) })
    const wishlistQuery = useQuery({ queryKey: ['localWishlistEntry', appid], queryFn: () => getLocalWishlistEntry(appid) })
    // Reviews section (game/reviews.md). communityQuery above already covers CommunityReviews'
    // needs too — same endpoint/schema, extended to include the individual reviews[] list, so no
    // second fetch is needed for the full section vs. the hero's compact score chip.
    const localReviewQuery = useQuery({ queryKey: ['localReview', appid], queryFn: () => getLocalReview(appid) })
    const steamReviewQuery = useQuery({ queryKey: ['steamReview', appid], queryFn: () => getSteamReview(appid) })

    const status = releaseStatus(gameQuery.data?.store)
    const notSoon = status !== 'coming_soon'
    const isDiscovered = gameQuery.data?.source === 'discovered'

    const protonQuery = useQuery({ queryKey: ['protonDb', appid], queryFn: () => getProtonDbForGame(appid) })
    // PCGW: discovered games have no backfill, so getPcgwForGame issues a fetch-by-name for them
    // (cold-cache trigger, mirroring GamePage.svelte). Gated on the game being loaded so the name is
    // available for that fetch.
    const pcgwQuery = useQuery({
        queryKey: ['pcgw', appid],
        queryFn: () => getPcgwForGame(appid, isDiscovered, gameQuery.data?.name ?? ''),
        enabled: notSoon && !!gameQuery.data,
    })
    const newsQuery = useQuery({ queryKey: ['news', appid], queryFn: () => getNews(appid) })
    // ITAD always runs regardless of release status (hasItad = true unconditionally, per pricing.md)
    const itadQuery = useQuery({
        queryKey: ['itad', appid],
        queryFn: () => getItadForGame(appid, isDiscovered, gameQuery.data?.name ?? ''),
        enabled: !!gameQuery.data,
    })

    const hltbRefresh = useMutation({
        mutationFn: () => refreshHltbForGame(appid),
        onSuccess: (data) => queryClient.setQueryData(['gameDetail', appid], data),
    })
    const protonRefresh = useMutation({
        mutationFn: () => refreshProtonDbForGame(appid),
        onSuccess: (data) => queryClient.setQueryData(['protonDb', appid], data),
    })
    const pcgwRefresh = useMutation({
        mutationFn: () => refreshPcgwForGame(appid),
        onSuccess: (data) => queryClient.setQueryData(['pcgw', appid], data),
    })
    const itadRefresh = useMutation({
        mutationFn: () => refreshItadForGame(appid, isDiscovered, gameQuery.data?.name ?? ''),
        onSuccess: (data) => queryClient.setQueryData(['itad', appid], data),
    })

    // ── Cold-cache population ─────────────────────────────────────────────────────
    // Web's Phase 2 auto-fills empty sections (GamePage.svelte onMount). Native reads only cached
    // data, so these mirror that: when a section's data comes back empty, POST/GET the relevant
    // sync then patch the cache via setQueryData. A per-key ref guards against re-firing (setQueryData
    // re-renders → effect re-runs), so each trigger runs at most once per appid — no refetch loop.
    const coldRef = useRef<Set<string>>(new Set())
    const fireOnce = (key: string, run: () => void) => {
        if (coldRef.current.has(key)) return
        coldRef.current.add(key)
        run()
    }

    const communitySync = useMutation({
        mutationFn: () => syncCommunityReviews(appid),
        onSuccess: (data) => { if (data) queryClient.setQueryData(['communityReviewsHero', appid], data) },
    })
    const hltbCold = useMutation({
        mutationFn: () => fetchHltbColdCache(appid, gameQuery.data?.name ?? ''),
        onSuccess: (data) => queryClient.setQueryData(['gameDetail', appid], data),
    })
    const aboutCold = useMutation({
        mutationFn: () => refreshAboutDescription(appid),
        onSuccess: (refreshed) => {
            const desc = refreshed.store?.detailedDescription
            if (!desc) return
            queryClient.setQueryData<GameDetail>(['gameDetail', appid], (old) =>
                old ? { ...old, store: { ...(old.store ?? {}), detailedDescription: desc } } : old)
        },
    })
    const newsRefresh = useMutation({
        mutationFn: () => refreshNews(appid),
        onSuccess: (data) => queryClient.setQueryData(['news', appid], data),
    })

    // Community reviews: uncached hero endpoint returns null → sync then re-GET (needsCommunitySync).
    useEffect(() => {
        if (!gameQuery.isSuccess || !communityQuery.isSuccess) return
        if (!notSoon || communityQuery.data != null) return
        fireOnce(`cr:${appid}`, () => communitySync.mutate())
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameQuery.isSuccess, communityQuery.isSuccess, communityQuery.data, notSoon, appid])

    // HLTB: unmatched non-coming-soon games kick off an on-demand search, then re-read game detail.
    useEffect(() => {
        const g = gameQuery.data
        if (!gameQuery.isSuccess || !g || !notSoon || g.hltb?.matched) return
        fireOnce(`hltb:${appid}`, () => hltbCold.mutate())
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameQuery.isSuccess, gameQuery.data, notSoon, appid])

    // About: library/wishlist games missing a description get a background ?refresh=true re-pull.
    useEffect(() => {
        const g = gameQuery.data
        if (!gameQuery.isSuccess || !g) return
        const hasAbout = !g.store?.detailedDescription && !!g.store && !g.store.unavailable && g.source !== 'discovered'
        if (!hasAbout) return
        fireOnce(`about:${appid}`, () => aboutCold.mutate())
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gameQuery.isSuccess, gameQuery.data, appid])

    // News: refresh a BBCode-dirty/stale cache (then patch), else fire-and-forget warm the cache.
    useEffect(() => {
        if (!newsQuery.isSuccess) return
        fireOnce(`news:${appid}`, () => {
            if (newsBBCodeDirty(newsQuery.data)) newsRefresh.mutate()
            else pokeNewsRefresh(appid)
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [newsQuery.isSuccess, appid])

    // ── Left section-jump rail (web NavRail) — wide/desktop tier only ─────────────────────────
    const breakpoint = useBreakpoint()
    const isWide = breakpoint === 'tabletLandscape' || breakpoint === 'desktop'
    const scrollRef = useRef<ScrollView>(null)
    const sectionYs = useRef<Map<string, number>>(new Map())
    const bodyY = useRef(0)
    const viewportH = useRef(0)
    const [present, setPresent] = useState<Set<string>>(() => new Set(['top']))
    const [activeSection, setActiveSection] = useState('top')
    const [pastHero, setPastHero] = useState(false)

    const regSection = useCallback((id: string, y: number, height: number) => {
        sectionYs.current.set(id, y)
        if (height > 24) setPresent(prev => (prev.has(id) ? prev : new Set(prev).add(id)))
    }, [])
    const absoluteY = useCallback((id: string) => (id === 'top' ? 0 : bodyY.current + (sectionYs.current.get(id) ?? 1e9)), [])
    const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const scrollY = e.nativeEvent.contentOffset.y
        setPastHero(prev => { const v = scrollY > 220; return prev === v ? prev : v })
        const line = scrollY + viewportH.current * 0.4
        let active = 'top'
        for (const s of GAME_SECTIONS) {
            if (present.has(s.id) && absoluteY(s.id) <= line) active = s.id
        }
        setActiveSection(prev => (prev === active ? prev : active))
    }, [present, absoluteY])
    const jumpTo = useCallback((id: string) => {
        scrollRef.current?.scrollTo({ y: id === 'top' ? 0 : Math.max(0, absoluteY(id) - 8), animated: true })
    }, [absoluteY])

    if (gameQuery.isLoading) {
        return <View style={styles.container}><Text style={styles.loadingText}>Loading game…</Text></View>
    }
    if (gameQuery.isError || !gameQuery.data) {
        return <View style={styles.container}><Text style={styles.emptyText}>Game not found.</Text></View>
    }

    const game = gameQuery.data
    const sec = (id: string, node: ReactNode) => (
        <View key={id} onLayout={e => regSection(id, e.nativeEvent.layout.y, e.nativeEvent.layout.height)}>{node}</View>
    )
    // Live "content updating" badge — the Phase-2 background sections still loading (web's cells badge).
    const loadingSections = [
        playerCountsQuery.isLoading && 'Player Count',
        newsQuery.isLoading && 'News',
        communityQuery.isLoading && 'Reviews',
        itadQuery.isLoading && 'Prices',
        protonQuery.isLoading && 'ProtonDB',
        notSoon && pcgwQuery.isLoading && 'PCGW',
    ].filter((s): s is string => !!s)

    return (
        <View style={styles.root}>
            <ScrollView ref={scrollRef} style={styles.container} scrollEventThrottle={16} onScroll={onScroll}
                onLayout={e => { viewportH.current = e.nativeEvent.layout.height }}>
                <GameHero
                    game={game}
                    communityReviews={communityQuery.data}
                    protonTier={protonQuery.data}
                    apiHost={apiHost}
                />
                {game.store?.unavailable && (
                    <View style={styles.unavailableBanner}>
                        <Text style={styles.unavailableText}>This game is no longer available on Steam.</Text>
                    </View>
                )}
                <ReleaseBanner store={game.store} />
                {flagsQuery.data && (
                    <FlagsBar
                        appid={appid}
                        game={game}
                        initialFlags={flagsQuery.data}
                        localWishlisted={wishlistQuery.data?.wishlisted ?? false}
                    />
                )}

                <View style={[styles.body, isWide && styles.bodyWide]} onLayout={e => { bodyY.current = e.nativeEvent.layout.y }}>
                    {trailersQuery.data && trailersQuery.data.length > 0 && sec('trailers',
                        <Trailers appid={appid} trailers={trailersQuery.data} apiHost={apiHost} />)}
                    {sec('about', <About detailedDescription={game.store?.detailedDescription} />)}
                    {notSoon && sec('hltb', <HltbSection game={game} onRefresh={async () => { await hltbRefresh.mutateAsync() }} />)}
                    {sec('players', <PlayerChart data={playerCountsQuery.data} />)}
                    {sec('screenshots', <Screenshots appid={appid} screenshots={game.media?.screenshots ?? []} apiHost={apiHost} />)}
                    {newsQuery.data?.items && newsQuery.data.items.length > 0 && sec('news',
                        <News appid={appid} items={newsQuery.data.items} apiHost={apiHost} />)}
                    {sec('localreview', <LocalReviewCard appid={appid} review={localReviewQuery.data} />)}
                    {sec('steamreview', <MyReview review={steamReviewQuery.data?.review} />)}
                    {sec('community', <CommunityReviews data={communityQuery.data} />)}
                    {sec('prices', <ItadPrices
                        data={itadQuery.data}
                        apiHost={apiHost}
                        refreshing={itadRefresh.isPending}
                        onRefresh={() => itadRefresh.mutate()}
                    />)}
                    {sec('proton', <ProtonDB
                        appid={appid}
                        data={protonQuery.data}
                        refreshing={protonRefresh.isPending}
                        onRefresh={() => protonRefresh.mutate()}
                    />)}
                    {notSoon && sec('pcgw', <PCGW data={pcgwQuery.data} refreshing={pcgwRefresh.isPending} onRefresh={() => pcgwRefresh.mutate()} />)}
                    {/* Self-fetching; renders nothing unless the game is on Nexus and has mods. */}
                    {sec('mods', <NexusMods appid={appid} name={game.name} />)}
                </View>
            </ScrollView>
            {isWide && pastHero && <GameSectionRail present={present} active={activeSection} onJump={jumpTo} />}
            <GameUpdateBadge sections={loadingSections} />
        </View>
    )
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    container: { flex: 1, backgroundColor: colors.bg },
    loadingText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.lg },
    emptyText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.xl, textAlign: 'center' },
    unavailableBanner: { backgroundColor: 'rgba(224,80,80,0.12)', padding: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
    unavailableText: { color: '#e05050', fontFamily: fonts.ui, fontSize: 12, textAlign: 'center' },
    body: { paddingBottom: spacing.xl },
    // web NavRail sits in the sidebar↔content gutter; native indents the section column so the
    // fixed rail (GameSectionRail, left:6) has room without overlapping the content.
    bodyWide: { paddingLeft: 44 },
})
