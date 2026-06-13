import { json } from '@sveltejs/kit'
import { getFranchiseService } from '$lib/server/services/franchiseService.js'

export function GET() {
    try {
        return json(getFranchiseService().getAll())
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}

export async function POST({ request }: { request: Request }) {
    try {
        const { name } = await request.json()
        if (!name || typeof name !== 'string' || !name.trim()) {
            return json({ error: 'name is required' }, { status: 400 })
        }
        const f = await getFranchiseService().create({ name: name.trim() })
        return json(f, { status: 201 })
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}
