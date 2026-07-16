// POST /relay/api/steam/playtime/snapshot — take a playtime snapshot now, then
// re-derive sessions from the snapshot history. Ports relay sessions.controller
// handleTakeSnapshot (router mounted at /api/steam/playtime).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { takeSnapshot, deriveSessions } from '$lib/server/relay/steam/sessions.service.js'

export const POST = relayRoute('sessions', async () => {
    try {
        const result = await takeSnapshot()
        await deriveSessions()
        return json(result)
    } catch (err) {
        logger.error('Failed to take snapshot', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
})
