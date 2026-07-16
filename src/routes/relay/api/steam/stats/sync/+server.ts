// POST /relay/api/steam/stats/sync — player-stats sync, fire-and-forget
// (ports relay stats.controller handleSyncPlayerStats). No overlap guard in
// the relay controller — kept verbatim.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { syncPlayerStats } from '$lib/server/relay/steam/stats.service.js'

export const POST = relayRoute('steam-stats', ({ url }) => {
    const force = url.searchParams.get('force') === 'true'
    syncPlayerStats({ force, onProgress: (done: number, total: number) => {
        if (done % 100 === 0 || done === total)
            logger.info('[steam-stats] Progress', { done, total })
    }})
        .catch((err: unknown) => logger.error('Failed to sync player stats', { err: err instanceof Error ? err.message : String(err) }))

    return json({ message: 'Player stats sync started' })
})
