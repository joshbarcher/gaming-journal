import { json } from '@sveltejs/kit'
import { getSettings, patchSettings } from '$lib/server/services/settingsService.js'

export async function GET() {
    try {
        return json(await getSettings())
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}

export async function PATCH({ request }: { request: Request }) {
    try {
        return json(await patchSettings(await request.json() ?? {}))
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}
