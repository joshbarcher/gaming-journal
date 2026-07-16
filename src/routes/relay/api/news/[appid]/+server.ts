// GET /relay/api/news/:appid — cached Steam news list for a game.
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { getNews } from '$lib/server/relay/news/news.service.js'

export const GET = relayRoute('news', async ({ params }) => {
    const appid = Number(params.appid)
    if (!appid) return json({ error: 'invalid appid' }, 400)
    const data = await getNews(appid)
    return json(data ?? { appid, items: [] })
})
