// GET /relay/api/dashboard/errors?limit=N — recent failed runs, newest first
// (ports relay dashboard.controller handleErrors, limit clamped 1–200).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getRecentErrors } from '$lib/server/relay/metrics/dashboard.service.js'

const MAX_ERRORS = 200

/** Clamp a query param to a sane integer, falling back when absent or garbage. */
function intParam(raw: string | null, fallback: number, min: number, max: number) {
    const n = Number.parseInt(raw ?? '', 10)
    if (!Number.isFinite(n)) return fallback
    return Math.min(Math.max(n, min), max)
}

export const GET = relayRoute('dashboard', async ({ url }) => {
    try {
        const limit = intParam(url.searchParams.get('limit'), 25, 1, MAX_ERRORS)
        return json({ errors: await getRecentErrors({ limit }) })
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error('[dashboard] Failed to list errors', { err: message })
        return json({ error: message }, 500)
    }
})
