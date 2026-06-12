import { json } from '@sveltejs/kit'
import { getPrefs } from '$lib/server/services/communityPrefsService.js'

export async function GET() {
    try {
        return json(await getPrefs())
    } catch (err) {
        return json({ error: err.message }, { status: 500 })
    }
}
