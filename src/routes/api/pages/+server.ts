import { json } from '@sveltejs/kit'
import { randomUUID } from 'node:crypto'
import { getJournalService, VALID_TYPES } from '$lib/server/services/journalService.js'
import { readJsonObject, badRequest } from '$lib/server/shared/request.js'
import logger from '$lib/server/logger.js'

export function GET({ url }: { url: URL }) {
    const appid = url.searchParams.get('appid')
    let pages = getJournalService().getAll()
    // String() both sides — pages created with a numeric appid must stay findable.
    if (appid) pages = pages.filter(p => String(p.appid) === String(appid))
    return json(pages)
}

export async function POST({ request }: { request: Request }) {
    const body = await readJsonObject(request)
    if (!body) return badRequest('Invalid JSON body')
    const { type, title, ...rest } = body as { type?: string; title?: unknown } & Record<string, unknown>
    if (!type || !title) return json({ error: 'type and title are required' }, { status: 400 })
    if (typeof title !== 'string') return badRequest('title must be a string')
    if (!VALID_TYPES.includes(type as never)) {
        return json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` }, { status: 400 })
    }
    if (type === 'progress') {
        if (rest.tasks !== undefined && !Array.isArray(rest.tasks)) {
            return badRequest('tasks must be an array')  // a raw value would override typeDefaults and corrupt the page
        }
        if (Array.isArray(rest.tasks)) {
            rest.tasks = rest.tasks.map((t: any) => t.id ? t : { ...t, id: randomUUID(), state: t.state ?? null })
        }
    }
    try {
        const page = await getJournalService().create({ type: type as never, title, ...rest })
        return json(page, { status: 201 })
    } catch (err) {
        logger.error('Failed to create page', err)
        return json({ error: 'Failed to create page' }, { status: 500 })
    }
}
