// POST /relay/api/steam/achievements/repair — fire-and-forget full repair pass
// (relay handleRepairAchievements): syncs every game with missing/stale
// achievement metadata, then downloads icons for newly synced games (the icon
// download is a Wave-3 debt until images.service ports — see steam.service).
// Response is immediate; work runs in the background.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { rebuild } from '$lib/server/relay/shared/cache-manager.js'
import { repairAchievements } from '$lib/server/relay/steam/steam.service.js'

export const POST = relayRoute('steam', () => {
    repairAchievements()
        .then(async (result: unknown) => {
            await rebuild('account')
            logger.info('Achievement repair complete', result)
        })
        .catch((err: unknown) => logger.error('Failed to repair achievements', { err: err instanceof Error ? err.message : String(err) }))
    return json({ message: 'Achievement repair started' })
})
