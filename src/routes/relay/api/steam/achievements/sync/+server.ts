// POST /relay/api/steam/achievements/sync — fire-and-forget (relay
// handleSyncAchievements: the response goes out immediately; the sync + cache
// rebuild continue in the background). Overlap protection lives inside
// syncAchievements itself (_syncAchievementsRunning) — a concurrent call
// resolves with zero counts rather than 409ing, matching the relay exactly.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { rebuild } from '$lib/server/relay/shared/cache-manager.js'
import { syncAchievements } from '$lib/server/relay/steam/steam.service.js'

export const POST = relayRoute('steam', ({ url }) => {
    const force = url.searchParams.get('force') === 'true'
    // Promise.resolve: the service's JSDoc @returns types the resolved value,
    // which checkJs takes over the async inference — normalize to a Promise.
    Promise.resolve(syncAchievements({ force }))
        .then(() => rebuild('account'))
        .catch((err: unknown) => logger.error('Failed to sync achievements', { err: err instanceof Error ? err.message : String(err) }))
    return json({ message: 'Achievement sync started' })
})
