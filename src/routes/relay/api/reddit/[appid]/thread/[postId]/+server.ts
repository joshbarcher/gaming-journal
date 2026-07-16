// GET /relay/api/reddit/:appid/thread/:postId?sub=<subreddit> — fetch-and-cache
// a comment thread (ports relay reddit.controller handleGetThread).
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { fetchAndCacheThread } from '$lib/server/relay/reddit/reddit.service.js'

export const GET = relayRoute('reddit', async ({ params, url }) => {
    const { appid, postId } = params
    const sub = url.searchParams.get('sub')
    if (!sub) return json({ error: 'sub query param required' }, 400)
    try {
        const force  = url.searchParams.get('force') === 'true'
        const result = await fetchAndCacheThread(Number(appid), postId, sub, { force })
        return json(result.thread)
    } catch (err) {
        logger.error('[reddit] Thread fetch failed', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
})
