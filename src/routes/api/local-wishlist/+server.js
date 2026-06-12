import { json } from '@sveltejs/kit'
import { getAll } from '$lib/server/services/localWishlistService.js'

export async function GET() {
    try {
        return json(await getAll())
    } catch (err) {
        return json({ error: err.message }, { status: 500 })
    }
}
