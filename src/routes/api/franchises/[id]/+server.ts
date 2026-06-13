import { json } from '@sveltejs/kit'
import { getFranchiseService } from '$lib/server/services/franchiseService.js'

export function GET({ params }: { params: { id: string } }) {
    try {
        const f = getFranchiseService().getById(params.id)
        if (!f) return json({ error: 'Franchise not found' }, { status: 404 })
        return json(f)
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}

export async function PUT({ params, request }: { params: { id: string }; request: Request }) {
    try {
        const { name } = await request.json()
        if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
            return json({ error: 'name must be a non-empty string' }, { status: 400 })
        }
        const updates: { name?: string } = {}
        if (name) updates.name = name.trim()
        const f = await getFranchiseService().update(params.id, updates)
        if (!f) return json({ error: 'Franchise not found' }, { status: 404 })
        return json(f)
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}

export async function DELETE({ params }: { params: { id: string } }) {
    try {
        const ok = await getFranchiseService().remove(params.id)
        if (!ok) return json({ error: 'Franchise not found' }, { status: 404 })
        return new Response(null, { status: 204 })
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}
