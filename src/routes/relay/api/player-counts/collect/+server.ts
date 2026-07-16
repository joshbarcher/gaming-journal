// POST /relay/api/player-counts/collect — manual collection trigger. Answers
// immediately (the express controller responded before the work finished) and
// runs owned + global-top collection in the background, then rebuilds the
// index; 409 while a collection is already running. Ports relay
// player-counts.controller handleCollect, including the module-level guard.
//
// NAS-writing (samples + compaction land in player-counts.json) — in dev this
// stays proxied upstream via RELAY_FORWARD, same as every mutation route.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { rebuild } from '$lib/server/relay/shared/cache-manager.js'
import { collectOwned, collectGlobalTop } from '$lib/server/relay/steam/player-counts.service.js'

let collecting = false

export const POST = relayRoute('player-counts', () => {
    if (collecting) return json({ error: 'Collection already in progress' }, 409)
    collecting = true
    void (async () => {
        try {
            await collectOwned()
            await collectGlobalTop()
            await rebuild('player-counts')
        } catch (err) {
            logger.error('[player-counts] Manual collect failed', { err: err instanceof Error ? err.message : String(err) })
        } finally {
            collecting = false
        }
    })()
    return json({ message: 'Player count collection started' })
})
