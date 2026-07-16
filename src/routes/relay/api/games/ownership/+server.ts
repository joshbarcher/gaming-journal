// GET /relay/api/games/ownership — thin projection (appid + source only) for
// ownership badge rendering. Ports relay games.controller handleGetOwnership.
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getAll, ensureBuilt } from '$lib/server/relay/games/games.service.js'

export const GET = relayRoute('games', async () => {
    await ensureBuilt()
    return json(getAll().map((g: any) => ({ appid: g.appid, source: g.source })))
})
