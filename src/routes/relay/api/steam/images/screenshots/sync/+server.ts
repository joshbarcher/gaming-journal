// POST /relay/api/steam/images/screenshots/sync — screenshot download sweep,
// fire-and-forget (ports relay images.controller handleSyncScreenshotImages).
// No overlap guard in the relay controller — kept verbatim.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { syncScreenshotImages } from '$lib/server/relay/steam/images.service.js'

export const POST = relayRoute('steam-images', ({ url }) => {
    const force = url.searchParams.get('force') === 'true'
    syncScreenshotImages({ force, onProgress: (done: number, total: number) => {
        if (done % 500 === 0 || done === total)
            logger.info('[steam-images] Screenshot progress', { done, total })
    }})
        .catch((err: unknown) => logger.error('Failed to sync screenshot images', { err: err instanceof Error ? err.message : String(err) }))

    return json({ message: 'Screenshot sync started' })
})
