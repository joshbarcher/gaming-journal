// GET /relay/api/discover/featured[?tab=…&page=…] — featured-history pages
// with image URLs rewritten to relay paths (ports relay discover.controller
// handleFeatured). The response goes out immediately; poster/header caching
// continues in the background, exactly like the relay.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getFeatured } from '$lib/server/relay/steam/discover.service.js'
import { ensureDiscoveryImages } from '$lib/server/relay/steam/images.service.js'
import { markSynced as markPostersSynced, hasPoster, ensureIndexLoaded } from '$lib/server/relay/games/poster-pool.service.js'
import { isAdultAppid, isKnown, ensureChecked } from '$lib/server/relay/steam/adult-content.service.js'

async function annotateAdult(items: Array<{ appid: number }>) {
    return Promise.all(items.map(async item => {
        const isAdult = await isAdultAppid(item.appid)
        if (!(await isKnown(item.appid))) ensureChecked(item.appid)
        return { ...item, isAdult }
    }))
}

function rewriteItems(items: Array<{ appid: number }>) {
    return items.map(item => {
        const header = `/relay/images/steam/games/${item.appid}/header.jpg`
        const poster = hasPoster(item.appid)
            ? `/relay/images/steam/games/${item.appid}/poster.jpg`
            : header
        return { ...item, headerImage: header, posterImage: poster }
    })
}

export const GET = relayRoute('discover', async ({ url }) => {
    const tab  = url.searchParams.get('tab') ?? null
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
    try {
        // Relay boot loads the poster index via the games cache build; until the
        // games feature ports, load it on demand so hasPoster() matches the relay.
        await ensureIndexLoaded()
        const data     = await getFeatured(tab, page)
        const isArray  = Array.isArray(data)
        const sections = isArray ? data : [data]

        // Collect items with their actual CDN URLs before rewriting to relay paths.
        // The real headerImage may be hash-based — pass it so ensureDiscoveryImages
        // tries the known URL first rather than guessing a pattern-based path.
        const seen = new Map()
        for (const s of sections) {
            for (const i of (s.items ?? [])) {
                if (!seen.has(i.appid)) seen.set(i.appid, {
                    appid:     i.appid,
                    headerUrl: i.headerImage,
                    posterUrl: i.posterImage,
                })
            }
        }

        // Respond immediately with relay paths — image caching happens in background.
        const rewritten = await Promise.all(sections.map(async s => ({
            ...s,
            items: rewriteItems(await annotateAdult(s.items ?? [])),
        })))

        ensureDiscoveryImages([...seen.values()])
            .then((withPosters: number[]) => { if (withPosters.length) markPostersSynced(withPosters).catch(() => {}) })
            .catch(() => {})

        return json(isArray ? rewritten : rewritten[0])
    } catch (err) {
        logger.error('[discover] Failed to fetch featured', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: 'Failed to fetch featured categories' }, 502)
    }
})
