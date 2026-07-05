// Contract for GET /relay/api/games — a different, more heavily-enriched endpoint than
// /relay/api/steam/games (already covered by steamGamesList.ts). Confirmed by reading
// Franchise.svelte directly: it's the only screen that fetches this endpoint, for ownership +
// wishlist partitioning (via `source`) and hero-slideshow screenshots (via `media.screenshots`).
// Scoped tightly to those fields only — the real payload also carries a large nested `store`
// object per game that nothing here needs; Zod strips unknown keys by default so this still
// validates real live data without needing to model the whole shape.
import { z } from 'zod'

export const RelayGameSchema = z.object({
    appid:           z.number(),
    name:            z.string(),
    source:          z.enum(['library', 'wishlist', 'both']),
    playtimeMinutes: z.number().nullable().optional(),
    media: z.object({
        screenshots: z.array(z.string()).optional(),
    }).optional(),
})

export const RelayGamesListSchema = z.array(RelayGameSchema)

export type RelayGame = z.infer<typeof RelayGameSchema>
