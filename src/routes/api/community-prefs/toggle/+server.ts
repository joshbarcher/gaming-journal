import { json } from '@sveltejs/kit'
import { togglePref } from '$lib/server/services/communityPrefsService.js'
import { readJsonObject, badRequest } from '$lib/server/shared/request.js'

export async function POST({ request }: { request: Request }) {
    const body = await readJsonObject(request)
    if (!body) return badRequest('Invalid JSON body')
    try {
        const { type, username, appid } = body as { type?: unknown; username?: unknown; appid?: unknown }
        if (!type || !username)
            return json({ error: 'type and username are required' }, { status: 400 })
        if (typeof username !== 'string' && typeof username !== 'number')
            return badRequest('username must be a string')  // objects would collide as "[object Object]"
        if (typeof type !== 'string' || !['filter', 'mute', 'favorite', 'highlight'].includes(type))
            return json({ error: 'invalid type' }, { status: 400 })
        if (type === 'highlight' && !appid)
            return json({ error: 'appid is required for highlight' }, { status: 400 })
        const active = await togglePref(type as never, String(username), appid ? String(appid) : null)
        return json({ active })
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}
