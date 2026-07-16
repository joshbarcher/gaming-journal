// GET /relay/api/account — the aggregated account snapshot (profile, steam
// gamification, library stats, recently/most played, sessions). Ports relay
// account.controller handleGet (router mounted at /api/account).
//
// The relay builds this cache at boot (loadPlayLog → buildAccountCache in
// server.js's listen callback). Until boot.js wires the journal the same way,
// load/build lazily here — play-log FIRST, then the cache build that reads it
// (both idempotent; after the first request every read is in-memory).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { get, ensureBuilt } from '$lib/server/relay/account/account.service.js'
import { load as loadPlayLog } from '$lib/server/relay/steam/play-log.service.js'

export const GET = relayRoute('account', async () => {
    await loadPlayLog()
    await ensureBuilt()
    return json(get())
})
