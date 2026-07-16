// GET  /relay/api/pin — current pin state (204 when nothing is pinned).
// DELETE /relay/api/pin — hard unpin (204).
// Ports relay pin.controller handleGetPin / handleClearPin, including their
// exact status bodies (500 carries the error message).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import * as pin from '$lib/server/relay/pin/pin.service.js'

export const GET = relayRoute('pin', () => {
    try {
        const state = pin.get()
        if (!state) return new Response(null, { status: 204 })
        return json(state)
    } catch (err) {
        logger.error('[pin] Get failed', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
})

export const DELETE = relayRoute('pin', async () => {
    try {
        await pin.clear()
        return new Response(null, { status: 204 })
    } catch (err) {
        logger.error('[pin] Clear failed', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
})
