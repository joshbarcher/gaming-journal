// POST /relay/api/steam/games/sync — synchronous sync (relay handleSyncGames:
// the caller waits for the result; ?force=true bypasses the 24h TTL). The
// rebuild targets warn "Unknown cache" harmlessly until games/account/upcoming
// caches register journal-side (Wave 3 companions).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { rebuild } from '$lib/server/relay/shared/cache-manager.js'
import { syncGames } from '$lib/server/relay/steam/steam.service.js'

export const POST = relayRoute('steam', async ({ url }) => {
    try {
        const result = await syncGames({ force: url.searchParams.get('force') === 'true' })
        await rebuild('games', 'account', 'upcoming')
        return json(result)
    } catch (err) {
        logger.error('Failed to sync games', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
})
