// POST /relay/api/steam/recently-played/sync — synchronous sync (relay
// handleSyncRecentlyPlayed: the caller waits for the result; ?force=true
// bypasses the 1h TTL).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { rebuild } from '$lib/server/relay/shared/cache-manager.js'
import { syncRecentlyPlayed } from '$lib/server/relay/steam/steam.service.js'

export const POST = relayRoute('steam', async ({ url }) => {
    try {
        const result = await syncRecentlyPlayed({ force: url.searchParams.get('force') === 'true' })
        await rebuild('account')
        return json(result)
    } catch (err) {
        logger.error('Failed to sync recently played', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
})
