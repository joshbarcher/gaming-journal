import { json } from '@sveltejs/kit'
import { getJournalService } from '$lib/server/services/journalService.js'
import { readJsonObject, badRequest } from '$lib/server/shared/request.js'
import logger from '$lib/server/logger.js'

export async function PUT({ request }: { request: Request }) {
    const body = await readJsonObject(request)
    if (!body) return badRequest('Invalid JSON body')
    const { ids } = body
    if (!Array.isArray(ids)) return json({ error: 'ids array required' }, { status: 400 })
    try {
        await getJournalService().reorder(ids)
        return json({ ok: true })
    } catch (err) {
        logger.error('Failed to reorder pages', err)
        return json({ error: 'Failed to reorder pages' }, { status: 500 })
    }
}
