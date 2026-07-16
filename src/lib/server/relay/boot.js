// Relay-era boot sequence — the fold-in equivalent of relay server.js's
// app.listen() callback (docs/relay-fold-in.md § Phase 1).
//
// hooks.server.ts calls bootRelay() once at startup and closeRelay() during
// graceful shutdown. Feature bootstraps are added here as each migration wave
// lands: cache builds + startScheduler() calls, mirroring the relay's ordering
// constraints (e.g. play-log before now-playing poller).
//
// SvelteKit loads route modules lazily, so schedulers must be started from
// here — never as an import side effect of a feature service, and never from a
// route module (a scheduler that waits for its route's first request is a bug).

import logger from '../logger.js'
import { closeAll, schedulersEnabled, startScheduler, registerCloser } from './shared/scheduler.js'
import { load as loadMetrics, close as closeMetrics } from './metrics/sync-metrics.service.js'
import { startDiskUsageScheduler, close as closeDiskUsage } from './metrics/disk-usage.service.js'
import { startItadSyncScheduler } from './itad/itad.service.js'
import { startProtonDbScheduler } from './protondb/protondb.service.js'
import { startHltbRetryScheduler } from './hltb/hltb.service.js'
import { build as buildCommunityReviewsCache } from './community-reviews/community-reviews.service.js'
import { closeBrowser as closePcgwBrowser } from './pcgw/pcgw.service.js'

let _booted = false

export async function bootRelay() {
    if (_booted) return
    _booted = true

    // ── Unconditional cache builds (reads depend on these, schedulers or not) ──
    // Relay server.js runs these in its listen callback regardless of any flag.
    // Safe in dev: read-only NAS scans, no writes, no ManagedFile handles.
    buildCommunityReviewsCache().catch(err => logger.error('[relay-boot] Community reviews cache build failed', { err: err?.message }))

    // Unconditional: even a schedulers-off instance can lazily launch Chrome via
    // an on-demand pcgw syncGame — the closer is a no-op if it never launched.
    registerCloser('pcgw-browser', closePcgwBrowser)

    if (!schedulersEnabled()) {
        logger.info('[relay-boot] schedulers disabled (ENABLE_SCHEDULERS != true) — serving reads only')
        // Scheduler-side reads (dashboard endpoints) lazy-load their buckets on
        // demand; skipping the eager metrics load keeps dev instances from
        // holding ManagedFile handles on NAS files the prod writer owns.
        return
    }

    // Metrics first: the schedulers below record runs against it. recordRun()
    // lazily opens its own bucket, so a run landing before this resolves is
    // still captured — load() rebuilds the status index from the same file.
    // (Ordering mirrors relay server.js.)
    await loadMetrics().catch(err => logger.error('[relay-boot] Metrics startup failed', { err: err?.message }))
    registerCloser('metrics', closeMetrics)
    startScheduler('disk-usage', startDiskUsageScheduler)
    registerCloser('disk-usage', closeDiskUsage)

    // ── Feature bootstraps land here per wave ────────────────────────────────
    // Wave 1:
    startScheduler('itad', startItadSyncScheduler)
    startScheduler('protondb', startProtonDbScheduler)
    startScheduler('hltb', startHltbRetryScheduler)
    // Wave 2: (pending)
    // Wave 3: (pending)
    // Wave 4: play-log must load before the now-playing poller + account cache.
}

export async function closeRelay() {
    await closeAll()
}
