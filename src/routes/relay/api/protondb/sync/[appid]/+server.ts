// POST /relay/api/protondb/sync/:appid — synchronous single-game sync.
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { syncOne } from '$lib/server/relay/protondb/protondb.service.js'

export const POST = relayRoute('protondb', async ({ params, url }) => {
    const appid = Number(params.appid)
    const force = url.searchParams.get('force') === 'true'
    return json(await syncOne(appid, { force }))
})
