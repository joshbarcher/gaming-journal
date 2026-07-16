// GET /relay/api/steam/playtime/last-played — { [appid]: lastPlayedAtISO } from
// the in-memory play-log store. Fast, synchronous in the relay — used by the
// landing page to pick the resume card. Ports relay sessions.controller
// handleGetLastPlayed.
//
// The relay boot-wires loadPlayLog() before serving; until boot.js wires the
// journal the same way, load lazily here (idempotent — same pattern as
// api/games, see play-log.service.js header).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { load as loadPlayLog, getLastPlayedMap } from '$lib/server/relay/steam/play-log.service.js'

export const GET = relayRoute('sessions', async () => {
    await loadPlayLog()
    return json(getLastPlayedMap())
})
