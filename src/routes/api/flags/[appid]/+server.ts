import { json } from '@sveltejs/kit'
import { getFlags, setFlag } from '$lib/server/services/flagsService.js'

export async function GET({ params }: { params: { appid: string } }) {
    try {
        return json(await getFlags(Number(params.appid)))
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}

export async function PATCH({ params, request }: { params: { appid: string }; request: Request }) {
    try {
        const { flag, value } = await request.json()
        if (typeof flag !== 'string' || typeof value !== 'boolean') {
            return json({ error: 'Body must be { flag: string, value: boolean }' }, { status: 400 })
        }
        const flags = await setFlag(Number(params.appid), flag, value)
        return json(flags)
    } catch (err) {
        const msg = (err as Error).message
        if (msg.startsWith('Unknown flag')) return json({ error: msg }, { status: 400 })
        return json({ error: msg }, { status: 500 })
    }
}
