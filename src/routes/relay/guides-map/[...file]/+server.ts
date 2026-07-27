// GET /relay/guides-map/<steamId>/<source>/<guideId>/_maps/... — static assets for
// a downloaded IGN interactive map: _index.json, <mapSlug>/map.json, sprite.png and
// the tile pyramid at <mapSlug>/tiles/<z>/<x>/<y>.jpg.
//
// Shares the guides root with /relay/guides-img rather than introducing a second
// storage tree — a map lives inside the guide it belongs to. It gets its own mount
// so map traffic is separable in logs and so the viewer's URL building has one
// obvious base, but serveStatic does the same work: Range/206, ETag/304 and
// traversal refusal.
//
// Tiles are immutable once written (Map Genie versions its tileset paths, so a
// changed map is a new URL), which is exactly the cache posture serveStatic
// already applies to guide media.
import { relayRoute } from '$lib/server/relay/shared/route-helpers.js'
import { serveStatic } from '$lib/server/relay/shared/static-files.js'
import { featureDir } from '$lib/server/relay/shared/data-root.js'

export const GET = relayRoute('guides', async ({ request, params }) => {
    const res = await serveStatic(request, featureDir('guides'), params.file ?? '')
    return res ?? new Response('Not found', { status: 404 })
})
