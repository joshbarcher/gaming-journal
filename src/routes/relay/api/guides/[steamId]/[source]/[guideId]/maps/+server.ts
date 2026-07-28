// GET  /relay/api/guides/:steamId/:source/:guideId/maps         — what's on disk
// GET  /relay/api/guides/:steamId/:source/:guideId/maps?probe=1 — also look for maps that exist
// POST /relay/api/guides/:steamId/:source/:guideId/maps         — queue a map download
//
// Discovery is deliberately opt-in via ?probe=1, and works differently per source:
//
//   ign   — the wiki slug IS the map slug, so a single request to ign.com answers it.
//   game8 — maps hang off a specific article whose id is not derivable from the
//           guide id. Rather than crawl Game8 looking for one, this scans the
//           guide ALREADY on disk for pages that look like map articles. That is
//           local, instant and costs no request; the user confirms or overrides
//           with an explicit URL.
//
// A map is queued as its own job and never blocks guide availability.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { featureDir } from '$lib/server/relay/shared/data-root.js'
import { enqueueJob } from '$lib/server/relay/guides/job-queue.js'
import { discoverMaps } from '$lib/server/relay/guides/ign/map-fetcher.js'
import { defaults } from '$lib/server/relay/guides/config.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

function guideDir(steamId: string, source: string, guideId: string): string {
    return join(featureDir('guides'), steamId, source, guideId)
}

async function downloadedMaps(steamId: string, source: string, guideId: string): Promise<any[]> {
    try {
        return JSON.parse(await readFile(join(guideDir(steamId, source, guideId), '_maps', '_index.json'), 'utf8'))
    } catch {
        return []                       // no maps downloaded — the common case
    }
}

/**
 * Game8 map articles, found by scanning the downloaded guide's own manifest.
 *
 * Titles are the only signal available offline, so this matches conservatively
 * on "map"/"maps" as a whole word — enough to surface the right article without
 * dragging in every page that merely mentions one. The user picks from the
 * result, so a false positive costs a click, not a bad download.
 */
async function game8MapCandidates(steamId: string, guideId: string): Promise<any[]> {
    let manifest: any
    try {
        manifest = JSON.parse(await readFile(join(guideDir(steamId, 'game8', guideId), '_raw', '_manifest.json'), 'utf8'))
    } catch {
        return []                       // guide not downloaded, or no manifest
    }
    const pages = Array.isArray(manifest?.pages) ? manifest.pages : []
    return pages
        .filter((p: any) => /\bmaps?\b/i.test(String(p.label ?? p.pageTitle ?? p.slug ?? '')))
        .filter((p: any) => typeof p.url === 'string' && /game8\.co/.test(p.url))
        .slice(0, 25)
        .map((p: any) => ({
            mapName: String(p.label ?? p.pageTitle ?? p.slug),
            url:     p.url,
            slug:    String(p.slug ?? ''),
        }))
}

export const GET = relayRoute('guides', async ({ params, url }) => {
    const { steamId, source, guideId } = params as Record<string, string>
    const downloaded = await downloadedMaps(steamId, source, guideId)

    if (url.searchParams.get('probe') !== '1') {
        return json({ downloaded, available: null })
    }

    try {
        if (source === 'ign') {
            const available = await discoverMaps(guideId, defaults)
            const have = new Set(downloaded.map((m: any) => m.mapSlug))
            return json({
                source, downloaded, available,
                missing: available.filter(m => !have.has(m.mapSlug)),
            })
        }
        if (source === 'game8') {
            // Candidates are article URLs, not map slugs — Game8 splits one article
            // into several area maps, so what is "missing" isn't known until fetched.
            return json({ source, downloaded, candidates: await game8MapCandidates(steamId, guideId) })
        }
        // Any other source has no interactive maps at all.
        return json({ source, downloaded, available: [] })
    } catch (err) {
        // A probe failure must not break the map view — report it and let the
        // client fall back to whatever is already on disk.
        return json({
            source, downloaded, available: null,
            probeError: err instanceof Error ? err.message : String(err),
        })
    }
})

export const POST = relayRoute('guides', async ({ params, request }) => {
    const { steamId, source, guideId } = params as Record<string, string>
    const body = await request.json().catch(() => ({})) as { mapSlug?: string, url?: string, gameName?: string }

    let jobUrl: string
    if (source === 'ign') {
        if (!body.mapSlug) return json({ error: 'mapSlug is required for IGN maps' }, 400)
        jobUrl = `https://www.ign.com/maps/${guideId}/${body.mapSlug}`
    } else if (source === 'game8') {
        // The article URL is the only way in — it carries the id the map hangs off.
        if (!body.url) return json({ error: 'url is required for Game8 maps' }, 400)
        let host = ''
        try { host = new URL(body.url).hostname.replace(/^www\./, '') } catch { /* invalid */ }
        // Refuse anything not on game8.co: this value is handed to a spawned
        // fetcher, so it must not be an arbitrary caller-supplied address.
        if (host !== 'game8.co') return json({ error: 'url must be a game8.co article' }, 400)
        jobUrl = body.url
    } else {
        return json({ error: `${source} guides have no interactive maps` }, 400)
    }

    const job = enqueueJob({
        steamId, source, guideId,
        url: jobUrl,
        gameName: body.gameName ?? '',
        mode: 'map',
    })
    logger.info('[guide-maps] queued map job', { steamId, source, guideId, url: jobUrl })
    return json(job, 202)
})
