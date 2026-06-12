import { json } from '@sveltejs/kit'
import { getAllLocalReviews } from '$lib/server/services/localReviewsService.js'

export async function GET() {
    try {
        return json(await getAllLocalReviews())
    } catch (err) {
        return json({ error: err.message }, { status: 500 })
    }
}
