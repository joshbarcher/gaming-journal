// POST /relay/api/steam/images/games/sync — full game-image sync,
// fire-and-forget (ports relay images.controller handleSyncGameImages).
// Guarded under 'steam:images' (its sources.js id — the dashboard's manual
// trigger runs the same sync) so overlapping full CDN sweeps can't stack.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { syncGameImages } from '$lib/server/relay/steam/images.service.js'
import { refresh as refreshPosterPool } from '$lib/server/relay/games/poster-pool.service.js'
import { begin, end, isRunning, setProgress } from '$lib/server/relay/metrics/job-guard.js'

export const POST = relayRoute('steam-images', ({ url }) => {
    if (isRunning('steam:images')) return json({ error: 'Sync already in progress' }, 409)
    begin('steam:images')

    const force = url.searchParams.get('force') === 'true'
    syncGameImages({ force, onProgress: (done: number, total: number) => {
        setProgress('steam:images', done, total)
        if (done % 500 === 0 || done === total)
            logger.info('[steam-images] Game images progress', { done, total })
    }})
        .then(() =>
            // Sync may have downloaded new poster.jpg files — re-check missing entries
            // and refill the pool so the next home page request reflects the new images.
            refreshPosterPool().catch((err: unknown) =>
                logger.error('[steam-images] Poster pool refresh after sync failed', { err: err instanceof Error ? err.message : String(err) })
            )
        )
        .catch((err: unknown) => logger.error('Failed to sync game images', { err: err instanceof Error ? err.message : String(err) }))
        .finally(() => end('steam:images'))

    return json({ message: 'Game image sync started' })
})
