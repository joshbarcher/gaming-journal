// GET /relay/api/itad/:appid — one game's cached prices.
// ?fetch=true on a cache miss kicks off an on-demand sync and answers
// 202 {status:'pending'} (the relay controller contract).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getEntry, syncOne } from '$lib/server/relay/itad/itad.service.js'

export const GET = relayRoute('itad', async ({ params, url }) => {
    const appid = Number(params.appid)
    const entry = await getEntry(appid)

    if (!entry && url.searchParams.get('fetch') === 'true') {
        const steamName = url.searchParams.get('name')
        syncOne(appid, steamName).catch((err: unknown) => {
            logger.warn('[itad] On-demand fetch failed', { appid, err: err instanceof Error ? err.message : String(err) })
        })
        return json({ status: 'pending' }, 202)
    }

    if (!entry) return json({ error: 'ITAD entry not cached' }, 404)
    return json(entry)
})
