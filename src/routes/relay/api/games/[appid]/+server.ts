// GET /relay/api/games/:appid — one merged game (cache hit, or built on demand
// from disk for discovered games). ?refresh=true makes a missing-description
// re-fetch synchronous. Ports relay games.controller handleGetOne verbatim,
// including the on-demand store sync / provision / recheck side effects — in
// dev those are proxied upstream via RELAY_FORWARD so dev reads never write
// the NAS (docs/relay-fold-in.md §2 "On-demand writes from dev machines").
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getOne, getOneDiscovered, rebuildOne, ensureBuilt } from '$lib/server/relay/games/games.service.js'
import { syncOne, recheckAppDetail } from '$lib/server/relay/steam/store.service.js'
import { provisionGame } from '$lib/server/relay/provision.service.js'
import { load as loadPlayLog, getEffectivePlaytimeMin } from '$lib/server/relay/steam/play-log.service.js'

export const GET = relayRoute('games', async ({ params, url }) => {
    await Promise.all([ensureBuilt(), loadPlayLog()])
    const appid   = Number(params.appid)
    const refresh = url.searchParams.get('refresh') === 'true'
    let game = getOne(appid) ?? await getOneDiscovered(appid)

    if (!game) {
        // Discovered game with no cached store data — fetch on demand
        await syncOne(appid)
        game = await getOneDiscovered(appid)
    } else if (game.source !== 'discovered') {
        const needsStore = !game.store
        const needsAbout = game.store && !game.store.unavailable && !game.store.detailedDescription

        if (refresh && (needsStore || needsAbout)) {
            // Caller is waiting for the description — await the re-fetch and return fresh data
            if (needsStore) await provisionGame(appid, game.name)
            else            await recheckAppDetail(appid)
            game = await rebuildOne(appid) ?? game
        } else if (needsStore) {
            provisionGame(appid, game.name).then(() => rebuildOne(appid)).catch(() => {})
        } else if (needsAbout) {
            recheckAppDetail(appid).then(() => rebuildOne(appid)).catch(() => {})
        }
    }

    if (!game) return json({ error: 'Game not found' }, 404)

    // Always override playtimeMinutes with the relay-derived total.
    // The relay is the single source of truth: baseline captures pre-relay
    // history, sessions track every play since. Steam's value is never used.
    const effective = getEffectivePlaytimeMin(game.appid)
    return json({ ...game, playtimeMinutes: effective })
})
