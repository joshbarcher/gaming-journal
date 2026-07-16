// GET /relay/api/nexus/:appid/mods — one paginated / sorted / searched page of
// a game's mods (ports relay nexus.controller handleGetModsPage). Query params
// pass through as strings; getModsPage normalises/clamps them itself.
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getModsPage } from '$lib/server/relay/nexus/nexus.service.js'

export const GET = relayRoute('nexus', async ({ params, url }) => {
    const appid = Number(params.appid)
    const q = url.searchParams
    // Match express req.query semantics: absent params are undefined so the
    // service's default parameters apply (searchParams.get returns null).
    const opts: Record<string, string> = {}
    for (const key of ['sort', 'offset', 'limit', 'q', 'adult', 'name']) {
        const v = q.get(key)
        if (v !== null) opts[key] = v
    }
    return json(await getModsPage(appid, opts))
})
