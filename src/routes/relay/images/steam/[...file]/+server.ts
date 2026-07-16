// GET /relay/images/steam/<...file> — mirrored Steam CDN images off the NAS
// (ports relay server.js's `express.static` mount for /images/steam;
// root = steam/images — game art, screenshots, achievement icons). Plain
// serveStatic, no WebP negotiation: the relay served these via express.static.
import path from 'node:path'
import { relayRoute } from '$lib/server/relay/shared/route-helpers.js'
import { serveStatic } from '$lib/server/relay/shared/static-files.js'
import { featureDir } from '$lib/server/relay/shared/data-root.js'

export const GET = relayRoute('steam-images', async ({ request, params }) => {
    const res = await serveStatic(request, path.join(featureDir('steam'), 'images'), params.file ?? '')
    return res ?? new Response('Not found', { status: 404 })
})
