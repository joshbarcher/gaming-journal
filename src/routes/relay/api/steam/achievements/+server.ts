// GET /relay/api/steam/achievements — full in-memory achievement cache with
// localIcon/localIconGray paths (relay handleGetAchievements).
//
// Serves whatever loadAchievementsCache() has populated: the relay loads this
// cache at boot (server.js), so boot.js must call loadAchievementsCache() the
// same way — until then this returns {}.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getAchievements } from '$lib/server/relay/steam/steam.service.js'

export const GET = relayRoute('steam', () => {
    try {
        return json(getAchievements())
    } catch (err) {
        logger.error('Failed to get achievements', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: 'Failed to read achievements cache' }, 500)
    }
})
