// GET /relay/api/home — the precomputed landing-page payload (ports relay
// home.controller handleGetHome; errors → 500 via the relayRoute wrapper).
//
// games cache + play-log: the relay boot-wires both in server.js's listen
// callback. Until boot.js wires the journal the same way, load/build lazily
// here — both are idempotent, so after the first request every read is
// in-memory (same pattern as api/games — see ensureBuilt() in games.service.js).
// home.service already refuses to cache a payload built before the games cache
// is warm, so racing requests degrade to a rebuild, never a blank 60s cache.
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { ensureBuilt } from '$lib/server/relay/games/games.service.js'
import { load as loadPlayLog } from '$lib/server/relay/steam/play-log.service.js'
import { getHomeData } from '$lib/server/relay/home/home.service.js'

export const GET = relayRoute('home', async () => {
    await Promise.all([ensureBuilt(), loadPlayLog()])
    return json(await getHomeData())
})
