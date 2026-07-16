// GET /relay/api/steam/releases — all tracked releases (relay
// handleGetReleases). upcoming.service.js is ported by the Wave-3 Batch-B
// agent in this same tree; see ./upcoming for the boot note.
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getAll as getAllReleases } from '$lib/server/relay/steam/upcoming.service.js'

export const GET = relayRoute('steam', () => json(getAllReleases()))
