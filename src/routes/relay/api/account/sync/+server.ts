// POST /relay/api/account/sync — rebuild the aggregated account cache from the
// on-disk steam files + play-log. Ports relay account.controller handleSync.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { build } from '$lib/server/relay/account/account.service.js'
import { load as loadPlayLog } from '$lib/server/relay/steam/play-log.service.js'

export const POST = relayRoute('account', async () => {
    try {
        // Relay ordering guarantee (server.js): play-log loads before any build.
        await loadPlayLog()
        await build()
        return json({ ok: true })
    } catch (err) {
        logger.error('[account] Sync failed', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
})
