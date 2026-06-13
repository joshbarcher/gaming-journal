import { json } from '@sveltejs/kit'
import { getOrSeedLocalReview, setLocalReview, deleteLocalReview } from '$lib/server/services/localReviewsService.js'

export async function GET({ params }: { params: { appid: string } }) {
    try {
        const review = await getOrSeedLocalReview(Number(params.appid))
        if (review === null) return json({ error: 'No review found' }, { status: 404 })
        return json(review)
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}

export async function PUT({ params, request }: { params: { appid: string }; request: Request }) {
    try {
        const review = await setLocalReview(Number(params.appid), await request.json())
        return json(review)
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}

export async function DELETE({ params }: { params: { appid: string } }) {
    try {
        await deleteLocalReview(Number(params.appid))
        return json({ ok: true })
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}
