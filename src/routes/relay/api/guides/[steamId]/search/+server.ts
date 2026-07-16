// GET  /relay/api/guides/:steamId/search — cached _search.json (or null)
// POST /relay/api/guides/:steamId/search — live guide search, SSE progress
// (ports relay guides.controller handleSearch / handleSearchRun; SSE event
// shapes are identical: { phase: 'status'|'done'|'not_found'|'error', … }).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { sseResponse } from '$lib/server/relay/guides/sse.js'
import { getSearch, beginSearchRun } from '$lib/server/relay/guides/guides.controller.js'

export const GET = relayRoute('guides', async ({ params }) => {
    return json(await getSearch(params.steamId))
})

export const POST = relayRoute('guides', async ({ params, request }) => {
    const body = await request.json().catch(() => ({}))
    const result = beginSearchRun(params.steamId, body)
    if (!('run' in result)) return json(result.body, result.status)
    return sseResponse(result.run)
})
