/**
 * verify-contracts.ts — hits the live gaming-journal/relay servers and checks that
 * real responses actually match the Zod schemas in contracts/. Run this any time a
 * schema is added or an endpoint is suspected to have drifted.
 *
 * Usage:
 *   npx tsx scripts/verify-contracts.ts
 *   HOST=192.168.86.65 npx tsx scripts/verify-contracts.ts   # override for the LAN box
 */
import { SteamGamesListSchema } from '../contracts/steamGamesList.ts'
import { FlagsStoreSchema } from '../contracts/flags.ts'
import { NowPlayingSchema } from '../contracts/nowPlaying.ts'
import { HomeDataSchema } from '../contracts/home.ts'
import { DiscoverSearchResultsSchema } from '../contracts/discoverSearch.ts'
import { DiscoverFeaturedResponseSchema } from '../contracts/discoverFeatured.ts'
import { OwnershipResponseSchema } from '../contracts/ownership.ts'
import { PostersResponseSchema } from '../contracts/posters.ts'
import { WishlistResponseSchema } from '../contracts/wishlist.ts'
import { OrderSchema } from '../contracts/order.ts'
import { HltbIndexSchema } from '../contracts/hltb.ts'
import { LocalReviewSchema } from '../contracts/localReview.ts'
import { CommunityReviewsSchema } from '../contracts/communityReviews.ts'
import { TopGamesResponseSchema } from '../contracts/topGames.ts'
import { FranchiseListSchema } from '../contracts/franchises.ts'
import { RelayGamesListSchema } from '../contracts/relayGames.ts'
import { GameDetailSchema } from '../contracts/gameDetail.ts'
import { PlayerCountsSchema } from '../contracts/playerCounts.ts'
import { VideosResponseSchema } from '../contracts/videos.ts'
import { NewsResponseSchema } from '../contracts/news.ts'
import { ProtonDbRawSchema } from '../contracts/protondb.ts'
import { PcgwSchema } from '../contracts/pcgw.ts'
import { LocalWishlistEntrySchema } from '../contracts/localWishlistEntry.ts'
import { SteamReviewResponseSchema } from '../contracts/steamReview.ts'
import { ItadDataSchema } from '../contracts/itad.ts'
import { AchievementsResponseSchema } from '../contracts/achievements.ts'
import { AccountSessionsResponseSchema } from '../contracts/journalSessions.ts'
import { PagesResponseSchema } from '../contracts/pages.ts'
import { JournalNotesResponseSchema } from '../contracts/journalNotes.ts'
import { DownloadedGuidesResponseSchema } from '../contracts/downloadedGuides.ts'
import { GuideContentResponseSchema } from '../contracts/guideContent.ts'
import { GuideMetaSchema } from '../contracts/guideMeta.ts'
import { GuideFulltextResponseSchema } from '../contracts/guideFulltext.ts'
import { GuideSearchGetResponseSchema } from '../contracts/guideSearch.ts'
import { GuideJobsResponseSchema } from '../contracts/guideJobs.ts'
import { TrackerSuggestJobsResponseSchema } from '../contracts/trackerSuggest.ts'
import { SettingsSchema } from '../contracts/settings.ts'
import { ReleasesResponseSchema } from '../contracts/releases.ts'
import { RedditDataSchema, RedditThreadSchema } from '../contracts/reddit.ts'
import { CommunityPrefsSchema } from '../contracts/communityPrefs.ts'
import { RedditSubredditsResponseSchema } from '../contracts/redditSubreddits.ts'
import { AccountDataSchema } from '../contracts/account.ts'
import { AllLocalReviewsSchema } from '../contracts/localReview.ts'

// Default to localhost now — both servers run locally per the standing dev setup (PLAN.md),
// not the LAN box (which is a separate, sometimes-stale deployment target).
const HOST = process.env.HOST ?? 'localhost'
const GATEWAY = `http://${HOST}:8061`

type Check = {
    name:   string
    url:    string
    schema: { safeParse: (data: unknown) => { success: boolean; error?: unknown } }
}

const checks: Check[] = [
    { name: 'SteamGamesList',   url: `${GATEWAY}/relay/api/steam/games`, schema: SteamGamesListSchema },
    { name: 'Flags',            url: `${GATEWAY}/api/flags`, schema: FlagsStoreSchema },
    { name: 'NowPlaying',       url: `${GATEWAY}/relay/api/steam/now-playing`, schema: NowPlayingSchema },
    { name: 'HomeData',         url: `${GATEWAY}/relay/api/home`, schema: HomeDataSchema },
    { name: 'DiscoverSearch',   url: `${GATEWAY}/relay/api/discover/search?q=persona&limit=8&offset=0`, schema: DiscoverSearchResultsSchema },
    { name: 'DiscoverFeatured', url: `${GATEWAY}/relay/api/discover/featured`, schema: DiscoverFeaturedResponseSchema },
    { name: 'Ownership',        url: `${GATEWAY}/relay/api/games/ownership`, schema: OwnershipResponseSchema },
    { name: 'Posters',          url: `${GATEWAY}/relay/api/games/posters?source=library&n=20`, schema: PostersResponseSchema },
    { name: 'Wishlist',         url: `${GATEWAY}/relay/api/wishlist`, schema: WishlistResponseSchema },
    { name: 'Order',            url: `${GATEWAY}/api/order/backlog`, schema: OrderSchema },
    { name: 'HltbIndex',        url: `${GATEWAY}/relay/api/hltb`, schema: HltbIndexSchema },
    // appid 1245620 (ELDEN RING) confirmed to have a real local review with badges/notes populated
    { name: 'LocalReview',      url: `${GATEWAY}/api/local-reviews/1245620`, schema: LocalReviewSchema },
    // Same appid confirmed to have 100 real cached individual community reviews, not just a summary
    { name: 'CommunityReviews', url: `${GATEWAY}/relay/api/steam/community-reviews/1245620`, schema: CommunityReviewsSchema },
    { name: 'SteamReview',      url: `${GATEWAY}/relay/api/steam/reviews/1245620`, schema: SteamReviewResponseSchema },
    { name: 'TopGames',         url: `${GATEWAY}/relay/api/player-counts/top?n=100&includeFiltered=true`, schema: TopGamesResponseSchema },
    { name: 'Franchises',       url: `${GATEWAY}/api/franchises`, schema: FranchiseListSchema },
    { name: 'RelayGames',       url: `${GATEWAY}/relay/api/games`, schema: RelayGamesListSchema },
    // appid 1245620 = ELDEN RING, confirmed real owned game with rich hltb/itad/pcgw/media data
    { name: 'GameDetail',       url: `${GATEWAY}/relay/api/games/1245620`, schema: GameDetailSchema },
    { name: 'PlayerCounts',     url: `${GATEWAY}/relay/api/player-counts/1245620`, schema: PlayerCountsSchema },
    { name: 'Videos',           url: `${GATEWAY}/relay/api/videos/1245620`, schema: VideosResponseSchema },
    { name: 'News',             url: `${GATEWAY}/relay/api/news/1245620`, schema: NewsResponseSchema },
    { name: 'ProtonDb',         url: `${GATEWAY}/relay/api/protondb/1245620`, schema: ProtonDbRawSchema },
    { name: 'Pcgw',             url: `${GATEWAY}/relay/api/pcgw/1245620`, schema: PcgwSchema },
    { name: 'LocalWishlistEntry', url: `${GATEWAY}/api/local-wishlist/1245620`, schema: LocalWishlistEntrySchema },
    { name: 'Itad',             url: `${GATEWAY}/relay/api/itad/1245620`, schema: ItadDataSchema },
    { name: 'Achievements',     url: `${GATEWAY}/relay/api/steam/achievements/1245620`, schema: AchievementsResponseSchema },
    { name: 'AccountSessions',  url: `${GATEWAY}/relay/api/account`, schema: AccountSessionsResponseSchema },
    // appid 2161700 (Persona 3 Reload) confirmed to have real pages (11) and session data
    { name: 'Pages',            url: `${GATEWAY}/api/pages?appid=2161700`, schema: PagesResponseSchema },
    { name: 'JournalNotes',     url: `${GATEWAY}/api/journal-notes/2161700`, schema: JournalNotesResponseSchema },
    { name: 'DownloadedGuides', url: `${GATEWAY}/relay/api/guides/2161700`, schema: DownloadedGuidesResponseSchema },
    // A real page with all 4 non-section block types (paragraph/image/table observed; list
    // confirmed separately on a different page during this item's research)
    { name: 'GuideContent', url: `${GATEWAY}/relay/api/guides/2161700/ign/persona-3-reload/missing-person-locations-and-dates`, schema: GuideContentResponseSchema },
    { name: 'GuideMeta',    url: `${GATEWAY}/relay/api/guides/2161700/ign/persona-3-reload/meta`, schema: GuideMetaSchema },
    { name: 'GuideFulltext', url: `${GATEWAY}/relay/api/guides/2161700/ign/persona-3-reload/fulltext`, schema: GuideFulltextResponseSchema },
    { name: 'GuideSearch',   url: `${GATEWAY}/relay/api/guides/2161700/search`, schema: GuideSearchGetResponseSchema },
    { name: 'GuideJobs',     url: `${GATEWAY}/relay/api/guides/jobs`, schema: GuideJobsResponseSchema },
    { name: 'TrackerSuggestJobs', url: `${GATEWAY}/relay/api/progress-suggest/jobs`, schema: TrackerSuggestJobsResponseSchema },
    { name: 'Settings',      url: `${GATEWAY}/api/settings`, schema: SettingsSchema },
    { name: 'Releases',      url: `${GATEWAY}/relay/api/steam/releases`, schema: ReleasesResponseSchema },
    // appid 2161700 (Persona 3 Reload) confirmed to have real cached Reddit data across 4 subreddits
    { name: 'RedditData',    url: `${GATEWAY}/relay/api/reddit/2161700`, schema: RedditDataSchema },
    { name: 'RedditThread',  url: `${GATEWAY}/relay/api/reddit/2161700/thread/1af07sq?sub=persona3reload`, schema: RedditThreadSchema },
    { name: 'CommunityPrefs', url: `${GATEWAY}/api/community-prefs`, schema: CommunityPrefsSchema },
    { name: 'RedditSubreddits', url: `${GATEWAY}/api/reddit-subreddits/2161700`, schema: RedditSubredditsResponseSchema },
    { name: 'AccountData',   url: `${GATEWAY}/relay/api/account`, schema: AccountDataSchema },
    { name: 'AllLocalReviews', url: `${GATEWAY}/api/local-reviews`, schema: AllLocalReviewsSchema },
]

let failures = 0

for (const check of checks) {
    process.stdout.write(`${check.name.padEnd(24)} `)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
        const res = await fetch(check.url, { signal: controller.signal })
        if (!res.ok) {
            console.log(`FAIL — HTTP ${res.status}`)
            failures++
            continue
        }
        const json = await res.json()
        const result = check.schema.safeParse(json)
        if (result.success) {
            console.log('PASS')
        } else {
            console.log('FAIL — schema mismatch')
            console.log(JSON.stringify(result.error, null, 2))
            failures++
        }
    } catch (err) {
        console.log(`FAIL — ${(err as Error).message}`)
        failures++
    } finally {
        clearTimeout(timer)
    }
}

console.log(`\n${checks.length - failures}/${checks.length} contracts verified against ${GATEWAY}`)
process.exitCode = failures > 0 ? 1 : 0
