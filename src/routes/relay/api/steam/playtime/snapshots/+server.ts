// GET /relay/api/steam/playtime/snapshots — the raw 30-day snapshot history
// (playtime-snapshots.json). Ports relay sessions.controller handleGetSnapshots.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getSnapshots } from '$lib/server/relay/steam/sessions.service.js'

export const GET = relayRoute('sessions', async () => {
    try {
        return json(await getSnapshots())
    } catch (err) {
        logger.error('Failed to get snapshots', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: 'Failed to read snapshots cache' }, 500)
    }
})
