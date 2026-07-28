// GET /relay/api/guides/:steamId/:source/:guideId/maps/:mapSlug/prefs
//   — server-persisted marker-layer filters for one interactive map.
// PUT — whole-state replace ({enabled, collapsedGroups}).
//
// Lives with the user's journal data rather than in the map's own directory, so
// re-downloading a map never discards the filters someone set on it.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getMapPrefs, setMapPrefs } from '$lib/server/relay/guides/map-prefs.service.js'

export const GET = relayRoute('guides', async ({ params }) => {
    const { steamId, source, guideId, mapSlug } = params as Record<string, string>
    try {
        return json(await getMapPrefs(steamId, source, guideId, mapSlug))
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error('[guide-map-prefs] get failed', { steamId, source, guideId, mapSlug, err: message })
        return json({ error: message }, 500)
    }
})

export const PUT = relayRoute('guides', async ({ params, request }) => {
    const { steamId, source, guideId, mapSlug } = params as Record<string, string>
    const body = await request.json().catch(() => ({})) ?? {}
    try {
        const saved = await setMapPrefs(steamId, source, guideId, mapSlug, {
            enabled:         body.enabled,
            collapsedGroups: body.collapsedGroups,
        })
        return json(saved)
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error('[guide-map-prefs] put failed', { steamId, source, guideId, mapSlug, err: message })
        // A rejected payload is the caller's fault, not a server fault.
        return json({ error: message }, /enabled must be/.test(message) ? 400 : 500)
    }
})
