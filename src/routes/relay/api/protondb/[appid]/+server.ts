// GET /relay/api/protondb/:appid — one game's compat summary.
// ?fetch=true on a cache miss does a SYNCHRONOUS on-demand fetch (unlike
// ITAD's 202 — this is the relay controller's exact behavior).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getEntry, syncOne } from '$lib/server/relay/protondb/protondb.service.js'

export const GET = relayRoute('protondb', async ({ params, url }) => {
    const appid = Number(params.appid)
    let entry = await getEntry(appid)

    if (!entry && url.searchParams.get('fetch') === 'true') {
        try {
            const result = await syncOne(appid, { force: true })
            entry = result.entry
        } catch (err) {
            logger.warn('[protondb] On-demand fetch failed', { appid, err: err instanceof Error ? err.message : String(err) })
        }
    }

    if (!entry) return json({ error: 'ProtonDB entry not cached' }, 404)
    return json(entry)
})
