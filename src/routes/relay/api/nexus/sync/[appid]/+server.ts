// POST /relay/api/nexus/sync/:appid — synchronous single-game sync
// (ports relay nexus.controller handleSyncOne). ?domain=<nexus-domain> stores a
// manual Steam→Nexus override before syncing.
// (SvelteKit's static-over-param precedence keeps /sync/:appid out of the
// /:appid entry route, matching the relay router's registration order.)
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { syncOne as _syncOne } from '$lib/server/relay/nexus/nexus.service.js'

// The service is untyped ported JS; its `domain = null` default infers as `null`,
// so type the surface we actually call.
const syncOne = _syncOne as
    (appid: number, steamName: string | null, opts?: { force?: boolean, domain?: string | null }) => Promise<unknown>

export const POST = relayRoute('nexus', async ({ params, url }) => {
    const appid = Number(params.appid)
    const force = url.searchParams.get('force') === 'true'
    const steamName = url.searchParams.get('name')
    const domain = url.searchParams.get('domain')   // manual Steam→Nexus override
    try {
        const result = await syncOne(appid, steamName, { force, domain })
        return json(result)
    } catch (err) {
        // Relay controller contract: this endpoint answers a generic 500 body
        // (not err.message) so API-key/GraphQL details never leak to the client.
        logger.error('[nexus] Failed to sync single game', { appid, err: err instanceof Error ? err.message : String(err) })
        return json({ error: 'Nexus sync failed' }, 500)
    }
})
