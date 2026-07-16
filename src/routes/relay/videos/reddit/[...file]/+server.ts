// GET /relay/videos/reddit/<...file> — cached Reddit videos off the NAS
// (ports relay server.js's `express.static` mount for /videos/reddit;
// root = reddit/videos). serveStatic answers Range requests with 206 —
// required for <video> seeking.
import path from 'node:path'
import { relayRoute } from '$lib/server/relay/shared/route-helpers.js'
import { serveStatic } from '$lib/server/relay/shared/static-files.js'
import { featureDir } from '$lib/server/relay/shared/data-root.js'

export const GET = relayRoute('reddit', async ({ request, params }) => {
    const res = await serveStatic(request, path.join(featureDir('reddit'), 'videos'), params.file ?? '')
    return res ?? new Response('Not found', { status: 404 })
})
