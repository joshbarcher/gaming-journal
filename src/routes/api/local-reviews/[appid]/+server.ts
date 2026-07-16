import { json } from '@sveltejs/kit'
import { getOrSeedLocalReview, setLocalReview, deleteLocalReview } from '$lib/server/services/localReviewsService.js'
import { readJsonObject, badRequest, parseAppid } from '$lib/server/shared/request.js'

export async function GET({ params }: { params: { appid: string } }) {
    const appid = parseAppid(params.appid)
    if (appid === null) return badRequest('invalid appid')  // "abc" must not read the shared NaN bucket
    try {
        const review = await getOrSeedLocalReview(appid)
        if (review === null) return json({ error: 'No review found' }, { status: 404 })
        return json(review)
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}

export async function PUT({ params, request }: { params: { appid: string }; request: Request }) {
    const appid = parseAppid(params.appid)
    if (appid === null) return badRequest('invalid appid')
    // Object bodies only: malformed JSON is a 400 (not a 500), and a string body
    // must not character-spread into a {0:'h',1:'i'} "review".
    const body = await readJsonObject(request)
    if (!body) return badRequest('Invalid JSON body')
    try {
        const review = await setLocalReview(appid, body as never)
        return json(review)
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}

export async function DELETE({ params }: { params: { appid: string } }) {
    const appid = parseAppid(params.appid)
    if (appid === null) return badRequest('invalid appid')
    try {
        await deleteLocalReview(appid)
        return json({ ok: true })
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}
