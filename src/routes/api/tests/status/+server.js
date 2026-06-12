import { json } from '@sveltejs/kit'
import { isRunning } from '$lib/server/services/testRunner.js'

export function GET() {
    return json({ running: isRunning() })
}
