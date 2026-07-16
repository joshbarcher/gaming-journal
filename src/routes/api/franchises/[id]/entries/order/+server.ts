import { json } from '@sveltejs/kit'
import { getFranchiseService } from '$lib/server/services/franchiseService.js'
import { readJsonObject, badRequest } from '$lib/server/shared/request.js'

export async function PUT({ params, request }: { params: { id: string }; request: Request }) {
    const body = await readJsonObject(request)
    if (!body) return badRequest('Invalid JSON body')
    try {
        const { appids } = body
        if (!Array.isArray(appids)) return json({ error: 'appids array is required' }, { status: 400 })
        const f = await getFranchiseService().reorderEntries(params.id, appids)
        if (!f) return json({ error: 'Franchise not found' }, { status: 404 })
        return json(f)
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}
