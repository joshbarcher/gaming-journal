// GET /relay/api/steam/community-reviews/:appid — one game's full cached entry
// (summary + up to 100 reviews). Ports relay handleGetEntry: 404 when not
// cached. getEntry reads the file directly (no in-memory cache dependency);
// its readJson swallows I/O errors as null, so the relay's 500 branch is
// unreachable — relayRoute's generic 500 covers anything else.
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getEntry } from '$lib/server/relay/community-reviews/community-reviews.service.js'

export const GET = relayRoute('community-reviews', async ({ params }) => {
    const entry = await getEntry(params.appid)
    if (!entry) return json({ error: 'Community reviews not cached' }, 404)
    return json(entry)
})
