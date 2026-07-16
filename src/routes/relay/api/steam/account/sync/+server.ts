// POST /relay/api/steam/account/sync — sync profile/level/badges/bans from the
// Steam Web API (?force=true bypasses the 6h TTL). Ports relay steam
// account.controller handleSyncAccount.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { syncAccount } from '$lib/server/relay/steam/account.service.js'

export const POST = relayRoute('steam', async ({ url }) => {
    try {
        return json(await syncAccount({ force: url.searchParams.get('force') === 'true' }))
    } catch (err) {
        logger.error('Failed to sync account', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
})
