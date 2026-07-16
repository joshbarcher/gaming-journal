// GET /relay/api/admin/sources — source ids with a manual trigger, and which
// of them are running right now (ports relay admin.controller
// handleSourceActions).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { listActions } from '$lib/server/relay/metrics/actions.js'
import { listRunning } from '$lib/server/relay/metrics/job-guard.js'
import { isScanning } from '$lib/server/relay/metrics/disk-usage.service.js'

export const GET = relayRoute('admin', () => {
    return json({
        available:    listActions(),
        running:      listRunning(),
        diskScanning: isScanning(),
    })
})
