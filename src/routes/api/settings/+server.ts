import { json } from '@sveltejs/kit'
import { getSettings, patchSettings } from '$lib/server/services/settingsService.js'
import { readJsonObject, badRequest } from '$lib/server/shared/request.js'

export async function GET() {
    try {
        return json(await getSettings())
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}

export async function PATCH({ request }: { request: Request }) {
    const patch = await readJsonObject(request)
    if (!patch) return badRequest('Invalid JSON body')
    try {
        return json(await patchSettings(patch))
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}
