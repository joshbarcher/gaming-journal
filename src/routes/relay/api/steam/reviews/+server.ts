// GET /relay/api/steam/reviews — full user-review cache keyed by appid (relay
// handleGetReviews).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getReviews } from '$lib/server/relay/steam/steam.service.js'

export const GET = relayRoute('steam', async () => {
    try {
        return json(await getReviews())
    } catch (err) {
        logger.error('Failed to get reviews', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: 'Failed to read reviews cache' }, 500)
    }
})
