import { json } from '@sveltejs/kit'
import { getFlags, setFlag } from '$lib/server/services/flagsService.js'
import { readJsonObject, badRequest, parseAppid } from '$lib/server/shared/request.js'

export async function GET({ params }: { params: { appid: string } }) {
    const appid = parseAppid(params.appid)
    if (appid === null) return badRequest('invalid appid')  // "abc" must not read the shared NaN bucket
    try {
        return json(await getFlags(appid))
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}

export async function PATCH({ params, request }: { params: { appid: string }; request: Request }) {
    const appid = parseAppid(params.appid)
    if (appid === null) return badRequest('invalid appid')  // all invalid appids once collapsed into "NaN"
    const body = await readJsonObject(request)
    if (!body) return badRequest('Invalid JSON body')
    try {
        const { flag, value } = body
        if (typeof flag !== 'string' || typeof value !== 'boolean') {
            return json({ error: 'Body must be { flag: string, value: boolean }' }, { status: 400 })
        }
        const flags = await setFlag(appid, flag, value)
        return json(flags)
    } catch (err) {
        const msg = (err as Error).message
        if (msg.startsWith('Unknown flag')) return json({ error: msg }, { status: 400 })
        return json({ error: msg }, { status: 500 })
    }
}
