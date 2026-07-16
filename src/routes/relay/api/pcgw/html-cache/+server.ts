// DELETE /relay/api/pcgw/html-cache — drop every cached page snapshot
// (ports relay pcgw.controller handleClearHtmlCache, no-appid variant).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { clearHtmlCache } from '$lib/server/relay/pcgw/pcgw.service.js'

export const DELETE = relayRoute('pcgw', async () => json({ cleared: await clearHtmlCache() }))
