import { json } from '@sveltejs/kit'
import { getJournalService, VALID_TYPES } from '$lib/server/services/journalService.js'
import logger from '$lib/server/logger.js'

export function GET({ url }: { url: URL }) {
    const appid = url.searchParams.get('appid')
    let pages = getJournalService().getAll()
    if (appid) pages = pages.filter(p => p.appid === String(appid))
    return json(pages)
}

export async function POST({ request }: { request: Request }) {
    const { type, title, ...rest } = await request.json() ?? {}
    if (!type || !title) return json({ error: 'type and title are required' }, { status: 400 })
    if (!VALID_TYPES.includes(type)) {
        return json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` }, { status: 400 })
    }
    try {
        const page = await getJournalService().create({ type, title, ...rest })
        return json(page, { status: 201 })
    } catch (err) {
        logger.error('Failed to create page', err)
        return json({ error: 'Failed to create page' }, { status: 500 })
    }
}
