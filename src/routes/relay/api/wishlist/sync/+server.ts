// POST /relay/api/wishlist/sync — force-rebuild the derived caches after a
// wishlist mutation. Ports relay wishlist.controller handleSync verbatim:
// rebuild('wishlist', 'games', 'account', 'upcoming') — 'account' is a Wave-4
// feature, so until it ports cache-manager logs a harmless "Unknown cache"
// warning (same pattern as the Wave-1 'games'/'wishlist' interim, now closed).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { rebuild } from '$lib/server/relay/shared/cache-manager.js'
import { get } from '$lib/server/relay/wishlist/wishlist.service.js'

export const POST = relayRoute('wishlist', async () => {
    try {
        await rebuild('wishlist', 'games', 'account', 'upcoming')
        return json({ ok: true, count: get().length })
    } catch (err) {
        logger.error('[wishlist] Sync failed', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
})
