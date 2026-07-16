// GET /relay/api/pcgw/:appid — one game's cached PCGW entry.
// ?fetch=true on a cache miss kicks off an on-demand sync and answers
// 202 {status:'pending'} (ports relay pcgw.controller handleGetEntry).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getEntry, syncGame } from '$lib/server/relay/pcgw/pcgw.service.js'

export const GET = relayRoute('pcgw', async ({ params, url }) => {
    const appid = Number(params.appid)
    const entry = await getEntry(appid)

    if (!entry && url.searchParams.get('fetch') === 'true') {
        const steamName = url.searchParams.get('name') ?? undefined
        syncGame(appid, { steamName }).catch((err: unknown) => {
            logger.warn('[pcgw] On-demand fetch failed', { appid, err: err instanceof Error ? err.message : String(err) })
        })
        return json({ status: 'pending' }, 202)
    }

    if (!entry) return json({ error: 'PCGW entry not cached' }, 404)
    return json(entry)
})
