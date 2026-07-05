// Contract for GET /relay/api/player-counts/top?n=&includeFiltered=true. Verified against a real
// payload. filtered is always returned true/false regardless of query — "includeFiltered=true"
// just means filtered games are still included in the response for client-side muting, not
// server-side exclusion (per top-games.md's own gotcha).
import { z } from 'zod'

export const TopGameEntrySchema = z.object({
    appid:        z.number(),
    name:         z.string().optional(),
    latest:       z.number().nullable().optional(),
    peak24h:      z.number().nullable().optional(),
    peak7d:       z.number().nullable().optional(),
    peakAllTime:  z.number().nullable().optional(),
    samples24h:   z.array(z.tuple([z.number(), z.number()])).optional(),
    filtered:     z.boolean(),
    owned:        z.boolean().optional(),
    wishlisted:   z.boolean().optional(),
})

export const TopGamesResponseSchema = z.array(TopGameEntrySchema)

export type TopGameEntry = z.infer<typeof TopGameEntrySchema>
