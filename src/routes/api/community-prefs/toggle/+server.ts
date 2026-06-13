import { json } from '@sveltejs/kit'
import { togglePref } from '$lib/server/services/communityPrefsService.js'

export async function POST({ request }: { request: Request }) {
    try {
        const { type, username, appid } = await request.json() ?? {}
        if (!type || !username)
            return json({ error: 'type and username are required' }, { status: 400 })
        if (!['filter', 'mute', 'favorite', 'highlight'].includes(type))
            return json({ error: 'invalid type' }, { status: 400 })
        if (type === 'highlight' && !appid)
            return json({ error: 'appid is required for highlight' }, { status: 400 })
        const active = await togglePref(type, String(username), appid ? String(appid) : null)
        return json({ active })
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}
