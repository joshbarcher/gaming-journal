import { json } from '@sveltejs/kit'
import { getFranchiseService } from '$lib/server/services/franchiseService.js'
import { readJsonObject, badRequest } from '$lib/server/shared/request.js'

export function GET() {
    try {
        return json(getFranchiseService().getAll())
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}

export async function POST({ request }: { request: Request }) {
    const body = await readJsonObject(request)
    if (!body) return badRequest('Invalid JSON body')
    try {
        const { name } = body
        if (!name || typeof name !== 'string' || !name.trim()) {
            return json({ error: 'name is required' }, { status: 400 })
        }
        const f = await getFranchiseService().create({ name: name.trim() })
        return json(f, { status: 201 })
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}
