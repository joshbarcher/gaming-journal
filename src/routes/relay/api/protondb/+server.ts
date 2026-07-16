// GET /relay/api/protondb — the ProtonDB index.
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getIndex } from '$lib/server/relay/protondb/protondb.service.js'

export const GET = relayRoute('protondb', async () => json(await getIndex()))
