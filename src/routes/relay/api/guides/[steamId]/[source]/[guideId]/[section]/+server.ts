// GET /relay/api/guides/:steamId/:source/:guideId/:section — content.json for
// one section of a guide (ports relay guides.controller handleSection).
// Fixed-segment sibling routes (meta, fulltext, mark-used, pins) win over this
// param route — SvelteKit specificity replaces the relay's route ordering.
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getSection } from '$lib/server/relay/guides/guides.controller.js'

export const GET = relayRoute('guides', async ({ params }) => {
    const { status, body } = await getSection(params.steamId, params.source, params.guideId, params.section)
    return json(body, status)
})
