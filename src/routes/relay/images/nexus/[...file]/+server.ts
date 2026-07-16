// GET /relay/images/nexus/<appid>/<file> — mirrored NexusMods images off the
// NAS, with on-demand WebP sidecar negotiation (ports the relay server.js
// mount: app.get('/images/nexus/*', serveWithWebp(nexusImagesRoot))).
//
// Wrapped in relayRoute so dev instances running RELAY_FORWARD proxy image
// requests upstream instead of writing .webp sidecars to the NAS from the
// request path (docs/relay-fold-in.md §"Static media").
import path from 'node:path'
import { relayRoute } from '$lib/server/relay/shared/route-helpers.js'
import { serveWithWebp } from '$lib/server/relay/shared/static-files.js'
import { featureDir } from '$lib/server/relay/shared/data-root.js'

export const GET = relayRoute('nexus', async ({ request, params }) => {
    const root = path.join(featureDir('nexus'), 'images')
    const res = await serveWithWebp(request, root, params.file ?? '')
    if (res === null) return new Response('Not found', { status: 404 })
    return res
})
