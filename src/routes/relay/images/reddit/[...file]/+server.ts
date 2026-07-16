// GET /relay/images/reddit/<...file> — cached Reddit media images off the NAS,
// with on-demand WebP sidecar negotiation (ports relay server.js's
// `app.get('/images/reddit/*', serveWithWebp)` mount; root = reddit/images).
// Wrapped in relayRoute so dev instances running RELAY_FORWARD proxy to prod
// instead of writing .webp sidecars to the NAS from the request path.
import path from 'node:path'
import { relayRoute } from '$lib/server/relay/shared/route-helpers.js'
import { serveWithWebp } from '$lib/server/relay/shared/static-files.js'
import { featureDir } from '$lib/server/relay/shared/data-root.js'

export const GET = relayRoute('reddit', async ({ request, params }) => {
    const res = await serveWithWebp(request, path.join(featureDir('reddit'), 'images'), params.file ?? '')
    return res ?? new Response('Not found', { status: 404 })
})
