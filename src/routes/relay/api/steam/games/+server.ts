// GET /relay/api/steam/games — owned-games cache with relay playtime overlay.
// Ports relay steam.controller handleGetGames verbatim: playtime_forever is
// always overlaid with the play-log's effectiveMin (baseline + tracked
// sessions — the single source of truth), and rtime_last_played is patched
// forward when the play-log has a more recent timestamp.
//
// play-log load(): the relay boot-wires this in server.js before its poller
// starts. Until Wave 4 wires the journal's boot.js the same way, load lazily
// here — load() is idempotent, so after the first request this is a no-op and
// every read is in-memory.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getGames } from '$lib/server/relay/steam/steam.service.js'
import { load as loadPlayLog, getLastPlayedMap } from '$lib/server/relay/steam/play-log.service.js'

export const GET = relayRoute('steam', async () => {
    try {
        await loadPlayLog()
        const data = await getGames()
        const lastPlayed = getLastPlayedMap() as Record<string, { lastPlayedAt: string; effectiveMin: number }>

        // Always overlay playtime_forever with the relay effectiveMin.
        // The relay is the single source of truth (baseline + tracked sessions).
        // Also update rtime_last_played when the relay has a more recent timestamp.
        const games = (data?.games ?? []).map((g: any) => {
            const relay = lastPlayed[g.appid]
            if (!relay) return g
            const patched = { ...g }
            const relaySec = Math.floor(new Date(relay.lastPlayedAt).getTime() / 1000)
            if (relaySec > (g.rtime_last_played ?? 0)) patched.rtime_last_played = relaySec
            patched.playtime_forever = relay.effectiveMin
            return patched
        })

        return json({ ...data, games })
    } catch (err) {
        logger.error('Failed to get games', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: 'Failed to read games cache' }, 500)
    }
})
