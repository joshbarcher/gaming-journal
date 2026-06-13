import { json } from '@sveltejs/kit'
import { runTests, getResults } from '$lib/server/services/testRunner.js'

export async function POST() {
    try {
        const results = await runTests()
        return json(results)
    } catch (err) {
        const status = (err as Error).message === 'Tests already running' ? 409 : 500
        return json({ error: (err as Error).message }, { status })
    }
}

export function GET() {
    const results = getResults()
    if (!results) return json({ error: 'No results yet — run tests first' }, { status: 404 })
    return json(results)
}
