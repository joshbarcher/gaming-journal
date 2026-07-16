// GET /relay/api/player-counts/:appid — one game's full sample history
// { name, peakAllTime, samples }. Ports relay player-counts.controller
// handleGetHistory (404 when the game has no data).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getHistory, ensureBuilt } from '$lib/server/relay/steam/player-counts.service.js'

export const GET = relayRoute('player-counts', async ({ params }) => {
    try {
        await ensureBuilt()
        const data = await getHistory(params.appid)
        if (!data) return json({ error: 'No player count data for this game' }, 404)
        return json(data)
    } catch (err) {
        logger.error('[player-counts] Failed to get history', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: 'Failed to read player count history' }, 500)
    }
})
