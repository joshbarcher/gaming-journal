// POST /relay/api/recommend — one step of the recommendation Q&A flow
// (ports relay recommend.controller handleRecommend, body validation included).
// games cache: boot-wired on the relay; built lazily on first request here
// (same pattern as api/games — see ensureBuilt() in games.service.js).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { ensureBuilt } from '$lib/server/relay/games/games.service.js'
import { getRecommendation } from '$lib/server/relay/recommend/recommend.service.js'

export const POST = relayRoute('recommend', async ({ request }) => {
    await ensureBuilt()
    const body = await request.json().catch(() => ({})) ?? {}
    const { depth = 'normal', sequence, filters = [] } = body

    if (!['shallow', 'normal', 'deep'].includes(depth)) {
        return json({ error: 'depth must be shallow, normal, or deep' }, 400)
    }
    if (!Array.isArray(filters)) {
        return json({ error: 'filters must be an array' }, 400)
    }

    return json(getRecommendation({ depth, sequence, filters }))
})
