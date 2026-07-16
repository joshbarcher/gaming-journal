// POST /relay/api/pcgw/sync/:appid — synchronous single-game sync
// (ports relay pcgw.controller handleSyncGame).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { rebuild } from '$lib/server/relay/shared/cache-manager.js'
import { syncGame } from '$lib/server/relay/pcgw/pcgw.service.js'

export const POST = relayRoute('pcgw', async ({ params, url }) => {
    const appid = Number(params.appid)
    if (!appid) return json({ error: 'Invalid appid' }, 400)
    try {
        const force   = url.searchParams.get('force') === 'true'
        const reparse = url.searchParams.get('reparse') === 'true'
        // ?name= lets callers sync games that aren't in the Steam library
        // (the relay's discovery worker passes the store name this way).
        const steamName = url.searchParams.get('name') ?? undefined
        const result  = await syncGame(appid, { force, reparse, steamName })
        await rebuild('games')
        return json(result)
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error('[pcgw] Single-game sync failed', { appid, err: message })
        return json({ error: message }, 500)
    }
})
