// GET /relay/api/steam/account — the raw Steam account cache (profile, level,
// badges, bans). Ports relay steam account.controller handleGetAccount
// (router mounted at /api/steam).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getAccount } from '$lib/server/relay/steam/account.service.js'

export const GET = relayRoute('steam', async () => {
    try {
        return json(await getAccount())
    } catch (err) {
        logger.error('Failed to get account', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: 'Failed to read account cache' }, 500)
    }
})
