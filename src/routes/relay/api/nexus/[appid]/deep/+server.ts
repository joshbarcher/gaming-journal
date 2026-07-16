// /relay/api/nexus/:appid/deep — full-catalogue crawl for a game's mods.
//   POST — start (or refresh) the background deep pull (ports handleStartDeep)
//   GET  — poll the crawled dataset + progress (ports handleGetDeep)
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { startDeepPull as _startDeepPull, getDeep } from '$lib/server/relay/nexus/nexus.service.js'

// The service is untyped ported JS; its `name = null` default infers as `null`,
// so type the surface we actually call.
const startDeepPull = _startDeepPull as
    (appid: number, opts?: { force?: boolean, name?: string | null }) => Promise<unknown>

export const POST = relayRoute('nexus', async ({ params, url }) => {
    const appid = Number(params.appid)
    const force = url.searchParams.get('force') === 'true'
    const name = url.searchParams.get('name')
    return json(await startDeepPull(appid, { force, name }))
})

export const GET = relayRoute('nexus', async ({ params }) => {
    const appid = Number(params.appid)
    const data = await getDeep(appid)
    return json(data ?? { appid, status: 'idle', mods: [], pulled: 0, total: 0, capped: false })
})
