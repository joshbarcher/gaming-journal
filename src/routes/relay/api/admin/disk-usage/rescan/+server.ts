// POST /relay/api/admin/disk-usage/rescan — force a disk-usage rescan.
// ~3 minutes over SMB, so 202 + 409 on overlap (ports relay admin.controller
// handleDiskRescan).
//
// scanAll() claims its guard synchronously before its first await, so starting
// it ahead of the response keeps the check-then-act atomic even if this handler
// later grows an await above it.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { scanAll, isScanning } from '$lib/server/relay/metrics/disk-usage.service.js'

export const POST = relayRoute('admin', () => {
    if (isScanning()) {
        return json({ error: 'Disk usage scan already in progress' }, 409)
    }

    scanAll().catch((err: unknown) => logger.error('[admin] Disk rescan failed', { err: err instanceof Error ? err.message : String(err) }))
    return json({ ok: true, message: 'Disk usage scan started' }, 202)
})
