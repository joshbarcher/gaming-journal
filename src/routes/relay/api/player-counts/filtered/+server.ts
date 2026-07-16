// GET /relay/api/player-counts/filtered — the server-side mute list (appids).
// Ports relay player-counts.controller handleGetFiltered.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getFiltered } from '$lib/server/relay/steam/player-counts.service.js'

export const GET = relayRoute('player-counts', async () => {
    try {
        return json(await getFiltered())
    } catch (err) {
        logger.error('[player-counts] Failed to get filtered', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: 'Failed to read filter list' }, 500)
    }
})
