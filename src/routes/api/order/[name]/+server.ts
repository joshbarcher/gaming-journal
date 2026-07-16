import { json } from '@sveltejs/kit'
import { isValidOrderName, getOrder, setOrder } from '$lib/server/services/orderService.js'
import { readJson, badRequest } from '$lib/server/shared/request.js'

export async function GET({ params }: { params: { name: string } }) {
    if (!isValidOrderName(params.name)) return json({ error: 'Unknown order' }, { status: 404 })
    try {
        return json(await getOrder(params.name))
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}

export async function PUT({ params, request }: { params: { name: string }; request: Request }) {
    if (!isValidOrderName(params.name)) return json({ error: 'Unknown order' }, { status: 404 })
    const appids = await readJson(request)
    if (appids === undefined) return badRequest('Invalid JSON body')
    if (!Array.isArray(appids) || !appids.every(id => typeof id === 'number')) {
        return json({ error: 'Body must be an array of numbers' }, { status: 400 })
    }
    try {
        await setOrder(params.name, appids)
        return json({ ok: true })
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}
