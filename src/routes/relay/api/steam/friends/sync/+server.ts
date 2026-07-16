// POST /relay/api/steam/friends/sync — sync the friend list + profile summaries
// from the Steam Web API (?force=true bypasses the 24h TTL). Ports relay steam
// account.controller handleSyncFriends.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { syncFriends } from '$lib/server/relay/steam/account.service.js'

export const POST = relayRoute('steam', async ({ url }) => {
    try {
        return json(await syncFriends({ force: url.searchParams.get('force') === 'true' }))
    } catch (err) {
        logger.error('Failed to sync friends', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
})
