// POST /relay/api/steam/community-reviews/sync — full sync, fire-and-forget
// with an overlap guard (ports relay handleSyncAll: the response goes out
// immediately; the sync + cache rebuild continue in the background). The
// controller's module-scope `syncing` flag becomes the shared job-guard so the
// dashboard sees the run ('steam:community-reviews' is its sources.js id).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { rebuild } from '$lib/server/relay/shared/cache-manager.js'
import { syncAll } from '$lib/server/relay/community-reviews/community-reviews.service.js'
import { begin, end, isRunning } from '$lib/server/relay/metrics/job-guard.js'

export const POST = relayRoute('community-reviews', ({ url }) => {
    if (isRunning('steam:community-reviews')) return json({ error: 'Sync already in progress' }, 409)
    begin('steam:community-reviews')

    const force = url.searchParams.get('force') === 'true'
    syncAll({ force, onProgress: (done: number, total: number) => {
        if (done % 100 === 0 || done === total)
            logger.info('[community-reviews] Progress', { done, total })
    }})
        .then(() => rebuild('community-reviews'))
        .catch((err: unknown) => logger.error('[community-reviews] Sync failed', { err: err instanceof Error ? err.message : String(err) }))
        .finally(() => end('steam:community-reviews'))

    return json({ message: 'Community reviews sync started' })
})
