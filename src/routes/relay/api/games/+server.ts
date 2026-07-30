// GET /relay/api/games — the merged games cache (library + wishlist + local),
// every entry overlaid with the relay-derived playtime. Ports relay
// games.controller handleGetAll verbatim.
//
// play-log + cache build: the relay boot-wires both in server.js's listen
// callback. Until boot.js wires the journal the same way, load/build lazily
// here — both are idempotent, so after the first request every read is
// in-memory (see ensureBuilt() in games.service.js).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getAll, getAllList, ensureBuilt } from '$lib/server/relay/games/games.service.js'
import { load as loadPlayLog, getEffectivePlaytimeMin } from '$lib/server/relay/steam/play-log.service.js'

export const GET = relayRoute('games', async ({ url }) => {
    await Promise.all([ensureBuilt(), loadPlayLog()])

    // List projection by default. Whole entries carry a nested `store` blob that only
    // the per-game route reads, and shipping it made this response 13.7 MB — sent to
    // the browser on every franchise page and to a phone on the native franchise
    // screen. Both consumers need ownership/wishlist partitioning and screenshots
    // only; contracts/relayGames.ts documents exactly that, and Zod strips unknown
    // keys, so the slim shape satisfies it. ?full=1 restores whole entries.
    const source = url.searchParams.get('full') === '1' ? getAll() : getAllList()

    // Inject relay-derived playtime for every game that has sessions.
    // The entries carry Steam's playtime_forever via playtimeMinutes; the relay
    // commits sessions immediately so it's always more current after a session ends.
    return json(source.map((g: any) => ({ ...g, playtimeMinutes: getEffectivePlaytimeMin(g.appid) })))
})
