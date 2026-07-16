// GET /relay/api/hltb — the HLTB index (matched entries only).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getIndex } from '$lib/server/relay/hltb/hltb.service.js'

export const GET = relayRoute('hltb', async () => json(await getIndex()))
