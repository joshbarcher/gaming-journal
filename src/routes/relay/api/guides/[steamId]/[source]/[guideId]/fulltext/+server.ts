// GET /relay/api/guides/:steamId/:source/:guideId/fulltext — pre-built search
// index; builds + persists it on the fly for guides parsed before the fulltext
// feature (ports relay guides.controller handleFulltext).
import { relayRoute } from '$lib/server/relay/shared/route-helpers.js'
import { getFulltext } from '$lib/server/relay/guides/guides.controller.js'

export const GET = relayRoute('guides', async ({ params }) => {
    const { status, body, cacheControl } = await getFulltext(params.steamId, params.source, params.guideId)
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (cacheControl) headers['cache-control'] = cacheControl
    return new Response(JSON.stringify(body), { status, headers })
})
