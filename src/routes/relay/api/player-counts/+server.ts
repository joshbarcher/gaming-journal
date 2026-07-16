// GET /relay/api/player-counts — the full sorted index (latest/peaks/samples24h
// per game). Ports relay player-counts.controller handleGetIndex.
//
// Index build: the relay boot-wires build() in server.js's listen callback.
// Until boot.js wires the journal the same way, build lazily here (pure reads
// on a migrated store; idempotent — see ensureBuilt() in the service).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getIndex, ensureBuilt } from '$lib/server/relay/steam/player-counts.service.js'

export const GET = relayRoute('player-counts', async () => {
    await ensureBuilt()
    return json(getIndex())
})
