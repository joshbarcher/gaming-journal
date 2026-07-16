// GET /relay/api/steam/reviews/:appid — one game's cached review entry (relay
// handleGetReview). 404 when nothing is cached. The static /reviews/sync,
// /reviews/scan and /reviews/scrape routes win over this param route, same as
// the relay's declaration order.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getReview } from '$lib/server/relay/steam/steam.service.js'

export const GET = relayRoute('steam', async ({ params }) => {
    try {
        const entry = await getReview(params.appid)
        if (!entry) return json({ error: 'No review cached for this game' }, 404)
        return json(entry)
    } catch (err) {
        logger.error('Failed to get review', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: 'Failed to read review' }, 500)
    }
})
