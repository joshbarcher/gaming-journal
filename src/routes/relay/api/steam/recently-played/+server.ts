// GET /relay/api/steam/recently-played — cached GetRecentlyPlayedGames payload
// (relay handleGetRecentlyPlayed).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getRecentlyPlayed } from '$lib/server/relay/steam/steam.service.js'

export const GET = relayRoute('steam', async () => {
    try {
        return json(await getRecentlyPlayed())
    } catch (err) {
        logger.error('Failed to get recently played', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: 'Failed to read recently-played cache' }, 500)
    }
})
