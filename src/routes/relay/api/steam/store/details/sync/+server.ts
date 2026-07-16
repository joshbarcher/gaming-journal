// POST /relay/api/steam/store/details/sync — full store-details sync,
// fire-and-forget (ports relay store.controller handleSyncGameDetails: the
// response goes out immediately; the sync + cache rebuilds continue in the
// background). The relay controller has no overlap guard — kept verbatim.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { rebuild } from '$lib/server/relay/shared/cache-manager.js'
import { syncGameDetails } from '$lib/server/relay/steam/store.service.js'

export const POST = relayRoute('steam-store', ({ url }) => {
    const force = url.searchParams.get('force') === 'true'
    syncGameDetails({ force, onProgress: (done: number, total: number) => {
        if (done % 100 === 0 || done === total)
            logger.info('[steam-store] Game details progress', { done, total })
    }})
        .then(() => rebuild('games', 'upcoming', 'wishlist'))
        .catch((err: unknown) => logger.error('Failed to sync game details', { err: err instanceof Error ? err.message : String(err) }))

    return json({ message: 'Game details sync started' })
})
