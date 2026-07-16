// DELETE /relay/api/pcgw/html-cache/:appid — drop one game's cached page
// snapshot (ports relay pcgw.controller handleClearHtmlCache, appid variant).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { clearHtmlCache } from '$lib/server/relay/pcgw/pcgw.service.js'

export const DELETE = relayRoute('pcgw', async ({ params }) =>
    json({ cleared: await clearHtmlCache(Number(params.appid)) }))
