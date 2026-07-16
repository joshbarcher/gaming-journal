// GET /relay/api/steam/community-reviews — in-memory summary index (no review
// text). Ports relay community-reviews.controller handleGetIndex.
//
// Serves whatever build() has populated: the relay builds this cache
// unconditionally at boot (server.js listen callback), so boot.js must call
// build() the same way — until then this returns [].
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getIndex } from '$lib/server/relay/community-reviews/community-reviews.service.js'

export const GET = relayRoute('community-reviews', () => json(getIndex()))
