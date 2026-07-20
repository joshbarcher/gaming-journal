import { z } from 'zod'

import { apiGet, apiGetOrNull } from './client'
import { getApiHost } from './config'
import { GameDetailSchema } from 'gaming-journal-contracts/gameDetail'
import { PlayerCountsSchema } from 'gaming-journal-contracts/playerCounts'
import { VideosResponseSchema } from 'gaming-journal-contracts/videos'
import { NewsItemSchema } from 'gaming-journal-contracts/news'
import { ProtonDbRawSchema, type ProtonDbRaw } from 'gaming-journal-contracts/protondb'
import { PcgwSchema, type Pcgw } from 'gaming-journal-contracts/pcgw'
import { GameFlagsSchema, type GameFlags, type FlagKey } from 'gaming-journal-contracts/flags'
import { CommunityReviewsSchema } from 'gaming-journal-contracts/communityReviews'
import { LocalWishlistEntrySchema } from 'gaming-journal-contracts/localWishlistEntry'
import { ItadDataSchema, type ItadData } from 'gaming-journal-contracts/itad'

// Base sections of the Game detail screen. Reviews and Pricing were originally split out as
// separate TODO items (contracts/api modules added when each screen was built) even though the
// web's GamePage.svelte fetches everything together — now that both are built, this module covers
// the full real fetch list.
export const getGameDetail   = (appid: number) => apiGet(`/relay/api/games/${appid}`, GameDetailSchema)
export const getPlayerCounts = (appid: number) => apiGetOrNull(`/relay/api/player-counts/${appid}`, PlayerCountsSchema)
export const getCommunityReviewsForHero = (appid: number) => apiGetOrNull(`/relay/api/steam/community-reviews/${appid}`, CommunityReviewsSchema)
export const getGameFlags    = (appid: number) => apiGet(`/api/flags/${appid}`, GameFlagsSchema)
export const getTrailers     = (appid: number) => apiGet(`/relay/api/videos/${appid}`, VideosResponseSchema)
export const getLocalWishlistEntry = (appid: number) => apiGet(`/api/local-wishlist/${appid}`, LocalWishlistEntrySchema)

// Phase-2-equivalent background fetches (no Web Worker — plain async functions per PLAN.md's
// "sequential useQuery phases" decision). Null-coalescing rules ported exactly from GamePage.svelte.
export async function getProtonDbForGame(appid: number): Promise<ProtonDbRaw | null> {
    const raw = await apiGet(`/relay/api/protondb/${appid}`, ProtonDbRawSchema)
    return (raw.notFound || !raw.tier) ? null : raw
}
// Discovered games have no PCGW backfill, so pass `?fetch=true&name=` to kick off an on-demand
// fetch-by-name (mirrors GamePage.svelte ~292); cached/library games just read the entry. An
// uncached miss answers 404 (library) or 202 {status:'pending'} (discovered) — both resolve to
// "no section yet" via apiGetOrNull, never surfacing as a section-killing error (web never errors
// this section either — it nulls on any failure).
export async function getPcgwForGame(appid: number, isDiscovered = false, name = ''): Promise<Pcgw | null> {
    const url = isDiscovered
        ? `/relay/api/pcgw/${appid}?fetch=true&name=${encodeURIComponent(name)}`
        : `/relay/api/pcgw/${appid}`
    const data = await apiGetOrNull(url, PcgwSchema)
    return data?.found ? data : null
}

// ── News (list + single article) ─────────────────────────────────────────────────
// The list endpoint carries previewImage/excerpt on each item and the single-article endpoint a
// parsed `blocks` body — richer than the shared NewsResponse contract, which would strip those
// fields on parse. Shapes confirmed against src/lib/server/relay/news/news.service.js.
const RichNewsItemSchema = NewsItemSchema.extend({
    previewImage: z.string().nullish(),
    excerpt:      z.string().optional(),
})
export const RichNewsResponseSchema = z.object({
    fetchedAt: z.string().optional(),
    appid:     z.number().optional(),
    items:     z.array(RichNewsItemSchema).optional(),
})
export type RichNewsItem = z.infer<typeof RichNewsItemSchema>

// Article body blocks (guide-parser ContentBlock shape, mirrors src/lib/types.ts NexusBlock); lists
// nest, hence the recursive item schema.
type NewsListItem = { text?: string; children?: { ordered: boolean; items: NewsListItem[] } }
const NewsListItemSchema: z.ZodType<NewsListItem> = z.lazy(() => z.object({
    text:     z.string().optional(),
    children: z.object({ ordered: z.boolean(), items: z.array(NewsListItemSchema) }).optional(),
}))
const NewsBlockSchema = z.object({
    type:    z.string(),
    level:   z.number().optional(),
    text:    z.string().optional(),
    html:    z.string().optional(),
    ordered: z.boolean().optional(),
    items:   z.array(NewsListItemSchema).optional(),
    src:     z.string().optional(),
    alt:     z.string().optional(),
    caption: z.string().optional(),
})
export const NewsArticleSchema = z.object({
    gid:          z.string().optional(),
    date:         z.number().optional(),
    feedlabel:    z.string().optional(),
    feedname:     z.string().optional(),
    author:       z.string().optional(),
    title:        z.string(),
    url:          z.string().optional(),
    previewImage: z.string().nullish(),
    excerpt:      z.string().optional(),
    blocks:       z.array(NewsBlockSchema).optional().default([]),
})
export type NewsBlock   = z.infer<typeof NewsBlockSchema>
export type NewsArticle = z.infer<typeof NewsArticleSchema>

export const getNews = (appid: number) => apiGet(`/relay/api/news/${appid}`, RichNewsResponseSchema)
export const getNewsArticle = (appid: number, gid: string) =>
    apiGet(`/relay/api/news/${appid}/${encodeURIComponent(gid)}`, NewsArticleSchema)

// ITAD always runs in Phase 2 regardless of release status (`hasItad = true` unconditionally, per
// pricing.md) and never hides the section on failure — `itadData = data ?? {}` on the web, ported
// as "always return a real object, defaulting to {}", never null. Discovered games fetch by name
// (`?fetch=true&name=`) since there's no cached ITAD entry to key off an appid for those.
export async function getItadForGame(appid: number, isDiscovered: boolean, name: string): Promise<ItadData> {
    const url = isDiscovered
        ? `/relay/api/itad/${appid}?fetch=true&name=${encodeURIComponent(name)}`
        : `/relay/api/itad/${appid}`
    return apiGet(url, ItadDataSchema)
}

// FlagsBar mutations — individual PATCH per flag (not a bulk save), matching FlagsBar.svelte's
// toggleFlag() exactly, including that it only rolls back on a network throw, not a non-2xx status
// (ported faithfully, not "fixed" — this is the real web behavior).
export async function setGameFlag(appid: number, flag: FlagKey, value: boolean): Promise<void> {
    const host = await getApiHost()
    await fetch(`${host}/api/flags/${appid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flag, value }),
    })
}

// Local wishlist toggle — POST to add, DELETE to remove (RESTful, not PATCH) — matches
// FlagsBar.svelte's toggleWishlist() exactly, including that it DOES check res.ok.
export async function setLocalWishlisted(appid: number, wishlisted: boolean): Promise<boolean> {
    const host = await getApiHost()
    const res = await fetch(`${host}/api/local-wishlist/${appid}`, { method: wishlisted ? 'POST' : 'DELETE' })
    return res.ok
}

// HLTB/ITAD/PCGW "force refresh" pattern — sync (POST) then get (GET), matching workerMgr.sync().
export async function refreshHltbForGame(appid: number) {
    const host = await getApiHost()
    await fetch(`${host}/relay/api/hltb/sync/${appid}?force=true`, { method: 'POST' })
    return getGameDetail(appid)
}
export async function refreshProtonDbForGame(appid: number) {
    const host = await getApiHost()
    await fetch(`${host}/relay/api/protondb/sync/${appid}?force=true`, { method: 'POST' })
    return getProtonDbForGame(appid)
}
export async function refreshPcgwForGame(appid: number) {
    const host = await getApiHost()
    await fetch(`${host}/relay/api/pcgw/sync/${appid}?force=true`, { method: 'POST' })
    return getPcgwForGame(appid)
}
export async function refreshItadForGame(appid: number, isDiscovered: boolean, name: string) {
    const host = await getApiHost()
    await fetch(`${host}/relay/api/itad/sync/${appid}?force=true`, { method: 'POST' })
    return getItadForGame(appid, isDiscovered, name)
}

// ── Cold-cache population (mirrors GamePage.svelte's Phase-2 "fill an empty section" fetches) ─────

// Community reviews: an uncached game returns null from the hero endpoint; POST /sync then re-GET,
// exactly as GamePage.svelte does for `needsCommunitySync` (~347-356). Returns the freshly synced
// reviews (or null if the sync produced nothing).
export async function syncCommunityReviews(appid: number) {
    const host = await getApiHost()
    await fetch(`${host}/relay/api/steam/community-reviews/${appid}/sync`, { method: 'POST' }).catch(() => {})
    return getCommunityReviewsForHero(appid)
}

// About description: library/wishlist games can arrive with no store.detailedDescription; a
// `?refresh=true` re-pull populates it (GamePage.svelte ~359-372). Returns the refreshed detail.
export async function refreshAboutDescription(appid: number) {
    return apiGet(`/relay/api/games/${appid}?refresh=true`, GameDetailSchema)
}

// HLTB cold fetch: uncached/unmatched games kick off an on-demand HLTB search via `?fetch=true`
// (GamePage.svelte ~267-276). The relay answers 202 and warms its cache asynchronously (then
// rebuilds the games cache), so we tolerate any status and re-read the merged game detail after.
export async function fetchHltbColdCache(appid: number, name: string) {
    const host = await getApiHost()
    await fetch(`${host}/relay/api/hltb/${appid}?fetch=true&name=${encodeURIComponent(name)}`).catch(() => {})
    return getGameDetail(appid)
}

// News refresh: caches written before previewImage/blocks — or still holding raw BBCode — are
// re-pulled via the admin refresh endpoint, matching GamePage.svelte's `newsBBCodeDirty` branch
// (~314-322). Returns the fresh list; `pokeNewsRefresh` is the fire-and-forget warm for clean caches.
export async function refreshNews(appid: number) {
    const host = await getApiHost()
    await fetch(`${host}/relay/api/admin/news/${appid}/refresh`, { method: 'POST' }).catch(() => {})
    return getNews(appid)
}
export function pokeNewsRefresh(appid: number) {
    getApiHost()
        .then(host => fetch(`${host}/relay/api/admin/news/${appid}/refresh`, { method: 'POST' }))
        .catch(() => {})
}

export type { GameFlags }
