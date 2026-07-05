// Contract for GET /relay/api/steam/games — relay-server's raw passthrough of the
// Steam Web API's owned-games list (NOT the enriched per-game shape used by the
// game detail page, which has its own contract). Shape confirmed against the live
// server (192.168.86.65:8050) rather than assumed from docs.
import { z } from 'zod'

export const SteamGameRawSchema = z.object({
    appid:                       z.number(),
    name:                        z.string(),
    playtime_forever:            z.number(),
    img_icon_url:                z.string().optional(),
    has_community_visible_stats: z.boolean().optional(),
    playtime_windows_forever:    z.number().optional(),
    playtime_mac_forever:        z.number().optional(),
    playtime_linux_forever:      z.number().optional(),
    playtime_deck_forever:       z.number().optional(),
    playtime_disconnected:       z.number().optional(),
    rtime_last_played:           z.number().optional(),
    content_descriptorids:       z.array(z.number()).optional(),
})

export const SteamGamesListSchema = z.object({
    fetchedAt:  z.string(),
    gameCount:  z.number(),
    games:      z.array(SteamGameRawSchema),
})

export type SteamGameRaw    = z.infer<typeof SteamGameRawSchema>
export type SteamGamesList  = z.infer<typeof SteamGamesListSchema>
