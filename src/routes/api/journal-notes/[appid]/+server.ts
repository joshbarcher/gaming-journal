import { json } from '@sveltejs/kit'
import { getJournalNotes, setJournalNotes } from '$lib/server/services/journalNotesService.js'
import { readJson, badRequest } from '$lib/server/shared/request.js'

export async function GET({ params }: { params: { appid: string } }) {
    try {
        const notes = await getJournalNotes(params.appid)
        return json(notes)
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}

export async function PUT({ params, request }: { params: { appid: string }; request: Request }) {
    // Shape-validate before persisting: a stored non-array would be served back by
    // every future GET and crash the client's notes.map().
    const body = await readJson(request)
    if (!Array.isArray(body)) return badRequest('Body must be an array of notes')
    try {
        const notes = await setJournalNotes(params.appid, body)
        return json(notes)
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}
