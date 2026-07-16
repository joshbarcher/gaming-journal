// GET /relay/guides-img/<steamId>/<source>/<guideId>/<section>/img/<file> —
// static guide section images straight off the NAS (ports the relay's
// `app.use('/guides-img', express.static(guidesRoot))` mount).
// serveStatic handles Range/206, ETag/304 conditionals, and path traversal.
import { relayRoute } from '$lib/server/relay/shared/route-helpers.js'
import { serveStatic } from '$lib/server/relay/shared/static-files.js'
import { featureDir } from '$lib/server/relay/shared/data-root.js'

export const GET = relayRoute('guides', async ({ request, params }) => {
    const res = await serveStatic(request, featureDir('guides'), params.file ?? '')
    return res ?? new Response('Not found', { status: 404 })
})
