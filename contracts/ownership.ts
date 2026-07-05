// Contract for GET /relay/api/games/ownership (discovery/discover.md). Confirmed live against the
// real 2927-game ownership list — `source` only ever observed as 'library'/'wishlist' in this real
// dataset, but the doc explicitly documents a 'both' value too (a game that's owned AND
// wishlisted), so kept in the enum rather than narrowed to just what was empirically observed.
import { z } from 'zod'

export const OwnershipEntrySchema = z.object({
    appid:  z.number(),
    source: z.enum(['library', 'wishlist', 'both']),
})

export const OwnershipResponseSchema = z.array(OwnershipEntrySchema)

export type OwnershipEntry = z.infer<typeof OwnershipEntrySchema>
