// GET /relay/api/reddit/validate-subreddit?name=<sub> — checks a subreddit
// exists (ports relay reddit.controller handleValidateSubreddit: a lookup
// failure answers 200 { valid:false, error } — never a 5xx).
// (SvelteKit's static-over-param precedence keeps this out of [appid],
// matching the relay router's registration order.)
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { validateSubreddit } from '$lib/server/relay/reddit/reddit.service.js'

export const GET = relayRoute('reddit', async ({ url }) => {
    const name = url.searchParams.get('name')
    if (!name) return json({ error: 'name query param required' }, 400)
    try {
        const result = await validateSubreddit(name)
        return json(result)
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn('[reddit] Subreddit validation failed', { name, err: message })
        return json({ valid: false, error: message })
    }
})
