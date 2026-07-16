// GET /relay/api/guides/:steamId/:source/:guideId/meta — _meta.json for one
// downloaded guide (ports relay guides.controller handleMeta).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getMeta } from '$lib/server/relay/guides/guides.controller.js'

export const GET = relayRoute('guides', async ({ params }) => {
    const { status, body } = await getMeta(params.steamId, params.source, params.guideId)
    return json(body, status)
})
