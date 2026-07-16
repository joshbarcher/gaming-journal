// GET /relay/api/dashboard/timeseries?days=N — daily stacked-bar data
// (ports relay dashboard.controller handleTimeseries, days clamped 1–90).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getTimeseries } from '$lib/server/relay/metrics/dashboard.service.js'

const MAX_DAYS = 90

/** Clamp a query param to a sane integer, falling back when absent or garbage. */
function intParam(raw: string | null, fallback: number, min: number, max: number) {
    const n = Number.parseInt(raw ?? '', 10)
    if (!Number.isFinite(n)) return fallback
    return Math.min(Math.max(n, min), max)
}

export const GET = relayRoute('dashboard', async ({ url }) => {
    try {
        const days = intParam(url.searchParams.get('days'), 14, 1, MAX_DAYS)
        return json(await getTimeseries({ days }))
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error('[dashboard] Failed to build timeseries', { err: message })
        return json({ error: message }, 500)
    }
})
