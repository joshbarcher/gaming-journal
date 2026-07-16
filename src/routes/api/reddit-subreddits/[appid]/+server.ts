import { json } from '@sveltejs/kit'
import { getSubreddits, addSubreddit } from '$lib/server/services/redditSubredditsService.js'
import { readJsonObject, badRequest } from '$lib/server/shared/request.js'

export async function GET({ params }: { params: { appid: string } }) {
    try {
        return json(await getSubreddits(params.appid))
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}

export async function POST({ params, request }: { params: { appid: string }; request: Request }) {
    // readJsonObject (not a bare request.json()) — a malformed body must be a 400
    // Response, not an unhandled rejection out of the handler.
    const body = await readJsonObject(request)
    if (!body) return badRequest('Invalid JSON body')
    const { name } = body
    if (!name || typeof name !== 'string' || !name.trim()) return json({ error: 'name required' }, { status: 400 })
    try {
        return json(await addSubreddit(params.appid, name.trim()))
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}
