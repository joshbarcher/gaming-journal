// GET /relay/api/discover/search?q=… — applist search with adult-content
// annotation (ports relay discover.controller handleSearch). applist +
// adult-content services are Wave 3 Batch A ports in the same steam dir.
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { search, isReady } from '$lib/server/relay/steam/applist.service.js'
import { isAdultAppid, isKnown, ensureChecked } from '$lib/server/relay/steam/adult-content.service.js'

// Tags each item with `isAdult` from the content-descriptor cache, and kicks off a
// background check for any appid the crawl/backfill hasn't reached yet.
async function annotateAdult<T extends { appid: number }>(items: T[]): Promise<(T & { isAdult: boolean })[]> {
    return Promise.all(items.map(async item => {
        const isAdult = await isAdultAppid(item.appid)
        if (!(await isKnown(item.appid))) ensureChecked(item.appid)
        return { ...item, isAdult }
    }))
}

export const GET = relayRoute('discover', async ({ url }) => {
    const q = (url.searchParams.get('q') ?? '').trim()
    if (!q) return json({ results: [], total: 0, offset: 0, limit: 40 })
    if (!isReady()) return json({ error: 'App index not ready yet' }, 503)

    const limit  = Math.min(100, parseInt(url.searchParams.get('limit')  ?? '40', 10))
    const offset = Math.max(0,   parseInt(url.searchParams.get('offset') ?? '0',  10))
    const data = search(q, { limit, offset })
    data.results = await annotateAdult(data.results)
    return json(data)
})
