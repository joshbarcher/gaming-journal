// GET /relay/api/steam/achievements/:appid — one game's cached achievements
// (relay handleGetAchievementsForGame). 404 when nothing is cached.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getAchievementsForGame } from '$lib/server/relay/steam/steam.service.js'

export const GET = relayRoute('steam', ({ params }) => {
    try {
        const entry = getAchievementsForGame(params.appid)
        if (!entry) return json({ error: 'No achievement data cached for this game' }, 404)
        return json(entry)
    } catch (err) {
        logger.error('Failed to get achievements for game', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: 'Failed to read achievements' }, 500)
    }
})
