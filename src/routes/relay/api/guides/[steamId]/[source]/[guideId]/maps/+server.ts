// GET  /relay/api/guides/:steamId/:source/:guideId/maps         — what's on disk
// GET  /relay/api/guides/:steamId/:source/:guideId/maps?probe=1 — also ask IGN what exists
// POST /relay/api/guides/:steamId/:source/:guideId/maps         — queue a map download
//
// Discovery is deliberately opt-in via ?probe=1: it costs one request to ign.com,
// so the guide viewer's normal load reads only local state. A map is ~280mb of
// tiles, so nothing is ever fetched without an explicit POST.
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { featureDir } from '$lib/server/relay/shared/data-root.js'
import { enqueueJob } from '$lib/server/relay/guides/job-queue.js'
import { discoverMaps } from '$lib/server/relay/guides/ign/map-fetcher.js'
import { defaults } from '$lib/server/relay/guides/config.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

function mapsRoot(steamId: string, source: string, guideId: string): string {
    return join(featureDir('guides'), steamId, source, guideId, '_maps')
}

async function downloadedMaps(steamId: string, source: string, guideId: string): Promise<any[]> {
    try {
        return JSON.parse(await readFile(join(mapsRoot(steamId, source, guideId), '_index.json'), 'utf8'))
    } catch {
        return []                       // no maps downloaded — the common case
    }
}

export const GET = relayRoute('guides', async ({ params, url }) => {
    const { steamId, source, guideId } = params as Record<string, string>
    const downloaded = await downloadedMaps(steamId, source, guideId)

    // Only IGN guides have maps, and only their slug maps onto /maps/{slug}.
    if (url.searchParams.get('probe') !== '1' || source !== 'ign') {
        return json({ downloaded, available: null })
    }

    try {
        const available = await discoverMaps(guideId, defaults)
        const have = new Set(downloaded.map((m: any) => m.mapSlug))
        return json({
            downloaded,
            available,
            missing: available.filter(m => !have.has(m.mapSlug)),
        })
    } catch (err) {
        // A probe failure must not break the guide page — report it and let the
        // client fall back to whatever is already on disk.
        return json({
            downloaded,
            available: null,
            probeError: err instanceof Error ? err.message : String(err),
        })
    }
})

export const POST = relayRoute('guides', async ({ params, request }) => {
    const { steamId, source, guideId } = params as Record<string, string>
    if (source !== 'ign') return json({ error: 'Only IGN guides have interactive maps' }, 400)

    const body = await request.json().catch(() => ({})) as { mapSlug?: string, gameName?: string }
    const mapSlug = body.mapSlug
    if (!mapSlug) return json({ error: 'mapSlug is required' }, 400)

    const job = enqueueJob({
        steamId,
        source,
        guideId,
        url: `https://www.ign.com/maps/${guideId}/${mapSlug}`,
        gameName: body.gameName ?? '',
        mode: 'map',
    })
    return json(job, 202)
})
