// GET /relay/api/guides/:steamId/:source/:guideId/pins — server-persisted
// guide TOC pins (shared web + native).
// PUT — whole-store replace (legacy full-write path).
// (ports relay guides.controller handleGetPins / handlePutPins).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getPins, setPins } from '$lib/server/relay/guides/pins.service.js'

export const GET = relayRoute('guides', async ({ params }) => {
    const { steamId, source, guideId } = params
    try {
        return json(await getPins(steamId, source, guideId))
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error('[guide-pins] get failed', { steamId, source, guideId, err: message })
        return json({ error: message }, 500)
    }
})

export const PUT = relayRoute('guides', async ({ params, request }) => {
    const { steamId, source, guideId } = params
    const body = await request.json().catch(() => ({})) ?? {}
    try {
        const saved = await setPins(steamId, source, guideId, {
            parsedAt: body.parsedAt ?? null,
            pins:     Array.isArray(body.pins) ? body.pins : [],
        })
        return json(saved)
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error('[guide-pins] put failed', { steamId, source, guideId, err: message })
        return json({ error: message }, 500)
    }
})
