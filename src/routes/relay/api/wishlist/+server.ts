// GET /relay/api/wishlist — the shaped wishlist cache (Steam + local items,
// prices + flags merged), priority-sorted. Ports relay wishlist.controller
// handleGet.
//
// Cache build: the relay boot-wires build() in server.js's listen callback.
// Until boot.js wires the journal the same way, build lazily here (pure
// reads; idempotent — see ensureBuilt() in wishlist.service.js).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { get, ensureBuilt } from '$lib/server/relay/wishlist/wishlist.service.js'

export const GET = relayRoute('wishlist', async () => {
    await ensureBuilt()
    return json(get())
})
