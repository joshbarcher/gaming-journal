import { json } from '@sveltejs/kit'
import { updateNote, deleteNote } from '$lib/server/services/localReviewsService.js'

export async function PATCH({ params, request }) {
    try {
        const { pinned } = await request.json()
        const note = await updateNote(Number(params.appid), params.noteId, { pinned: Boolean(pinned) })
        if (!note) return json({ error: 'Note not found' }, { status: 404 })
        return json(note)
    } catch (err) {
        return json({ error: err.message }, { status: 500 })
    }
}

export async function DELETE({ params }) {
    try {
        await deleteNote(Number(params.appid), params.noteId)
        return json({ ok: true })
    } catch (err) {
        return json({ error: err.message }, { status: 500 })
    }
}
