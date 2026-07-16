import { json } from '@sveltejs/kit'
import { updateNote, deleteNote } from '$lib/server/services/localReviewsService.js'
import { readJsonObject, badRequest, parseAppid } from '$lib/server/shared/request.js'

export async function PATCH({ params, request }: { params: { appid: string; noteId: string }; request: Request }) {
    const appid = parseAppid(params.appid)
    if (appid === null) return badRequest('invalid appid')
    const body = await readJsonObject(request)
    if (!body) return badRequest('Invalid JSON body')  // malformed / null body is the client's error, not a 500
    try {
        const { pinned } = body
        const note = await updateNote(appid, params.noteId, { pinned: Boolean(pinned) })
        if (!note) return json({ error: 'Note not found' }, { status: 404 })
        return json(note)
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}

export async function DELETE({ params }: { params: { appid: string; noteId: string } }) {
    const appid = parseAppid(params.appid)
    if (appid === null) return badRequest('invalid appid')
    try {
        await deleteNote(appid, params.noteId)
        return json({ ok: true })
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}
