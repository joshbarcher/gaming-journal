// POST /relay/api/nexus/refresh — fire-and-forget refresh of every stale cached
// entry, with a 409 overlap guard (ports relay nexus.controller handleRefresh).
// nexus has no metrics-source registry entry (docs/relay-fold-in.md §4b), and the
// relay controller used a plain module-level flag rather than the job-guard —
// preserved here so behavior (and the dashboard's view of running jobs) matches.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { refreshStale } from '$lib/server/relay/nexus/nexus.service.js'

let refreshing = false

export const POST = relayRoute('nexus', ({ url }) => {
    if (refreshing) return json({ error: 'Refresh already in progress' }, 409)
    refreshing = true

    const force = url.searchParams.get('force') === 'true'
    refreshStale({ force })
        .catch((err: unknown) => logger.error('[nexus] Refresh failed', { err: err instanceof Error ? err.message : String(err) }))
        .finally(() => { refreshing = false })

    return json({ ok: true, message: 'Nexus refresh started' })
})
