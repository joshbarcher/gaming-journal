// POST /relay/api/admin/news/:appid/refresh — fire-and-forget news re-fetch
// for one game (ports relay admin.controller handleNewsRefresh).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { fetchAndCache } from '$lib/server/relay/news/news.service.js'

export const POST = relayRoute('admin', ({ params }) => {
    const appid = Number(params.appid)
    if (!appid) return json({ error: 'invalid appid' }, 400)
    fetchAndCache(appid)
        .catch((err: unknown) => logger.error('[admin] News refresh failed', { appid, err: err instanceof Error ? err.message : String(err) }))
    return json({ ok: true })
})
