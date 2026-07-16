// GET /relay/api/player-counts/top?n=100&includeFiltered=false — top-N slice
// of the index. Ports relay player-counts.controller handleGetTop verbatim.
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getIndex, ensureBuilt } from '$lib/server/relay/steam/player-counts.service.js'

export const GET = relayRoute('player-counts', async ({ url }) => {
    await ensureBuilt()
    const n               = Math.min(Number(url.searchParams.get('n')) || 100, 500)
    const includeFiltered = url.searchParams.get('includeFiltered') === 'true'
    const entries = includeFiltered
        ? getIndex()
        : getIndex().filter((e: any) => !e.filtered)
    return json(entries.slice(0, n))
})
