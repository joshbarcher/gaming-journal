// GET /relay/api/steam/store/details — summary index of every cached store
// detail (ports relay store.controller handleGetGameDetailIndex).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getGameDetailIndex } from '$lib/server/relay/steam/store.service.js'

export const GET = relayRoute('steam-store', async () => {
    return json(await getGameDetailIndex())
})
