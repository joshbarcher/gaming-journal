// GET /relay/api/news/:appid/:gid — one article, body parsed into ContentBlock[].
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getArticle } from '$lib/server/relay/news/news.service.js'

export const GET = relayRoute('news', async ({ params }) => {
    const appid = Number(params.appid)
    if (!appid) return json({ error: 'invalid appid' }, 400)
    const article = await getArticle(appid, params.gid)
    if (!article) return json({ error: 'Article not found' }, 404)
    return json(article)
})
