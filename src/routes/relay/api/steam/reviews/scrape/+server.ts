// POST /relay/api/steam/reviews/scrape — fire-and-forget full profile-page
// review scrape (relay handleScrapeReviews).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { rebuild } from '$lib/server/relay/shared/cache-manager.js'
import { scrapeUserReviews } from '$lib/server/relay/steam/scrape-reviews.service.js'

export const POST = relayRoute('steam', ({ url }) => {
    const force = url.searchParams.get('force') === 'true'
    scrapeUserReviews({ force })
        .then(() => rebuild('account'))
        .catch((err: unknown) => logger.error('Failed to scrape reviews', { err: err instanceof Error ? err.message : String(err) }))
    return json({ message: 'Reviews scrape started' })
})
