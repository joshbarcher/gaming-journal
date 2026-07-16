// POST /relay/api/steam/reviews/scan — fire-and-forget exhaustive review scan
// (relay handleScanReviews: no page cap, only games without a cached review).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { rebuild } from '$lib/server/relay/shared/cache-manager.js'
import { scanReviews } from '$lib/server/relay/steam/steam.service.js'

export const POST = relayRoute('steam', ({ url }) => {
    const force = url.searchParams.get('force') === 'true'
    scanReviews({ force })
        .then(() => rebuild('account'))
        .catch((err: unknown) => logger.error('Failed to scan reviews', { err: err instanceof Error ? err.message : String(err) }))
    return json({ message: 'Reviews scan started' })
})
