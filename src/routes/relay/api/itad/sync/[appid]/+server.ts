// POST /relay/api/itad/sync/:appid — synchronous single-game sync.
// (SvelteKit's static-over-param precedence keeps /sync/wishlist out of :appid,
// matching the relay router's registration-order comment.)
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { syncOne } from '$lib/server/relay/itad/itad.service.js'

export const POST = relayRoute('itad', async ({ params, url }) => {
    const appid = Number(params.appid)
    const force = url.searchParams.get('force') === 'true'
    const steamName = url.searchParams.get('name')
    const result = await syncOne(appid, steamName, { force })
    return json(result)
})
