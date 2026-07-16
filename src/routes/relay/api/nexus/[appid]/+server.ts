// GET /relay/api/nexus/:appid — one game's cached mod section entry.
// ?fetch=true on a cache miss kicks off an on-demand sync and answers
// 202 {status:'pending'} (ports relay nexus.controller handleGetEntry).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getEntry, syncOne } from '$lib/server/relay/nexus/nexus.service.js'

export const GET = relayRoute('nexus', async ({ params, url }) => {
    const appid = Number(params.appid)
    const entry = await getEntry(appid)

    // On a cache miss, kick off a background fetch and tell the client to
    // poll. `name` lets the resolver match the Steam title to a Nexus game.
    if (!entry && url.searchParams.get('fetch') === 'true') {
        const steamName = url.searchParams.get('name')
        syncOne(appid, steamName).catch((err: unknown) =>
            logger.warn('[nexus] On-demand fetch failed', { appid, err: err instanceof Error ? err.message : String(err) }))
        return json({ status: 'pending' }, 202)
    }

    if (!entry) return json({ error: 'Nexus entry not cached' }, 404)
    return json(entry)
})
