// GET /relay/api/reddit/:appid — a game's resolved community feed.
// ?name= enables an on-demand sync on cache miss (ports relay
// reddit.controller handleGetReddit, including its exact status bodies).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { resolveEntry, syncGame } from '$lib/server/relay/reddit/reddit.service.js'

export const GET = relayRoute('reddit', async ({ params, url }) => {
    try {
        const appid    = Number(params.appid)
        const gameName = url.searchParams.get('name') ?? null
        let entry      = await resolveEntry(appid)

        // On-demand fetch if not cached and name is provided
        if (!entry && gameName) {
            try {
                await syncGame(appid, gameName)
                entry = await resolveEntry(appid)
            } catch (err) {
                logger.warn('[reddit] On-demand fetch failed', { appid, err: err instanceof Error ? err.message : String(err) })
            }
        }

        if (!entry) return json({ error: 'Reddit data not cached' }, 404)
        return json(entry)
    } catch (err) {
        logger.error('[reddit] Get failed', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
})
