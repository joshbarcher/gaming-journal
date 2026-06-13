import { json } from '@sveltejs/kit'

export function GET() {
    return json({ relayUrl: (process.env.RELAY_URL ?? 'http://localhost:8050').replace(/\/$/, '') })
}
