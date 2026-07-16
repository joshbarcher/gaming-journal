// POST /relay/api/steam/playtime/sessions/derive — re-derive sessions from the
// stored snapshot history. Ports relay sessions.controller handleDeriveSessions.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { deriveSessions } from '$lib/server/relay/steam/sessions.service.js'

export const POST = relayRoute('sessions', async () => {
    try {
        const result = await deriveSessions()
        const gameCount    = Object.keys(result).length
        const sessionCount = Object.values(result).reduce((n: number, g: any) => n + g.sessions.length, 0)
        return json({ games: gameCount, sessions: sessionCount })
    } catch (err) {
        logger.error('Failed to derive sessions', { err: err instanceof Error ? err.message : String(err) })
        return json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
})
