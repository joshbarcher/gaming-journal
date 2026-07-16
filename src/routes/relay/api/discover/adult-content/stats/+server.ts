// GET /relay/api/discover/adult-content/stats — coverage stats for the
// adult-content descriptor cache (ports relay discover.controller
// handleAdultContentStats).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getStats as getAdultContentStats } from '$lib/server/relay/steam/adult-content.service.js'

export const GET = relayRoute('discover', async () => {
    return json(await getAdultContentStats())
})
