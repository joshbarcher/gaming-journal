// GET /relay/api/videos/<appid> — metadata for locally downloaded trailers
// (ports relay videos.controller handleGetVideoMeta; router mounted at
// /api/videos). Error bodies are arrays, matching the relay exactly.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getVideoMeta } from '$lib/server/relay/steam/videos.service.js'

export const GET = relayRoute('steam-videos', async ({ params }) => {
    const appid = Number(params.appid)
    if (!Number.isInteger(appid) || appid <= 0) return json([], 400)

    try {
        return json(await getVideoMeta(appid))
    } catch (err) {
        logger.error('[videos] Failed to get video meta', { appid, err: err instanceof Error ? err.message : String(err) })
        return json([], 500)
    }
})
