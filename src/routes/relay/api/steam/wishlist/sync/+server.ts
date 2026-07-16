// POST /relay/api/steam/wishlist/sync — synchronous sync (relay
// handleSyncWishlist: the caller waits for the result; ?force=true bypasses
// the 24h TTL).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { rebuild } from '$lib/server/relay/shared/cache-manager.js'
import { syncWishlist } from '$lib/server/relay/steam/steam.service.js'

export const POST = relayRoute('steam', async ({ url }) => {
    try {
        const result = await syncWishlist({ force: url.searchParams.get('force') === 'true' })
        await rebuild('games', 'account', 'upcoming', 'wishlist')
        return json(result)
    } catch (err) {
        logger.error('Failed to sync wishlist', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
})
