// POST /relay/api/itad/resolve-urls — fire-and-forget URL resolution sweep.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { resolveAll } from '$lib/server/relay/itad/itad.service.js'

export const POST = relayRoute('itad', () => {
    resolveAll().catch((err: unknown) => logger.error('[itad] resolveAll failed', { err: err instanceof Error ? err.message : String(err) }))
    return json({ ok: true, message: 'ITAD URL resolution started' })
})
