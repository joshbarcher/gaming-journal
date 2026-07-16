import { json } from '@sveltejs/kit'
import { getFranchiseService } from '$lib/server/services/franchiseService.js'
import { readJsonObject, badRequest } from '$lib/server/shared/request.js'

export async function POST({ params, request }: { params: { id: string }; request: Request }) {
    const body = await readJsonObject(request)
    if (!body) return badRequest('Invalid JSON body')
    try {
        const { appid, name } = body as { appid?: unknown; name?: unknown }
        if (!appid || typeof appid !== 'number') {
            return json({ error: 'appid (number) is required' }, { status: 400 })
        }
        if (name != null && typeof name !== 'string') {
            return badRequest('name must be a string')  // a stored number corrupts FranchiseEntry.name
        }
        const f = await getFranchiseService().addEntry(params.id, { appid, name: name ?? undefined })
        if (!f) return json({ error: 'Franchise not found' }, { status: 404 })
        return json(f)
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}
