// GET /relay/api/nexus — index of every cached Nexus entry
// (ports relay nexus.controller handleGetIndex).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getIndex } from '$lib/server/relay/nexus/nexus.service.js'

export const GET = relayRoute('nexus', async () => {
    return json(await getIndex())
})
