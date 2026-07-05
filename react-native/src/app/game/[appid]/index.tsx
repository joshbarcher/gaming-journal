import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams } from 'expo-router'
import { ScrollView, StyleSheet, Text, View } from 'react-native'

import {
    getCommunityReviewsForHero, getGameDetail, getGameFlags, getItadForGame, getLocalWishlistEntry,
    getNews, getPcgwForGame, getPlayerCounts, getProtonDbForGame, getTrailers,
    refreshHltbForGame, refreshItadForGame, refreshPcgwForGame, refreshProtonDbForGame,
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
import { PCGW } from '@/components/game/PCGW'
import { PlayerChart } from '@/components/game/PlayerChart'
import { ProtonDB } from '@/components/game/ProtonDB'
import { Screenshots } from '@/components/game/Screenshots'
import { Trailers } from '@/components/game/Trailers'
import { useApiHost } from '@/hooks/useApiHost'
import { colors, fonts, spacing } from '@/theme/tokens'
import { releaseStatus } from '@/utils/gameRender'

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

    const protonQuery = useQuery({ queryKey: ['protonDb', appid], queryFn: () => getProtonDbForGame(appid) })
    const pcgwQuery = useQuery({ queryKey: ['pcgw', appid], queryFn: () => getPcgwForGame(appid), enabled: notSoon })
    const newsQuery = useQuery({ queryKey: ['news', appid], queryFn: () => getNews(appid) })
    // ITAD always runs regardless of release status (hasItad = true unconditionally, per pricing.md)
    const isDiscovered = gameQuery.data?.source === 'discovered'
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

    if (gameQuery.isLoading) {
        return <View style={styles.container}><Text style={styles.loadingText}>Loading game…</Text></View>
    }
    if (gameQuery.isError || !gameQuery.data) {
        return <View style={styles.container}><Text style={styles.emptyText}>Game not found.</Text></View>
    }

    const game = gameQuery.data

    return (
        <ScrollView style={styles.container}>
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
            {flagsQuery.data && (
                <FlagsBar
                    appid={appid}
                    game={game}
                    initialFlags={flagsQuery.data}
                    localWishlisted={wishlistQuery.data?.wishlisted ?? false}
                />
            )}

            <View style={styles.body}>
                {trailersQuery.data && trailersQuery.data.length > 0 && (
                    <Trailers appid={appid} trailers={trailersQuery.data} apiHost={apiHost} />
                )}
                <About detailedDescription={game.store?.detailedDescription} />
                {notSoon && (
                    <HltbSection game={game} onRefresh={async () => { await hltbRefresh.mutateAsync() }} />
                )}
                <PlayerChart data={playerCountsQuery.data} />
                <Screenshots appid={appid} screenshots={game.media?.screenshots ?? []} apiHost={apiHost} />
                {newsQuery.data?.items && newsQuery.data.items.length > 0 && <News items={newsQuery.data.items} />}
                <LocalReviewCard appid={appid} review={localReviewQuery.data} />
                <MyReview review={steamReviewQuery.data?.review} />
                <CommunityReviews data={communityQuery.data} />
                <ItadPrices
                    data={itadQuery.data}
                    apiHost={apiHost}
                    refreshing={itadRefresh.isPending}
                    onRefresh={() => itadRefresh.mutate()}
                />
                <ProtonDB
                    appid={appid}
                    data={protonQuery.data}
                    refreshing={protonRefresh.isPending}
                    onRefresh={() => protonRefresh.mutate()}
                />
                {notSoon && (
                    <PCGW data={pcgwQuery.data} refreshing={pcgwRefresh.isPending} onRefresh={() => pcgwRefresh.mutate()} />
                )}
            </View>
        </ScrollView>
    )
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg },
    loadingText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.lg },
    emptyText: { color: colors.textMuted, fontFamily: fonts.ui, padding: spacing.xl, textAlign: 'center' },
    unavailableBanner: { backgroundColor: 'rgba(224,80,80,0.12)', padding: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
    unavailableText: { color: '#e05050', fontFamily: fonts.ui, fontSize: 12, textAlign: 'center' },
    body: { paddingBottom: spacing.xl },
})
