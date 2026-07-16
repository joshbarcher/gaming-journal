// POST /relay/api/itad/sync — full sync, fire-and-forget with a 409 overlap
// guard (ports relay itad.controller handleSyncAll: the response goes out
// immediately; the sync + cache rebuild continue in the background).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { rebuild } from '$lib/server/relay/shared/cache-manager.js'
import { syncAll } from '$lib/server/relay/itad/itad.service.js'
import { begin, end, isRunning } from '$lib/server/relay/metrics/job-guard.js'

export const POST = relayRoute('itad', ({ url }) => {
    if (isRunning('itad')) return json({ error: 'Sync already in progress' }, 409)
    begin('itad')

    const force = url.searchParams.get('force') === 'true'
    syncAll({ force })
        .then(() => rebuild('games', 'wishlist'))
        .catch((err: unknown) => logger.error('[itad] Full sync failed', { err: err instanceof Error ? err.message : String(err) }))
        .finally(() => end('itad'))

    return json({ ok: true, message: 'ITAD full sync started' })
})
