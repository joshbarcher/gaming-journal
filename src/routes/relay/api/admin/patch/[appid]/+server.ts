// POST /relay/api/admin/patch/:appid — fire-and-forget cache patch for one
// game in both the wishlist and games in-memory caches (ports relay
// admin.controller handlePatch).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { patchItem } from '$lib/server/relay/wishlist/wishlist.service.js'
import { patchGame } from '$lib/server/relay/games/games.service.js'

export const POST = relayRoute('admin', ({ params }) => {
    const appid = Number(params.appid)
    if (!appid) return json({ error: 'invalid appid' }, 400)
    Promise.all([patchItem(appid), patchGame(appid)])
        .catch((err: unknown) => logger.error('[admin] Patch failed', { appid, err: err instanceof Error ? err.message : String(err) }))
    return json({ ok: true })
})
