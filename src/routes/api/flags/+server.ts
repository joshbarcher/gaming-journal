import { json } from '@sveltejs/kit'
import { getAllFlags } from '$lib/server/services/flagsService.js'

export async function GET() {
    try {
        return json(await getAllFlags())
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}
