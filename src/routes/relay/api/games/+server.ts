// GET /relay/api/games — the merged games cache (library + wishlist + local),
// every entry overlaid with the relay-derived playtime. Ports relay
// games.controller handleGetAll verbatim.
//
// play-log + cache build: the relay boot-wires both in server.js's listen
// callback. Until boot.js wires the journal the same way, load/build lazily
// here — both are idempotent, so after the first request every read is
// in-memory (see ensureBuilt() in games.service.js).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getAll, ensureBuilt } from '$lib/server/relay/games/games.service.js'
import { load as loadPlayLog, getEffectivePlaytimeMin } from '$lib/server/relay/steam/play-log.service.js'

export const GET = relayRoute('games', async () => {
    await Promise.all([ensureBuilt(), loadPlayLog()])
    // Inject relay-derived playtime for every game that has sessions.
    // getAll() carries Steam's playtime_forever via playtimeMinutes; the relay
    // commits sessions immediately so it's always more current after a session ends.
    const games = getAll().map((g: any) => {
        const effective = getEffectivePlaytimeMin(g.appid)
        return { ...g, playtimeMinutes: effective }
    })
    return json(games)
})
