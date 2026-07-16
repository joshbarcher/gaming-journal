// POST /relay/api/admin/sources/:id/sync — kick off a manual sync for one
// source. 202 immediately (these run for minutes), 409 when a run for the same
// source is already in flight, 404 for ids without a trigger (ports relay
// admin.controller handleSourceSync). SvelteKit decodes the param, so the
// UI's encodeURIComponent('steam:reviews') arrives as 'steam:reviews' — same
// as Express.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { startSync, canSync, listActions, ConflictError } from '$lib/server/relay/metrics/actions.js'

export const POST = relayRoute('admin', ({ params }) => {
    const id = params.id!

    if (!canSync(id)) {
        return json({ error: `No sync action for source: ${id}`, available: listActions() }, 404)
    }

    try {
        startSync(id)   // fire-and-forget; progress lands in the run history
        return json({ ok: true, id, message: `Sync started for ${id}` }, 202)
    } catch (err) {
        if (err instanceof ConflictError) {
            return json({ error: err.message, id }, 409)
        }
        const message = err instanceof Error ? err.message : String(err)
        logger.error('[admin] Failed to start sync', { id, err: message })
        return json({ error: message }, 500)
    }
})
