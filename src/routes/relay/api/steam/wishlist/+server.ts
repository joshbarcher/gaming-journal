// GET /relay/api/steam/wishlist — cached wishlist keyed by appid (relay
// handleGetWishlist).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getWishlist } from '$lib/server/relay/steam/steam.service.js'

export const GET = relayRoute('steam', async () => {
    try {
        return json(await getWishlist())
    } catch (err) {
        logger.error('Failed to get wishlist', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: 'Failed to read wishlist cache' }, 500)
    }
})
