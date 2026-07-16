// POST /relay/api/guides/:steamId/download — fetch + parse a guide via child
// processes, streaming progress as SSE (ports relay guides.controller
// handleDownload; SSE event shape: { phase: 'fetch'|'parse'|'progress'|'done'|'error', line?, message? }).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { sseResponse } from '$lib/server/relay/guides/sse.js'
import { beginDownload } from '$lib/server/relay/guides/guides.controller.js'

export const POST = relayRoute('guides', async ({ params, request }) => {
    const body = await request.json().catch(() => ({}))
    const result = beginDownload(params.steamId, body)
    if (!('run' in result)) return json(result.body, result.status)
    return sseResponse(result.run)
})
