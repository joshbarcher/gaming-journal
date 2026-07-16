// GET /relay/api/steam/stats — the player-stats cache (ports relay
// stats.controller handleGetPlayerStats; router mounted at /api/steam).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getPlayerStats } from '$lib/server/relay/steam/stats.service.js'

export const GET = relayRoute('steam-stats', async () => {
    return json(await getPlayerStats())
})
