// PUT    /relay/api/guides/:steamId/:source/:guideId/pins/:pinId — delta
//        add/replace of a single pin (merges into the live store so concurrent
//        tabs can't clobber each other). Body: { pin, parsedAt }.
// DELETE — delta delete of a single pin by id, leaving every other pin intact.
// (ports relay guides.controller handleUpsertPin / handleDeletePin).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { upsertPin, deletePin } from '$lib/server/relay/guides/pins.service.js'

export const PUT = relayRoute('guides', async ({ params, request }) => {
    const { steamId, source, guideId } = params
    const body = await request.json().catch(() => ({})) ?? {}
    try {
        const saved = await upsertPin(steamId, source, guideId, body.pin, body.parsedAt ?? null)
        return json(saved)
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const status = message === 'invalid pin' ? 400 : 500
        logger.error('[guide-pins] upsert failed', { steamId, source, guideId, err: message })
        return json({ error: message }, status)
    }
})

export const DELETE = relayRoute('guides', async ({ params }) => {
    const { steamId, source, guideId, pinId } = params
    try {
        return json(await deletePin(steamId, source, guideId, pinId))
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error('[guide-pins] delete failed', { steamId, source, guideId, pinId, err: message })
        return json({ error: message }, 500)
    }
})
