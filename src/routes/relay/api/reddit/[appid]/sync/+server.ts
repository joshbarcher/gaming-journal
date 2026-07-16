// POST /relay/api/reddit/:appid/sync?name=<game>[&force=true] — fire-and-forget
// game sync with a 409 overlap guard (ports relay reddit.controller
// handleSyncReddit: the controller's module-level `_syncing` flag becomes the
// shared job-guard so the dashboard sees the run, 'reddit' is a registered
// metrics source id). The response goes out immediately; progress streams over
// GET /sync/progress.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { syncGame, initProgress } from '$lib/server/relay/reddit/reddit.service.js'
import { begin, end, isRunning } from '$lib/server/relay/metrics/job-guard.js'

export const POST = relayRoute('reddit', ({ params, url }) => {
    if (isRunning('reddit')) return json({ error: 'Sync already in progress' }, 409)
    const appid    = Number(params.appid)
    const gameName = url.searchParams.get('name') ?? null
    if (!gameName) return json({ error: 'name query param required' }, 400)

    begin('reddit')
    initProgress(appid)
    syncGame(appid, gameName, { force: url.searchParams.get('force') === 'true' })
        .catch((err: unknown) => logger.error('[reddit] Sync failed', { err: err instanceof Error ? err.message : String(err) }))
        .finally(() => end('reddit'))

    return json({ ok: true, message: 'Reddit sync started' })
})
