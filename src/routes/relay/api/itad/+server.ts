// GET /relay/api/itad — the ITAD index (ports relay itad.router GET '/').
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getIndex } from '$lib/server/relay/itad/itad.service.js'

export const GET = relayRoute('itad', async () => json(await getIndex()))
