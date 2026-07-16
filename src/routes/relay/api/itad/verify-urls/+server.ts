// POST /relay/api/itad/verify-urls — fire-and-forget URL verification sweep.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { verifyAll } from '$lib/server/relay/itad/itad.service.js'

export const POST = relayRoute('itad', () => {
    verifyAll().catch((err: unknown) => logger.error('[itad] verifyAll failed', { err: err instanceof Error ? err.message : String(err) }))
    return json({ ok: true, message: 'ITAD URL verification started' })
})
