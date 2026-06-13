import { json } from '@sveltejs/kit'
import { getFranchiseService } from '$lib/server/services/franchiseService.js'

export async function POST({ params, request }: { params: { id: string }; request: Request }) {
    try {
        const { appid, name } = await request.json()
        if (!appid || typeof appid !== 'number') {
            return json({ error: 'appid (number) is required' }, { status: 400 })
        }
        const f = await getFranchiseService().addEntry(params.id, { appid, name })
        if (!f) return json({ error: 'Franchise not found' }, { status: 404 })
        return json(f)
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}
