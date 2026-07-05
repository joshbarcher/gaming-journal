// Contract for GET /relay/api/steam/releases — upcoming release dates sourced from wishlisted +
// discovered games (confirmed live: 67 entries, appid/name/releaseDate/releaseDateIso/comingSoon/
// owned/wishlisted). Only `upcoming` is consumed by Calendar's releases mode; `releases` (the
// other top-level key) is a different, unrelated shape not needed here.
// releaseDateIso is genuinely `null` (not just absent) for games with an unresolved release date —
// confirmed live (27 of 67 real entries), not an assumption. buildReleaseMap()'s `if
// (!game.releaseDateIso) continue` already treats null and undefined identically, so no logic
// change was needed once the schema allowed it.
import { z } from 'zod'

export const UpcomingGameSchema = z.object({
    appid:          z.number(),
    name:           z.string(),
    releaseDate:    z.string().optional(),
    releaseDateIso: z.string().nullable().optional(),
    comingSoon:     z.boolean().optional(),
    owned:          z.boolean().optional(),
    wishlisted:     z.boolean().optional(),
})

export const ReleasesResponseSchema = z.object({
    upcoming: z.array(UpcomingGameSchema),
}).passthrough()

export type UpcomingGame     = z.infer<typeof UpcomingGameSchema>
export type ReleasesResponse = z.infer<typeof ReleasesResponseSchema>
