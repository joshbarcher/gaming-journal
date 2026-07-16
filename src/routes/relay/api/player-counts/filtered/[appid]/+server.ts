// POST/DELETE /relay/api/player-counts/filtered/:appid — add/remove a game on
// the server-side mute list (writes filtered.json; the in-memory index entry
// is patched in place). Ports relay player-counts.controller
// handleAddFiltered / handleRemoveFiltered.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { addFiltered, removeFiltered } from '$lib/server/relay/steam/player-counts.service.js'

export const POST = relayRoute('player-counts', async ({ params }) => {
    try {
        await addFiltered(params.appid)
        return json({ ok: true })
    } catch (err) {
        logger.error('[player-counts] Failed to add filtered', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: 'Failed to update filter list' }, 500)
    }
})

export const DELETE = relayRoute('player-counts', async ({ params }) => {
    try {
        await removeFiltered(params.appid)
        return json({ ok: true })
    } catch (err) {
        logger.error('[player-counts] Failed to remove filtered', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: 'Failed to update filter list' }, 500)
    }
})
