// POST /relay/api/guides/:steamId/:source/:guideId/mark-used — record "now"
// as the guide's lastUsedAt (ports relay guides.controller handleMarkUsed).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { markUsed } from '$lib/server/relay/guides/guides.controller.js'

export const POST = relayRoute('guides', async ({ params }) => {
    const { status, body } = await markUsed(params.steamId, params.source, params.guideId)
    return json(body, status)
})
