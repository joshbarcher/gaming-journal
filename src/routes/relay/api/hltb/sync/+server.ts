// POST /relay/api/hltb/sync — fire-and-forget full sync with 409 guard.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { rebuild } from '$lib/server/relay/shared/cache-manager.js'
import { syncAll } from '$lib/server/relay/hltb/hltb.service.js'
import { begin, end, isRunning } from '$lib/server/relay/metrics/job-guard.js'

export const POST = relayRoute('hltb', ({ url }) => {
    if (isRunning('hltb')) return json({ error: 'Sync already in progress' }, 409)
    begin('hltb')

    const force = url.searchParams.get('force') === 'true'
    syncAll({
        force,
        onProgress: (done: number, total: number) => {
            if (done % 10 === 0 || done === total) logger.info('[hltb] Sync progress', { done, total })
        },
    })
        .then(() => rebuild('games'))
        .catch((err: unknown) => logger.error('Failed to sync HLTB', { err: err instanceof Error ? err.message : String(err) }))
        .finally(() => end('hltb'))

    return json({ message: 'HLTB sync started' })
})
