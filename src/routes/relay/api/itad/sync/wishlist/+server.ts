// POST /relay/api/itad/sync/wishlist — kept for backwards compatibility;
// syncWishlist() delegates to syncAll() in the service.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { rebuild } from '$lib/server/relay/shared/cache-manager.js'
import { syncWishlist } from '$lib/server/relay/itad/itad.service.js'

export const POST = relayRoute('itad', ({ url }) => {
    const force = url.searchParams.get('force') === 'true'
    syncWishlist({ force })
        .then(() => rebuild('games', 'wishlist'))
        .catch((err: unknown) => logger.error('[itad] Wishlist sync failed', { err: err instanceof Error ? err.message : String(err) }))

    return json({ ok: true, message: 'ITAD wishlist sync started' })
})
