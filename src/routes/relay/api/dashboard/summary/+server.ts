// GET /relay/api/dashboard/summary — per-source status rows + disk footprint
// (ports relay dashboard.controller handleSummary). Read-only and safe to poll.
//
// The relay's dashboard HTML page (src/public/dashboard/) is relay-internal
// and is NOT ported — only the JSON API moves; the page retires at
// decommission (docs/relay-fold-in.md § Phase 7).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getSummary } from '$lib/server/relay/metrics/dashboard.service.js'

export const GET = relayRoute('dashboard', async () => {
    try {
        return json(await getSummary())
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error('[dashboard] Failed to build summary', { err: message })
        return json({ error: message }, 500)
    }
})
