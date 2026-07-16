// POST /relay/api/protondb/sync — fire-and-forget full sync with 409 guard.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { syncAll } from '$lib/server/relay/protondb/protondb.service.js'
import { begin, end, isRunning } from '$lib/server/relay/metrics/job-guard.js'

export const POST = relayRoute('protondb', ({ url }) => {
    if (isRunning('protondb')) return json({ error: 'Sync already in progress' }, 409)
    begin('protondb')

    const force = url.searchParams.get('force') === 'true'
    syncAll({ force })
        .catch((err: unknown) => logger.error('[protondb] Full sync failed', { err: err instanceof Error ? err.message : String(err) }))
        .finally(() => end('protondb'))

    return json({ ok: true, message: 'ProtonDB full sync started' })
})
