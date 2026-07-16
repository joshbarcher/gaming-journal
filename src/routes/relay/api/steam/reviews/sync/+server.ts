// POST /relay/api/steam/reviews/sync — fire-and-forget delta review sync via
// the appreviews API (relay handleSyncReviews: the response goes out
// immediately; the sync + cache rebuild continue in the background).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { rebuild } from '$lib/server/relay/shared/cache-manager.js'
import { syncReviews } from '$lib/server/relay/steam/steam.service.js'

export const POST = relayRoute('steam', ({ url }) => {
    const force = url.searchParams.get('force') === 'true'
    syncReviews({ force })
        .then(() => rebuild('account'))
        .catch((err: unknown) => logger.error('Failed to sync reviews', { err: err instanceof Error ? err.message : String(err) }))
    return json({ message: 'Reviews sync started' })
})
