// Contract for GET/POST/DELETE /relay/api/pin — the relay's "now playing" home-widget pinboard
// state. GET returns a real 204 (confirmed live) when nothing is pinned; the API wrapper maps
// that to `null` rather than parsing a body, same as the web's own pin.ts.
import { z } from 'zod'

export const PinStateSchema = z.object({
    appid:            z.number(),
    name:             z.string(),
    pinnedAt:         z.string(),
    reason:           z.enum(['playing', 'manual']),
    sessionEndedAt:   z.string().nullable(),
    postsAccumulated: z.number(),
    lastRefreshedAt:  z.string().nullable(),
    expiresAt:        z.string(),
})

export type PinState = z.infer<typeof PinStateSchema>
