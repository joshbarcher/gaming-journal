// POST /relay/api/admin/provision/:appid — fire-and-forget single-game
// provision, then patch the wishlist + games caches so the new entry shows up
// (ports relay admin.controller handleProvision).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { provisionGame } from '$lib/server/relay/provision.service.js'
import { patchItem } from '$lib/server/relay/wishlist/wishlist.service.js'
import { patchGame } from '$lib/server/relay/games/games.service.js'

export const POST = relayRoute('admin', ({ params }) => {
    const appid = Number(params.appid)
    if (!appid) return json({ error: 'invalid appid' }, 400)
    provisionGame(appid)
        .then(() => Promise.all([patchItem(appid), patchGame(appid)]))
        .catch((err: unknown) => logger.error('[admin] Provision failed', { appid, err: err instanceof Error ? err.message : String(err) }))
    return json({ ok: true, message: `Provision started for ${appid}` })
})
