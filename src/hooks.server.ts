import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import logger from '$lib/server/logger.js'
import { getJournalService } from '$lib/server/services/journalService.js'
import { getFranchiseService } from '$lib/server/services/franchiseService.js'
import { cleanupOwned } from '$lib/server/services/localWishlistService.js'
import { bootRelay, closeRelay } from '$lib/server/relay/boot.js'
import { featureDir } from '$lib/server/relay/shared/data-root.js'
import { installActivityTracker, recordRequest } from '../activity.js'

logger.startup({ name: 'gaming-journal', version: '1.0.0' })

// Fleet activity reporting (see activity.js + /activity route). Passive: no
// nasDir → no filesystem scanning. Local JSON writes are counted in-process at
// the ManagedFile choke point; mod downloads are proxied to relay-server (see
// routes/relay/[...path]) so they register as network traffic here and as NAS
// writes over there. This just tallies alongside work that already happens.
installActivityTracker({ name: 'gaming-journal', root: process.cwd() })

// Count every request except /activity* (so the endpoint + dashboard polling it
// don't inflate their own numbers). One in-memory increment per request.
export async function handle({ event, resolve }: { event: import('@sveltejs/kit').RequestEvent; resolve: (event: import('@sveltejs/kit').RequestEvent) => Promise<Response> }): Promise<Response> {
    const res = await resolve(event)
    if (!event.url.pathname.startsWith('/activity')) recordRequest(event.request, res)
    return res
}

await getJournalService().load()
await getFranchiseService().load()
logger.info('Journal data loaded')

// Relay fold-in (docs/relay-fold-in.md): start ported feature services +
// schedulers. No-ops per feature until migration waves land; schedulers only
// run when ENABLE_SCHEDULERS=true (prod env layer).
await bootRelay()

interface GamesFile {
    games?: { appid: number }[]
}

// featureDir() honors RELAY_DATA_ROOT — after the data relocation this reads
// the live tree, not the frozen old $DATA_DIR/relay one.
readFile(join(featureDir('steam'), 'games.json'), 'utf8')
    .then(raw => (JSON.parse(raw) as GamesFile).games ?? [])
    .then(games => cleanupOwned(games.map(g => g.appid)))
    .catch(() => { /* relay games not synced yet — skip */ })

let _shuttingDown = false

async function shutdown(reason: string, exitCode = 0): Promise<void> {
    if (_shuttingDown) return
    _shuttingDown = true
    logger.info(`Shutting down (${reason})`)
    const timer = setTimeout(() => {
        logger.warn('Shutdown timed out — forcing exit')
        process.exit(exitCode)
    }, 5000).unref()
    try {
        await getJournalService().close()
        await getFranchiseService().close()
        // Relay fold-in: close feature resources (Puppeteer browsers, ManagedFile
        // buffers, metrics) registered via registerCloser().
        await closeRelay()
    } catch (err) {
        logger.error('Flush failed during shutdown', { err })
    }
    clearTimeout(timer)
    process.exit(exitCode)
}

process.on('SIGTERM',            () => shutdown('SIGTERM'))
process.on('SIGINT',             () => shutdown('SIGINT'))
process.on('SIGHUP',             () => shutdown('SIGHUP'))
process.on('beforeExit',         () => shutdown('beforeExit'))
process.on('uncaughtException',  (err: Error)    => { logger.error('Uncaught exception', { err }); shutdown('uncaughtException', 1) })
process.on('unhandledRejection', (reason: unknown) => { logger.error('Unhandled rejection', { reason }); shutdown('unhandledRejection', 1) })
