// GET /relay/api/steam/store/details/<appid> — one cached store detail
// (ports relay store.controller handleGetGameDetail; 404 when not cached).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getGameDetail } from '$lib/server/relay/steam/store.service.js'

export const GET = relayRoute('steam-store', async ({ params }) => {
    const detail = await getGameDetail(params.appid)
    if (!detail) return json({ error: 'App detail not cached' }, 404)
    return json(detail)
})
