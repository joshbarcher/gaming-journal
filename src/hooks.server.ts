import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import logger from '$lib/server/logger.js'
import { getJournalService } from '$lib/server/services/journalService.js'
import { getFranchiseService } from '$lib/server/services/franchiseService.js'
import { cleanupOwned } from '$lib/server/services/localWishlistService.js'

logger.startup({ name: 'gaming-journal', version: '1.0.0' })

await getJournalService().load()
await getFranchiseService().load()
logger.info('Journal data loaded')

interface GamesFile {
    games?: { appid: number }[]
}

readFile(join(process.env.DATA_DIR!, 'relay', 'steam', 'games.json'), 'utf8')
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
