// GET /relay/api/guides/:steamId — flat list of all downloaded guides across
// all sources (ports relay guides.controller handleList).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { listGuides } from '$lib/server/relay/guides/guides.controller.js'

export const GET = relayRoute('guides', async ({ params }) => {
    return json(await listGuides(params.steamId))
})
