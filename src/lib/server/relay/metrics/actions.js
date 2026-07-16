// Ported from relay-server src/services/metrics/actions.js (docs/relay-fold-in.md
// §6 — logic byte-identical except the two entrypoints the journal does not host):
//
//   - 'steam:sessions' (Wave 4): takeSnapshot/deriveSessions live in
//     sessions.service.js, which stays relay-owned until Wave 4 (the now-playing
//     poller owns the session files — see § Phase 5). The action key is KEPT so
//     the registry drift test (`syncable` flags === action map) stays truthful,
//     but triggering it throws until the Wave-4 port restores the real calls.
//   - 'mail': mail is relay-owned permanently (being ported to its own app —
//     never migrating here). Same explicit-throw treatment; the key stays
//     because metrics/sources.js is shared relay-parallel state we do not edit.
//   - countNewIds: inlined verbatim from relay sessions.service.js (its only
//     consumer here is the steam:library novelty diff) rather than dragging the
//     whole Wave-4 sessions service in. Remove the copy when sessions ports.
//
/**
 * Manually triggerable syncs, keyed by source id.
 *
 * Every action runs through tracked(), so a manual trigger lands in the run
 * history exactly like a scheduled one — the chart and the status column do not
 * distinguish them, and they shouldn't: a record pulled is a record pulled.
 *
 * Not every source is here.  `steam:news` needs an appid, `steam:videos` is a
 * CLI tool, and `steam:account` has no sync entrypoint of its own.  Sources
 * absent from this map report `canSync: false` and get no button.
 */

import logger from '../../logger.js';
import { tracked } from './tracked.js';
import { begin, end, isRunning, setProgress } from './job-guard.js';

import { syncGames, syncWishlist, syncRecentlyPlayed, syncAchievements, getGames, getWishlist, getRecentlyPlayed } from '../steam/steam.service.js';
import { collectOwned, collectGlobalTop } from '../steam/player-counts.service.js';
import { incrementalScrapeReviews } from '../steam/scrape-reviews.service.js';
import { syncGameImages } from '../steam/images.service.js';
import { syncAll as syncCommunityReviews } from '../community-reviews/community-reviews.service.js';
import { pollOnce as pollFeatured } from '../steam/featured-poller.js';
import { syncAll as syncHltb } from '../hltb/hltb.service.js';
import { syncAll as syncItad } from '../itad/itad.service.js';
import { syncAll as syncProtonDb } from '../protondb/protondb.service.js';
import { syncAll as syncPcgw } from '../pcgw/pcgw.service.js';
import { runDailySync as syncReddit } from '../reddit/reddit.service.js';

/**
 * Inlined verbatim from relay-server src/services/steam/sessions.service.js
 * (Wave 4 — see header). Count keys present in `after` but not `before`.
 */
export function countNewIds(beforeIds, afterIds) {
    const known = new Set(beforeIds);
    return afterIds.reduce((n, id) => (known.has(id) ? n : n + 1), 0);
}

/**
 * Sum the counts of several sub-syncs into one run record.
 *
 * `created` and `updated` are summed too — dropping them here would silently
 * chart every multi-step manual sync as having produced no new information.
 */
export function combine(results) {
    return results.reduce((acc, r) => ({
        fetched: acc.fetched + (r?.fetched ?? 0),
        created: acc.created + (r?.created ?? 0),
        updated: acc.updated + (r?.updated ?? 0),
        skipped: acc.skipped + (r?.skipped ?? 0),
        failed:  acc.failed  + (r?.failed  ?? 0),
        total:   acc.total   + (r?.total   ?? 0),
    }), { fetched: 0, created: 0, updated: 0, skipped: 0, failed: 0, total: 0 });
}

/**
 * An onProgress callback bound to a source id, routed into the job guard so the
 * row renders a determinate meter instead of an indeterminate pulse.
 *
 * Every long-running sync reports: achievements, images, community-reviews,
 * hltb, itad, protondb, pcgw, reddit. The short ones (library, sessions,
 * reviews, featured, player-counts) finish in seconds and keep the pulse, as
 * does mail, which tracks progress in its own syncProgress map.
 *
 * A sync must call onProgress(0, total) BEFORE its first unit of work — the
 * guard treats total: 0 as indeterminate, so reporting only at the end (which
 * itad used to do) leaves a multi-minute job showing a pulse the whole way.
 */
const progressFor = id => (done, total) => setProgress(id, done, total);

const ACTIONS = {
    /**
     * A manual library sync must report novelty the same way the snapshot tick
     * does — by diffing appid sets before and after. Reporting only `fetched`
     * would chart 0 new games for a sync that actually found one, purely
     * because it was triggered from a button instead of a timer.
     */
    'steam:library': async () => {
        // force: a manual trigger means "go now", not "go if the 24h TTL expired".
        const gamesBefore    = await getGames();
        const wishlistBefore = await getWishlist();
        const recentBefore   = await getRecentlyPlayed();

        const games    = await syncGames({ force: true });
        const wishlist = await syncWishlist({ force: true });
        const recent   = await syncRecentlyPlayed({ force: true });

        const appids = v => (v?.games ?? []).map(g => g.appid);

        return combine([
            {
                fetched: games?.games?.length ?? 0,
                created: countNewIds(appids(gamesBefore), appids(games)),
            },
            {
                fetched: Object.keys(wishlist?.items ?? {}).length,
                created: countNewIds(Object.keys(wishlistBefore?.items ?? {}), Object.keys(wishlist?.items ?? {})),
            },
            {
                fetched: recent?.games?.length ?? 0,
                created: countNewIds(appids(recentBefore), appids(recent)),
            },
        ]);
    },

    // WAVE 4 — restore to `await takeSnapshot(); await deriveSessions();` from
    // steam/sessions.service.js when the live-session machinery ports (the relay
    // owns the snapshot/session files until then; a journal-side snapshot here
    // would be a second writer on them).
    'steam:sessions': async () => {
        throw new Error('steam:sessions is relay-owned until Wave 4 — trigger it on the relay dashboard');
    },

    'steam:player-counts': async () => combine([await collectOwned(), await collectGlobalTop()]),

    /**
     * NOT forced, unlike the library trigger above.
     *
     * `force` here does not mean "skip a cheap TTL check" — it replaces the
     * whole selection with every candidate game, each costing a Steam API call
     * and possibly a Puppeteer schema scrape. A button labelled "Sync" must not
     * be a heavier hammer than the timer that normally drives it. Running now
     * with the usual selection is what the user is asking for.
     *
     * syncAchievements only re-fetches games that are new or played since their
     * last sync, so every synced game is a changed record. The mapper mirrors
     * the snapshot tick — without it a manual sync charts 0 new records.
     */
    'steam:achievements': async () => {
        const r = await syncAchievements({ onProgress: progressFor('steam:achievements') });
        return { fetched: r.synced, updated: r.synced, skipped: r.skipped, failed: r.failed };
    },

    'steam:reviews':           () => incrementalScrapeReviews(),
    'steam:images':            () => syncGameImages({ onProgress: progressFor('steam:images') }),
    'steam:community-reviews': () => syncCommunityReviews({ onProgress: progressFor('steam:community-reviews') }),
    'steam:featured':          () => pollFeatured(),

    hltb:     () => syncHltb({ onProgress: progressFor('hltb') }),
    itad:     () => syncItad({ onProgress: progressFor('itad') }),
    protondb: () => syncProtonDb({ onProgress: progressFor('protondb') }),
    pcgw:     () => syncPcgw({ onProgress: progressFor('pcgw') }),
    reddit:   () => syncReddit({ onProgress: progressFor('reddit') }),

    // Mail never migrates here (it is being ported to its own app). The key
    // stays so canSync() keeps matching sources.js's shared syncable flags.
    mail: async () => {
        throw new Error('mail is relay-owned — trigger it on the relay dashboard');
    },
};

/** True when `id` has a manual trigger. */
export function canSync(id) {
    return Object.hasOwn(ACTIONS, id);
}

export function listActions() {
    return Object.keys(ACTIONS);
}

/** Raised when a trigger overlaps a run already in flight. */
export class ConflictError extends Error {
    constructor(id) {
        super(`Sync already in progress for ${id}`);
        this.name = 'ConflictError';
        this.id = id;
    }
}

/**
 * Start the sync for `id` and return immediately — these run for minutes.
 *
 * The guard is claimed synchronously before the promise is created, so two
 * requests arriving in the same tick cannot both pass the check.  The caller
 * gets a 202-style acknowledgement; progress shows up in the run history.
 */
export function startSync(id) {
    if (!canSync(id)) throw new Error(`No sync action for source: ${id}`);
    if (!begin(id))   throw new ConflictError(id);

    const promise = tracked(id, ACTIONS[id])
        .catch(err => logger.error('[admin] Manual sync failed', { id, err: err.message }))
        .finally(() => end(id));

    logger.info('[admin] Manual sync started', { id });
    return promise;
}

export { isRunning };
