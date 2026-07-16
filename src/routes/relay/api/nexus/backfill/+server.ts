// /relay/api/nexus/backfill — adult-mod image backfill job
// (ports relay nexus.controller backfill handlers).
//   GET  — backfill progress
//   POST — action: start | pause | reset (body or query, matching the relay
//          controller's `req.body?.action ?? req.query.action`)
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { startBackfill, pauseBackfill, getBackfillStatus, resetBackfill } from '$lib/server/relay/nexus/backfill.service.js'

export const GET = relayRoute('nexus', async () => {
    return json(await getBackfillStatus())
})

export const POST = relayRoute('nexus', async ({ request, url }) => {
    const body = await request.json().catch(() => null)
    const action = (body as { action?: string } | null)?.action ?? url.searchParams.get('action')
    if (action === 'start') return json(await startBackfill({ rebuild: url.searchParams.get('rebuild') === 'true' }))
    if (action === 'pause') return json(await pauseBackfill())
    if (action === 'reset') return json(await resetBackfill())
    return json({ error: 'action must be start | pause | reset' }, 400)
})
