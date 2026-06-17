import { json } from '@sveltejs/kit'
import { getJournalNotes, setJournalNotes } from '$lib/server/services/journalNotesService.js'

export async function GET({ params }: { params: { appid: string } }) {
    try {
        const notes = await getJournalNotes(params.appid)
        return json(notes)
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}

export async function PUT({ params, request }: { params: { appid: string }; request: Request }) {
    try {
        const notes = await setJournalNotes(params.appid, await request.json())
        return json(notes)
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}
