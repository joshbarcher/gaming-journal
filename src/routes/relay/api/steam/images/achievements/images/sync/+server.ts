// POST /relay/api/steam/images/achievements/images/sync — achievement icon
// download sweep, fire-and-forget (ports relay images.controller
// handleSyncAchievementImages). No overlap guard in the relay controller —
// kept verbatim.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { syncAchievementImages } from '$lib/server/relay/steam/images.service.js'

export const POST = relayRoute('steam-images', ({ url }) => {
    const force = url.searchParams.get('force') === 'true'
    syncAchievementImages({ force, onProgress: (done: number, total: number) => {
        if (done % 1000 === 0 || done === total)
            logger.info('[steam-images] Achievement images progress', { done, total })
    }})
        .catch((err: unknown) => logger.error('Failed to sync achievement images', { err: err instanceof Error ? err.message : String(err) }))

    return json({ message: 'Achievement image sync started' })
})
