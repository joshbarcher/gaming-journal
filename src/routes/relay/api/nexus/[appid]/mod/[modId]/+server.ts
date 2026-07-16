// GET /relay/api/nexus/:appid/mod/:modId — rich single-mod detail
// (fetched live + cached on a miss; ports relay nexus.controller handleGetModDetail).
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getModDetail as _getModDetail } from '$lib/server/relay/nexus/nexus.service.js'

// The service is untyped ported JS; its `name = null` default infers as `null`,
// so type the surface we actually call.
const getModDetail = _getModDetail as
    (appid: number, modId: number, opts?: { force?: boolean, name?: string | null }) => Promise<unknown>

export const GET = relayRoute('nexus', async ({ params, url }) => {
    const appid = Number(params.appid)
    const modId = Number(params.modId)
    const force = url.searchParams.get('force') === 'true'
    const name = url.searchParams.get('name')
    const detail = await getModDetail(appid, modId, { force, name })
    if (!detail) return json({ error: 'Mod not found' }, 404)
    return json(detail)
})
