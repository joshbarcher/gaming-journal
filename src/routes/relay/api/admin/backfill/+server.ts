// POST /relay/api/admin/backfill — fire-and-forget whole-library provision
// backfill (ports relay admin.controller handleBackfill: respond first, run in
// the background).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { backfill } from '$lib/server/relay/provision.service.js'

export const POST = relayRoute('admin', () => {
    backfill().catch((err: unknown) => logger.error('[admin] Backfill failed', { err: err instanceof Error ? err.message : String(err) }))
    return json({ ok: true, message: 'Backfill started' })
})
