// GET /relay/api/steam/achievements — full in-memory achievement cache with
// localIcon/localIconGray paths (relay handleGetAchievements).
//
// Awaits the cache rather than assuming boot populated it: the load moved off the
// boot critical path (boot.js tier 1 — it reads ~1650 per-game files, 2.5s on the
// NAS), so a request arriving in that window would otherwise get {}. The ensure
// helper shares the single in-flight load, so this costs nothing once warm.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getAchievements, ensureAchievementsLoaded } from '$lib/server/relay/steam/steam.service.js'

export const GET = relayRoute('steam', async () => {
    try {
        await ensureAchievementsLoaded()
        return json(getAchievements())
    } catch (err) {
        logger.error('Failed to get achievements', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: 'Failed to read achievements cache' }, 500)
    }
})
