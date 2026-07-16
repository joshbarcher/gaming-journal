import { json } from '@sveltejs/kit'
import { addNote } from '$lib/server/services/localReviewsService.js'
import { readJsonObject, badRequest, parseAppid } from '$lib/server/shared/request.js'

export async function POST({ params, request }: { params: { appid: string }; request: Request }) {
    const appid = parseAppid(params.appid)
    if (appid === null) return badRequest('invalid appid')
    const body = await readJsonObject(request)
    if (!body) return badRequest('Invalid JSON body')  // malformed / null body is the client's error, not a 500
    try {
        const { text } = body
        if (!text || typeof text !== 'string' || !text.trim()) {
            return json({ error: 'text is required' }, { status: 400 })
        }
        const note = await addNote(appid, text)
        return json(note)
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}
