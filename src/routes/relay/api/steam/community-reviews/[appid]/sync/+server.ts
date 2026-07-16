// POST /relay/api/steam/community-reviews/:appid/sync — synchronous
// single-game sync + index rebuild. Ports relay handleSyncGame, including its
// exact status bodies (400 invalid appid, 500 with the error message).
// (SvelteKit's static-over-param precedence keeps POST /sync out of :appid,
// matching the relay router's registration order.)
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { rebuild } from '$lib/server/relay/shared/cache-manager.js'
import { syncGame } from '$lib/server/relay/community-reviews/community-reviews.service.js'

export const POST = relayRoute('community-reviews', async ({ params, url }) => {
    const appid = Number(params.appid)
    if (!appid) return json({ error: 'Invalid appid' }, 400)
    try {
        const force  = url.searchParams.get('force') === 'true'
        const result = await syncGame(appid, { force })
        await rebuild('community-reviews')
        return json(result)
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error('[community-reviews] Single-game sync failed', { appid, err: message })
        return json({ error: message }, 500)
    }
})
