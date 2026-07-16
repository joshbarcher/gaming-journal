// POST /relay/api/discover/applist/refresh — force-rebuild the app search
// index, fire-and-forget (ports relay discover.controller handleRefreshApplist).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { buildApplist } from '$lib/server/relay/steam/applist.service.js'

export const POST = relayRoute('discover', () => {
    buildApplist({ force: true }).catch((err: unknown) =>
        logger.error('[applist] Refresh failed', { err: err instanceof Error ? err.message : String(err) }))
    return json({ message: 'App list refresh started' })
})
