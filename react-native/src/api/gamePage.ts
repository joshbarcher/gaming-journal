import { apiGet, apiGetOrNull } from './client'
import { getApiHost } from './config'
import { GameDetailSchema } from 'gaming-journal-contracts/gameDetail'
import { PlayerCountsSchema } from 'gaming-journal-contracts/playerCounts'
import { VideosResponseSchema } from 'gaming-journal-contracts/videos'
import { NewsResponseSchema } from 'gaming-journal-contracts/news'
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
export async function getPcgwForGame(appid: number): Promise<Pcgw | null> {
    const data = await apiGet(`/relay/api/pcgw/${appid}`, PcgwSchema)
    return data.found ? data : null
}
export const getNews = (appid: number) => apiGet(`/relay/api/news/${appid}`, NewsResponseSchema)

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

export type { GameFlags }
