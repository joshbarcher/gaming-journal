// GET /relay/api/steam/playtime/sessions — the derived snapshot-diff sessions
// cache (sessions.json). Ports relay sessions.controller handleGetSessions.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getSessions } from '$lib/server/relay/steam/sessions.service.js'

export const GET = relayRoute('sessions', async () => {
    try {
        return json(await getSessions())
    } catch (err) {
        logger.error('Failed to get sessions', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: 'Failed to read sessions cache' }, 500)
    }
})
