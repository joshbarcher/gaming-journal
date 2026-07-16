// GET /relay/api/games/posters?source=library|wishlist — pre-built batch of 50
// poster URLs. Returns [{ appid, poster, header }] — only games confirmed to
// have poster.jpg on disk; kicks off async pool replenishment so the next
// request is ready immediately. Ports relay games.controller handleGetPosters.
//
// The pool is filled by poster-pool refresh(), which the games cache build
// wires up (build() → refreshPosterPool) exactly as the relay does. The
// refresh is fire-and-forget inside build(), so the very first request after
// a cold start can see a partially-filled pool — same behavior as the relay
// right after boot. (Parity note: this endpoint returns a RANDOM sample per
// call and is excluded from the diff harness — verify by shape.)
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { ensureBuilt } from '$lib/server/relay/games/games.service.js'
import { getPosterBatch } from '$lib/server/relay/games/poster-pool.service.js'

export const GET = relayRoute('games', async ({ url }) => {
    await ensureBuilt()
    const source = url.searchParams.get('source') === 'wishlist' ? 'wishlist' : 'library'
    return json(getPosterBatch(source))
})
