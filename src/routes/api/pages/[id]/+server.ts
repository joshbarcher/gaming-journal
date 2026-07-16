import { json } from '@sveltejs/kit'
import { getJournalService } from '$lib/server/services/journalService.js'
import { readJsonObject, badRequest } from '$lib/server/shared/request.js'
import logger from '$lib/server/logger.js'

export function GET({ params }: { params: { id: string } }) {
    const page = getJournalService().getById(params.id)
    if (!page) return json({ error: 'Page not found' }, { status: 404 })
    return json(page)
}

export async function PUT({ params, request }: { params: { id: string }; request: Request }) {
    const updates = await readJsonObject(request)
    if (!updates) return badRequest('Invalid JSON body')
    try {
        const page = await getJournalService().update(params.id, updates)
        if (!page) return json({ error: 'Page not found' }, { status: 404 })
        return json(page)
    } catch (err) {
        logger.error('Failed to update page', err)
        return json({ error: 'Failed to update page' }, { status: 500 })
    }
}

export async function DELETE({ params }: { params: { id: string } }) {
    try {
        const removed = await getJournalService().remove(params.id)
        if (!removed) return json({ error: 'Page not found' }, { status: 404 })
        return new Response(null, { status: 204 })
    } catch (err) {
        logger.error('Failed to delete page', err)
        return json({ error: 'Failed to delete page' }, { status: 500 })
    }
}
