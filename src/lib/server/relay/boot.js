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
import { ensureIndex as ensureCommunityReviews, build as buildCommunityReviews } from './community-reviews/community-reviews.service.js'
import { closeBrowser as closePcgwBrowser } from './pcgw/pcgw.service.js'
import { startBrowser as startRedditBrowser, closeBrowser as closeRedditBrowser, startRedditSyncScheduler } from './reddit/reddit.service.js'
import { startup as startPin } from './pin/pin.service.js'
import { startNexusSyncScheduler } from './nexus/nexus.service.js'
import { startPoller as startFeaturedPoller } from './steam/featured-poller.js'
import { build as buildUpcomingCache } from './steam/upcoming.service.js'
import { ensureAchievementsLoaded } from './steam/steam.service.js'
import { buildApplist } from './steam/applist.service.js'
import { backfillAll as backfillAdultContent } from './steam/adult-content.service.js'
import { closeBrowser as closeScraperBrowser } from './steam/achievement-schema-scraper.js'
import { build as buildGamesCache, ensureBuilt as ensureGamesBuilt, getAll as getAllGames } from './games/games.service.js'
import { build as buildWishlistCache, ensureBuilt as ensureWishlistBuilt } from './wishlist/wishlist.service.js'
import { prime as primePosterPool } from './games/poster-pool.service.js'
import { build as buildPlayerCountsCache } from './steam/player-counts.service.js'
import { backfill as provisionBackfill, recheckUnavailableWishlistItems } from './provision.service.js'
import { load as loadPlayLog, close as closePlayLog } from './steam/play-log.service.js'
import { startPoller as startNowPlayingPoller, stopPoller as stopNowPlayingPoller } from './steam/now-playing.service.js'
import { build as buildAccountCache } from './account/account.service.js'
import { startSnapshotScheduler, stopSnapshotScheduler } from './steam/sessions.service.js'
import { warmHomeCache } from './home/home.service.js'

let _booted = false

// Spacing between the big background index refreshes (see tier 2 below).
const REFRESH_STAGGER_MS = 45_000

/** Run fn after ms, swallowing failures — used to space out background refreshes. */
function afterDelay(ms, fn) {
    const t = setTimeout(() => {
        Promise.resolve().then(fn).catch(err => logger.error('[relay-boot] Deferred task failed', { err: err?.message ?? String(err) }))
    }, ms)
    t.unref?.()   // a pending refresh must never hold the process open
}

export async function bootRelay() {
    if (_booted) return
    _booted = true

    // ── TIER 0: renderable from disk ─────────────────────────────────────────
    // Everything the first page render needs, and nothing else. Each of these is a
    // single-file read — games sidecar, play-log snapshot, poster + wishlist indexes
    // — so it costs milliseconds rather than the thousands-of-files scans these
    // replaced. Awaited, and deliberately AHEAD of every refresh/crawl/browser below:
    // those used to run concurrently and saturate the NAS, which is what pushed
    // play-log's load out to +51s and left the landing page drawing empty cards
    // (empty session card, no posters, "0 hours played") for most of a minute.
    //
    // Unconditional (all read-only, so a schedulers-off dev instance is safe) and
    // ahead of the schedulers-disabled return below.
    const t0 = Date.now()
    await Promise.all([
        // Poster pool needs the games list, so it chains off the games sidecar rather
        // than racing it — otherwise the mosaics render blank (see poster-pool.prime).
        ensureGamesBuilt()
            .then(() => primePosterPool(getAllGames()))
            .catch(err => logger.error('[relay-boot] Games index / poster pool load failed', { err: err?.message })),
        loadPlayLog().catch(err         => logger.error('[relay-boot] Play-log load failed', { err: err?.message })),
        ensureWishlistBuilt().catch(err => logger.error('[relay-boot] Wishlist index load failed', { err: err?.message })),
        // NOT the achievement cache: it reads ~1650 per-game files (2.5s on the NAS,
        // measured as the entire cost of tier 0 once everything else was fixed). The
        // first render doesn't need it — the persisted payload already carries its
        // counts — so it loads in tier 1, and buildPayload awaits it so no rebuild can
        // promote a payload with the achievement numbers missing.
    ])
    registerCloser('play-log', closePlayLog)
    logger.info('[relay-boot] Tier 0 ready — page is renderable', { ms: Date.now() - t0 })

    // The landing payload, now assembled over real session/games data rather than an
    // empty store. Persisted, so the next restart serves it from disk with no compute
    // and no guides walk at all — see getHomeData / warmHomeCache.
    warmHomeCache()

    // ── TIER 1: everything else that fast-boots from a sidecar ───────────────
    // Not on the first-render path, so fire-and-forget behind tier 0. Sidecar load
    // only — community-reviews' own boot() would kick its full rebuild here, and at
    // ~43s that is the single largest NAS scan of startup; it joins the staggered
    // refreshes in tier 2 instead.
    ensureCommunityReviews().catch(err => logger.error('[relay-boot] Community reviews index load failed', { err: err?.message }))
    buildUpcomingCache().catch(err => logger.error('[relay-boot] Upcoming cache build failed', { err: err?.message }))
    ensureAchievementsLoaded().catch(err => logger.error('[relay-boot] Achievement cache load failed', { err: err?.message }))

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
    // Derived-cache REFRESHES (the sidecars themselves already loaded in tier 0, so
    // these are refresh-only — calling boot() here would re-read the 13 MB games
    // sidecar a second time, which is what the duplicate "[games] index: loaded"
    // line in the logs was). Gated (not unconditional) because the games refresh
    // runs poster-pool upkeep which can WRITE poster-index.json — dev instances read
    // the sidecar via tier 0 / the routes' ensureBuilt() instead, never writing.
    //
    // Staggered: these are full scans over thousands of NAS files (games ~37s,
    // community-reviews ~43s, wishlist ~17s). Started together they saturate the NAS
    // and starve everything else — that contention is what made a cold start feel
    // like a minute. Spacing them costs nothing; they are background upkeep whose
    // results nothing is waiting on.
    startScheduler('games-cache',         () => afterDelay(REFRESH_STAGGER_MS,     buildGamesCache))
    startScheduler('wishlist-cache',      () => afterDelay(REFRESH_STAGGER_MS * 2, buildWishlistCache))
    startScheduler('player-counts-cache', () => afterDelay(REFRESH_STAGGER_MS * 3, buildPlayerCountsCache))
    startScheduler('community-reviews',   () => afterDelay(REFRESH_STAGGER_MS * 4, buildCommunityReviews))
    // Provision backfill + wishlist recheck: full NAS-writing pipelines.
    // SCHED_PROVISION=off until the combined Wave-3+4 window.
    startScheduler('provision', () => provisionBackfill()
        .then(() => recheckUnavailableWishlistItems())
        .catch(err => logger.error('[relay-boot] Provision backfill failed', { err: err?.message })))
    // Wave 4: play-log must be in memory before the now-playing poller and
    // account cache start — they both read session data (relay server.js
    // ordering). The poller is the debounced restart-safe port; the snapshot
    // scheduler is THE 30-minute steam tick (library/sessions/player-counts/
    // reviews/provision). SCHED_NOW_PLAYING / SCHED_SESSIONS stay off until
    // the combined Wave-3+4 window.
    startScheduler('now-playing', () => loadPlayLog()
        .then(() => {
            startNowPlayingPoller().catch(err => logger.error('[relay-boot] Now-playing poller startup failed', { err: err?.message }))
            return buildAccountCache().catch(err => logger.error('[relay-boot] Account cache build failed', { err: err?.message }))
        }))
    startScheduler('sessions', startSnapshotScheduler)
    registerCloser('now-playing-poller', stopNowPlayingPoller)
    registerCloser('snapshot-scheduler', stopSnapshotScheduler)
    // Wave 3: (pending)
    // Wave 4: play-log must load before the now-playing poller + account cache.
}

export async function closeRelay() {
    await closeAll()
}
