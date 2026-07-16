// GET /relay/api/pcgw — the PCGW index (ports relay pcgw.controller handleGetAll).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getIndex } from '$lib/server/relay/pcgw/pcgw.service.js'

export const GET = relayRoute('pcgw', async () => json(await getIndex()))
