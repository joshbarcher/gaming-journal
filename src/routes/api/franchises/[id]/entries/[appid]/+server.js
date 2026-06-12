import { json } from '@sveltejs/kit'
import { getFranchiseService } from '$lib/server/services/franchiseService.js'

export async function DELETE({ params }) {
    try {
        const appid = Number(params.appid)
        if (!appid) return json({ error: 'Invalid appid' }, { status: 400 })
        const f = await getFranchiseService().removeEntry(params.id, appid)
        if (!f) return json({ error: 'Franchise not found' }, { status: 404 })
        return json(f)
    } catch (err) {
        return json({ error: err.message }, { status: 500 })
    }
}
