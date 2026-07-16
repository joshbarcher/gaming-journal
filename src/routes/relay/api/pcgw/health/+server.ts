// GET /relay/api/pcgw/health — parser health report: unknown table rows +
// structural drift flags (ports relay pcgw.controller handleGetHealth).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getHealth } from '$lib/server/relay/pcgw/pcgw.service.js'

export const GET = relayRoute('pcgw', async () => json(await getHealth()))
