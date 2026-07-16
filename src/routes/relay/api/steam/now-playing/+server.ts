// GET /relay/api/steam/now-playing — the live session (ports relay
// steam.controller handleGetNowPlaying). Wave 4: the last route to shadow the
// catch-all; served by the debounced poller (see now-playing.service.js).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { get } from '$lib/server/relay/steam/now-playing.service.js'

export const GET = relayRoute('now-playing', () => json(get()))
