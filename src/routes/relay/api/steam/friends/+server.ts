// GET /relay/api/steam/friends — the friends cache (list + enriched profiles).
// Ports relay steam account.controller handleGetFriends (router mounted at
// /api/steam).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getFriends } from '$lib/server/relay/steam/account.service.js'

export const GET = relayRoute('steam', async () => {
    try {
        return json(await getFriends())
    } catch (err) {
        logger.error('Failed to get friends', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: 'Failed to read friends cache' }, 500)
    }
})
