import { json } from '@sveltejs/kit'
import { getSubreddits, addSubreddit } from '$lib/server/services/redditSubredditsService.js'

export async function GET({ params }) {
    try {
        return json(await getSubreddits(params.appid))
    } catch (err) {
        return json({ error: err.message }, { status: 500 })
    }
}

export async function POST({ params, request }) {
    const { name } = await request.json()
    if (!name || typeof name !== 'string') return json({ error: 'name required' }, { status: 400 })
    try {
        return json(await addSubreddit(params.appid, name.trim()))
    } catch (err) {
        return json({ error: err.message }, { status: 500 })
    }
}
