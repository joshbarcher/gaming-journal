// POST /relay/api/steam/images/migrate-sources — one-time .src sidecar →
// sources.json migration (ports relay images.controller
// handleMigrateSrcSidecars; synchronous response with the result counts).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { migrateSrcSidecars } from '$lib/server/relay/steam/images.service.js'

export const POST = relayRoute('steam-images', async () => {
    return json(await migrateSrcSidecars())
})
