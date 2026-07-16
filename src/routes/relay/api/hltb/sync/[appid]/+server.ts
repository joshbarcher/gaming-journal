// POST /relay/api/hltb/sync/:appid — synchronous single-game re-search.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { rebuild } from '$lib/server/relay/shared/cache-manager.js'
import { syncGame } from '$lib/server/relay/hltb/hltb.service.js'

export const POST = relayRoute('hltb', async ({ params, url }) => {
    try {
        const force = url.searchParams.get('force') === 'true'
        // ?name= lets callers sync games that aren't in the Steam library
        // (the relay's discovery worker passes the store name this way).
        const steamName = url.searchParams.get('name') ?? undefined
        const result = await syncGame(params.appid!, { force, steamName })
        await rebuild('games')
        return json(result)
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (message.includes('not found')) return json({ error: message }, 404)
        logger.error('Failed to sync HLTB game', { err: message })
        return json({ error: 'HLTB sync failed' }, 500)
    }
})
