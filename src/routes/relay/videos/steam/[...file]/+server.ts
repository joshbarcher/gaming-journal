// GET /relay/videos/steam/<...file> — downloaded Steam trailers off the NAS
// (ports relay server.js's `express.static` mount for /videos/steam;
// root = steam/videos). serveStatic answers Range requests with 206 —
// required for <video> seeking.
import path from 'node:path'
import { relayRoute } from '$lib/server/relay/shared/route-helpers.js'
import { serveStatic } from '$lib/server/relay/shared/static-files.js'
import { featureDir } from '$lib/server/relay/shared/data-root.js'

export const GET = relayRoute('steam-videos', async ({ request, params }) => {
    const res = await serveStatic(request, path.join(featureDir('steam'), 'videos'), params.file ?? '')
    return res ?? new Response('Not found', { status: 404 })
})
