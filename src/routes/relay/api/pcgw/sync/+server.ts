// POST /relay/api/pcgw/sync — full sync, fire-and-forget with a 409 overlap
// guard (ports relay pcgw.controller handleSyncAll: the response goes out
// immediately; the sync + cache rebuild continue in the background).
//   ?force=true   → re-fetch every page (slow: one browser page load per game)
//   ?reparse=true → re-parse cached HTML only (no network; backfills new fields)
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { rebuild } from '$lib/server/relay/shared/cache-manager.js'
import { syncAll } from '$lib/server/relay/pcgw/pcgw.service.js'
import { begin, end, isRunning } from '$lib/server/relay/metrics/job-guard.js'

export const POST = relayRoute('pcgw', ({ url }) => {
    if (isRunning('pcgw')) return json({ error: 'Sync already in progress' }, 409)
    begin('pcgw')

    const force   = url.searchParams.get('force') === 'true'
    const reparse = url.searchParams.get('reparse') === 'true'
    syncAll({ force, reparse })
        .then(() => rebuild('games'))
        .catch((err: unknown) => logger.error('[pcgw] Sync failed', { err: err instanceof Error ? err.message : String(err) }))
        .finally(() => end('pcgw'))

    return json({ message: 'PCGW sync started' })
})
