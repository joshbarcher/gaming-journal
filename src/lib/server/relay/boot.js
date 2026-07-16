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
import { startBrowser as startRedditBrowser, closeBrowser as closeRedditBrowser, startRedditSyncScheduler } from './reddit/reddit.service.js'
import { startup as startPin } from './pin/pin.service.js'
import { startNexusSyncScheduler } from './nexus/nexus.service.js'
import { startPoller as startFeaturedPoller } from './steam/featured-poller.js'
import { build as buildUpcomingCache } from './steam/upcoming.service.js'
import { loadAchievementsCache } from './steam/steam.service.js'
import { buildApplist } from './steam/applist.service.js'
import { backfillAll as backfillAdultContent } from './steam/adult-content.service.js'
import { closeBrowser as closeScraperBrowser } from './steam/achievement-schema-scraper.js'
import { build as buildGamesCache } from './games/games.service.js'
import { build as buildWishlistCache } from './wishlist/wishlist.service.js'
import { build as buildPlayerCountsCache } from './steam/player-counts.service.js'
import { backfill as provisionBackfill, recheckUnavailableWishlistItems } from './provision.service.js'

let _booted = false

export async function bootRelay() {
    if (_booted) return
    _booted = true

    // ── Unconditional cache builds (reads depend on these, schedulers or not) ──
    // Relay server.js runs these in its listen callback regardless of any flag.
    // Safe in dev: read-only NAS scans, no writes, no ManagedFile handles.
    buildCommunityReviewsCache().catch(err => logger.error('[relay-boot] Community reviews cache build failed', { err: err?.message }))
    buildUpcomingCache().catch(err => logger.error('[relay-boot] Upcoming cache build failed', { err: err?.message }))
    loadAchievementsCache().catch(err => logger.error('[relay-boot] Achievement cache load failed', { err: err?.message }))

    // Unconditional: even a schedulers-off instance can lazily launch Chrome via
    // an on-demand pcgw syncGame or reddit/imgur browser call — the closers are
    // no-ops if nothing ever launched.
    registerCloser('pcgw-browser', closePcgwBrowser)
    registerCloser('reddit-browser', closeRedditBrowser)
    registerCloser('scraper-browser', closeScraperBrowser)

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
    // Wave 2:
    // Browser first, then the sync scheduler — mirrors relay server.js ordering.
    startScheduler('reddit', () => startRedditBrowser().then(() => startRedditSyncScheduler()))
    // Pin restore starts refresh timers that force reddit re-syncs (NAS writes),
    // so it lives behind the harness even though relay ran it unconditionally —
    // dev instances must not write the NAS.
    startScheduler('pin', startPin)
    startScheduler('nexus', startNexusSyncScheduler)
    // Wave 3:
    startScheduler('featured', startFeaturedPoller)
    // applist build fetches + writes applist.json; the adult-content backfill is
    // a long NAS-writing crawl — both prod-only, mirroring relay server.js order.
    startScheduler('applist', () => buildApplist()
        .then(() => backfillAdultContent().catch(err => logger.error('[relay-boot] Adult content backfill failed', { err: err?.message }))))
    // Derived caches: gated (not unconditional like community-reviews/upcoming)
    // because buildGamesCache's poster-pool refresh can WRITE poster-index.json.
    // Local reads stay correct without them via the services' lazy ensureBuilt().
    startScheduler('games-cache', buildGamesCache)
    startScheduler('wishlist-cache', buildWishlistCache)
    startScheduler('player-counts-cache', buildPlayerCountsCache)
    // Provision backfill + wishlist recheck: full NAS-writing pipelines.
    // SCHED_PROVISION=off until the combined Wave-3+4 window.
    startScheduler('provision', () => provisionBackfill()
        .then(() => recheckUnavailableWishlistItems())
        .catch(err => logger.error('[relay-boot] Provision backfill failed', { err: err?.message })))
    // Wave 3: (pending)
    // Wave 4: play-log must load before the now-playing poller + account cache.
}

export async function closeRelay() {
    await closeAll()
}
