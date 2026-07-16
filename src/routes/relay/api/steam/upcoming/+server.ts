// GET /relay/api/steam/upcoming — in-memory upcoming-releases cache (relay
// handleGetUpcoming). upcoming.service.js is ported by the Wave-3 Batch-B
// agent in this same tree; the relay builds its cache at boot (server.js
// buildUpcomingCache), so boot.js must do the same.
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { get as getUpcoming } from '$lib/server/relay/steam/upcoming.service.js'

export const GET = relayRoute('steam', () => json(getUpcoming()))
