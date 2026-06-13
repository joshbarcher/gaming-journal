import { json } from '@sveltejs/kit'
import { getAlerts } from '$lib/server/services/alertsService.js'

export async function GET() {
    try {
        return json(await getAlerts())
    } catch (err) {
        return json({ error: (err as Error).message }, { status: 500 })
    }
}
