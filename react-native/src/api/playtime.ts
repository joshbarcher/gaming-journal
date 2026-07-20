import { z } from 'zod'
import { apiGet } from './client'

// GET /relay/api/steam/playtime/last-played — the relay's in-memory play-log map,
// { [appid]: { lastPlayedAt, effectiveMin } }. `effectiveMin` is Steam's baseline
// plus any tracked/open-session minutes (see play-log.service.js getLastPlayedMap),
// so it stays fresh during an active session where Steam's own playtime lags.
// No shared contract exists for this endpoint, so the shape is declared inline
// (permissive: both fields optional, since a currently-open session or a malformed
// entry must not blow up the whole parse).
export const LastPlayedEntrySchema = z.object({
    lastPlayedAt: z.string().nullable().optional(),
    effectiveMin: z.number().optional(),
})

export const LastPlayedMapSchema = z.record(z.string(), LastPlayedEntrySchema)

export type LastPlayedEntry = z.infer<typeof LastPlayedEntrySchema>
export type LastPlayedMap = z.infer<typeof LastPlayedMapSchema>

export const getLastPlayedMap = (): Promise<LastPlayedMap> =>
    apiGet('/relay/api/steam/playtime/last-played', LastPlayedMapSchema)
