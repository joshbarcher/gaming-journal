// Contract for GET /relay/api/discover/featured[?tab=&page=] (discovery/discover.md). Confirmed
// live against all 4 real featured tabs (new_releases/top_sellers/coming_soon/specials).
//
// **Real, confirmed URL-convention difference from discoverSearch.ts's `DiscoverItem`**: this
// endpoint's `headerImage` is relay-relative (`/relay/images/steam/games/{appid}/header.jpg`),
// needing the apiHost prefix — the search endpoint's `headerImage` is already an absolute
// steamstatic CDN URL. Same field name, two different conventions, checked live rather than
// assumed consistent (same gotcha discoverSearch.ts's own header already flagged for itself).
import { z } from 'zod'

export const DiscoverFeaturedItemSchema = z.object({
    appid:         z.number(),
    name:          z.string(),
    headerImage:   z.string(),
    posterImage:   z.string().optional(),
    price:         z.number().nullable().optional(),
    originalPrice: z.number().nullable().optional(),
    discount:      z.number().optional(),
    isFree:        z.boolean().optional(),
    isAdult:       z.boolean().optional(),
})

export const DiscoverSectionSchema = z.object({
    id:    z.string(),
    label: z.string(),
    items: z.array(DiscoverFeaturedItemSchema),
    page:  z.number(),
    pages: z.number(),
})

export const DiscoverFeaturedResponseSchema = z.array(DiscoverSectionSchema)

export const FEATURED_TABS = [
    { id: 'new_releases', label: 'New Releases', short: 'New' },
    { id: 'top_sellers', label: 'Top Sellers', short: 'Top' },
    { id: 'coming_soon', label: 'Coming Soon', short: 'Soon' },
    { id: 'specials', label: 'On Sale', short: 'Sale' },
] as const

export type DiscoverFeaturedItem = z.infer<typeof DiscoverFeaturedItemSchema>
export type DiscoverSection      = z.infer<typeof DiscoverSectionSchema>
