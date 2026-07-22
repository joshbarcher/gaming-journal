// Contract for GET /api/flags — this app's own SvelteKit route (not relay-proxied). Ported from
// the FlagKey/Flags/FlagsStore types in gaming-journal's src/lib/types.ts, verified against a real
// payload from the local server.
import { z } from 'zod'

export const FlagKeySchema = z.enum([
    'software', 'childLock', 'filtered', 'alert',
    'favorite', 'revisit', 'playlist',
    'completed', 'dropped', 'inProgress', 'backlog',
])

export const GameFlagsSchema = z.object({
    software:   z.boolean().optional(),
    childLock:  z.boolean().optional(),
    filtered:   z.boolean().optional(),
    alert:      z.boolean().optional(),
    favorite:   z.boolean().optional(),
    revisit:    z.boolean().optional(),
    playlist:   z.boolean().optional(),
    completed:  z.boolean().optional(),
    dropped:    z.boolean().optional(),
    inProgress: z.boolean().optional(),
    backlog:    z.boolean().optional(),
})

export const FlagsStoreSchema = z.record(z.string(), GameFlagsSchema)

export type FlagKey     = z.infer<typeof FlagKeySchema>
export type GameFlags   = z.infer<typeof GameFlagsSchema>
export type FlagsStore  = z.infer<typeof FlagsStoreSchema>
