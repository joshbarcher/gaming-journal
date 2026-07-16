// POST /relay/api/steam/store/details/sync-tags — patch SteamSpy tags onto
// cached store files, fire-and-forget (ports relay store.controller
// handleSyncTags). No overlap guard in the relay controller — kept verbatim.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { rebuild } from '$lib/server/relay/shared/cache-manager.js'
import { syncTags } from '$lib/server/relay/steam/store.service.js'

export const POST = relayRoute('steam-store', ({ url }) => {
    const force = url.searchParams.get('force') === 'true'
    syncTags({ force, onProgress: (done: number, total: number, file?: string, status?: string) => {
        logger.info(`[steam-store] Tag sync [${done}/${total}] ${status} — ${file}`)
    }})
        .then(async (result) => {
            await rebuild('games')
            logger.info('[steam-store] Tag sync finished', result)
        })
        .catch((err: unknown) => logger.error('Failed to sync tags', { err: err instanceof Error ? err.message : String(err) }))

    return json({ message: 'Tag sync started' })
})
