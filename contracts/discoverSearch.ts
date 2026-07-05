// Contract for GET /relay/api/discover/search?q=&limit=&offset=. Verified against a real payload
// from the local relay. Note: headerImage here is already an absolute steamstatic CDN URL — unlike
// contracts/home.ts's poster paths, which are relay-relative and need the API host prepended. Two
// different endpoints, two different URL conventions — checked live rather than assumed consistent.
import { z } from 'zod'

export const DiscoverItemSchema = z.object({
    appid:       z.number(),
    name:        z.string(),
    headerImage: z.string().optional(),
    isAdult:     z.boolean().optional(),
})

// `total`/`offset`/`limit` added for the Discover screen item — the earlier Global Search overlay
// item only ever read `.results`, so these went unconfirmed until this item needed real pagination.
export const DiscoverSearchResultsSchema = z.object({
    results: z.array(DiscoverItemSchema),
    total:   z.number().optional(),
    offset:  z.number().optional(),
    limit:   z.number().optional(),
})

export type DiscoverItem          = z.infer<typeof DiscoverItemSchema>
export type DiscoverSearchResults = z.infer<typeof DiscoverSearchResultsSchema>
