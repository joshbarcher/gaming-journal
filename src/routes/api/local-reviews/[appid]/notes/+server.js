import { json } from '@sveltejs/kit'
import { addNote } from '$lib/server/services/localReviewsService.js'

export async function POST({ params, request }) {
    try {
        const { text } = await request.json()
        if (!text || typeof text !== 'string' || !text.trim()) {
            return json({ error: 'text is required' }, { status: 400 })
        }
        const note = await addNote(Number(params.appid), text)
        return json(note)
    } catch (err) {
        return json({ error: err.message }, { status: 500 })
    }
}
