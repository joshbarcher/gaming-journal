// GET /relay/api/steam/community-reviews — in-memory summary index (no review
// text). Ports relay community-reviews.controller handleGetIndex.
//
// Fast-boot: boot() loads the persisted sidecar in one read. ensureIndex()
// guards the boot-time race (and dev/tests that hit this before boot()) —
// idempotent and free once loaded.
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getIndex, ensureIndex } from '$lib/server/relay/community-reviews/community-reviews.service.js'

export const GET = relayRoute('community-reviews', async () => {
    await ensureIndex()
    return json(getIndex())
})
