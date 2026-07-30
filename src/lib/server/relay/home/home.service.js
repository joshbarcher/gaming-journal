// Ported verbatim from relay-server src/services/home/home.service.js
// (docs/relay-fold-in.md §6 — logic byte-identical; imports rewritten to the
// journal's ported paths). games.service + provision.service are the Wave-3
// (Batch C1) ports; play-log was ported early as a read dependency.
//
// countRecentRatings() deliberately keeps its DATA_DIR/gaming-journal path:
// local-reviews.json is the journal's own store-file, not relay-era data, so
// it does NOT go through relayDataRoot().
import path from 'node:path';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { featureDir } from '../shared/data-root.js';
import { getAll, ensureBuilt as ensureGamesBuilt } from '../games/games.service.js';
import { getLastPlayedMap, getSessions, load as loadPlayLog } from '../steam/play-log.service.js';
import { getAchievements, ensureAchievementsLoaded } from '../steam/steam.service.js';
import { getLibraryFirstSeen } from '../provision.service.js';
import { get as getUpcoming } from '../steam/upcoming.service.js';
import { getGuideCard } from './guide-card.service.js';
import logger from '../../logger.js';

const RESUME_WINDOW_MS       = 7 * 24 * 60 * 60 * 1000;
const RECENT_LIMIT           = 10;                        // backfill depth for the session card
const GUIDE_LOOKUP_LIMIT     = 6;                         // attach guide info to the top-N recent games
const JUST_BOUGHT_WINDOW_MS  = 7 * 24 * 60 * 60 * 1000;
const STATS_WINDOW_MS        = 30 * 24 * 60 * 60 * 1000;
const IMPORT_BATCH_THRESHOLD = 10;                        // > this many acquires in one day = library import, not purchases
const MOSAIC_COUNT           = 6;
const SET_COUNT              = 24;
const TTL_MS                 = 30 * 60 * 1000;
const PAYLOAD_TTL_MS         = 60 * 1000;                 // home payload is precomputed and cached this long

let _libSets   = [];
let _wlSets    = [];
let _libIdx    = 0;
let _wlIdx     = 0;
let _lastBuilt = 0;

function shuffle(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

function buildSets(tiles) {
    if (!tiles.length) return [];
    // Generate enough shuffled tiles to fill SET_COUNT groups of MOSAIC_COUNT
    const extended = [];
    while (extended.length < SET_COUNT * MOSAIC_COUNT) {
        extended.push(...shuffle(tiles));
    }
    const sets = [];
    for (let i = 0; i < SET_COUNT; i++) {
        sets.push(extended.slice(i * MOSAIC_COUNT, (i + 1) * MOSAIC_COUNT));
    }
    return sets;
}

function toTile(g) {
    return {
        appid:  g.appid,
        header: g.media?.header ?? `/relay/images/steam/games/${g.appid}/header.jpg`,
    };
}

export function build() {
    const games = getAll();
    if (!games.length) return;

    const libTiles = games.filter(g => g.source === 'library' || g.source === 'both').map(toTile);
    const wlTiles  = games.filter(g => g.source === 'wishlist' || g.source === 'both').map(toTile);

    _libSets   = buildSets(libTiles);
    _wlSets    = buildSets(wlTiles);
    _libIdx    = 0;
    _wlIdx     = 0;
    _lastBuilt = Date.now();

    logger.info('[home] Mosaic sets built', { lib: _libSets.length, wl: _wlSets.length });
}

function popSet(sets, idx) {
    if (!sets.length) return { posters: [], next: 0 };
    return { posters: sets[idx % sets.length], next: (idx + 1) % sets.length };
}

function getResume() {
    const lastPlayedMap = getLastPlayedMap();
    const games         = getAll();
    const byId          = new Map(games.map(g => [g.appid, g]));
    const nowMs         = Date.now();
    let   best          = null;

    for (const [appidStr, entry] of Object.entries(lastPlayedMap)) {
        const lastMs = new Date(entry.lastPlayedAt).getTime();
        if (nowMs - lastMs > RESUME_WINDOW_MS) continue;
        if (!best || lastMs > new Date(best.lastPlayedAt).getTime()) {
            best = { appid: Number(appidStr), ...entry };
        }
    }

    if (!best) return null;

    const game = byId.get(best.appid);
    if (!game) return null;

    const daysAgo = Math.floor((nowMs - new Date(best.lastPlayedAt).getTime()) / 86_400_000);

    return {
        appid:   best.appid,
        name:    game.name,
        header:  game.media?.header ?? `/relay/images/steam/games/${best.appid}/header.jpg`,
        hours:   parseFloat((best.effectiveMin / 60).toFixed(1)),
        daysAgo,
    };
}

function headerFor(game, appid) {
    return game?.media?.header ?? `/relay/images/steam/games/${appid}/header.jpg`;
}

// Achievement progress for one game: { unlocked, total } or null if it has none.
function achProgress(achCache, appid) {
    const entry = achCache[appid] ?? achCache[String(appid)];
    const list  = entry?.achievements ?? [];
    if (!list.length) return null;
    return { unlocked: list.filter(a => a.achieved).length, total: list.length };
}

/**
 * Recently-played games, most-recent first (up to RECENT_LIMIT). The client walks
 * this list to find the first title its filter toggles allow, so the session card
 * always shows an *unfiltered* game — a child-locked/filtered last-played title
 * never leaks onto the home page. Each entry carries achievement progress.
 */
function getRecentPlayed() {
    const lastPlayedMap = getLastPlayedMap();
    const byId          = new Map(getAll().map(g => [g.appid, g]));
    const achCache      = getAchievements();
    const nowMs         = Date.now();

    return Object.entries(lastPlayedMap)
        .map(([appidStr, e]) => ({ appid: Number(appidStr), ...e }))
        .sort((a, b) => new Date(b.lastPlayedAt).getTime() - new Date(a.lastPlayedAt).getTime())
        .slice(0, RECENT_LIMIT)
        .map((e) => {
            const game = byId.get(e.appid);
            if (!game) return null;
            return {
                appid:        e.appid,
                name:         game.name,
                header:       headerFor(game, e.appid),
                hours:        parseFloat((e.effectiveMin / 60).toFixed(1)),
                daysAgo:      Math.floor((nowMs - new Date(e.lastPlayedAt).getTime()) / 86_400_000),
                achievements: achProgress(achCache, e.appid),
            };
        })
        .filter(Boolean);
}

// Count of firstSeen stamps per calendar day, so a bulk library import (many
// games acquired the same day) can be told apart from real purchases.
function acquiresByDay(firstSeen) {
    const byDay = {};
    for (const iso of Object.values(firstSeen)) {
        const day = iso.slice(0, 10);
        byDay[day] = (byDay[day] ?? 0) + 1;
    }
    return byDay;
}

/**
 * Library games acquired within the last week — the "Just Bought" candidates.
 * Days on which more than IMPORT_BATCH_THRESHOLD games were first seen are treated
 * as a library import and excluded, so a fresh install doesn't flag everything.
 * The client picks one at random per refresh.
 */
function getJustBought() {
    const firstSeen = getLibraryFirstSeen();
    const byDay     = acquiresByDay(firstSeen);
    const byId      = new Map(getAll().map(g => [g.appid, g]));
    const nowMs     = Date.now();

    const out = [];
    for (const [appidStr, iso] of Object.entries(firstSeen)) {
        const t = new Date(iso).getTime();
        if (nowMs - t > JUST_BOUGHT_WINDOW_MS)            continue;
        if (byDay[iso.slice(0, 10)] > IMPORT_BATCH_THRESHOLD) continue;
        const appid = Number(appidStr);
        const game  = byId.get(appid);
        if (!game) continue;
        if (game.source !== 'library' && game.source !== 'both') continue;
        out.push({
            appid,
            name:    game.name,
            header:  headerFor(game, appid),
            daysAgo: Math.floor((nowMs - t) / 86_400_000),
        });
    }
    return out;
}

async function countRecentRatings(cutoff) {
    // Local reviews live in the app's data dir but share the same DATA_DIR mount.
    try {
        const raw = await readFile(path.join(process.env.DATA_DIR, 'gaming-journal', 'local-reviews.json'), 'utf8');
        const reviews = JSON.parse(raw);
        return Object.values(reviews).filter(r => r?.updatedAt && new Date(r.updatedAt).getTime() >= cutoff).length;
    } catch {
        return 0;
    }
}

/**
 * Rolling 30-day activity totals for the stats card.
 *   hours        — summed session minutes
 *   achievements — unlocks whose unlocktime falls in the window
 *   added        — library games first seen in the window (import batches excluded)
 *   wishlisted   — wishlist entries added in the window
 *   ratings      — local reviews touched in the window
 */
async function getActivityStats() {
    const cutoff = Date.now() - STATS_WINDOW_MS;

    let minutes = 0;
    for (const g of Object.values(getSessions())) {
        for (const s of g.sessions ?? []) {
            if (new Date(s.startedAt).getTime() >= cutoff) minutes += (s.durationMin ?? 0);
        }
    }

    let achievements = 0;
    for (const entry of Object.values(getAchievements())) {
        for (const a of entry.achievements ?? []) {
            if (a.achieved && a.unlocktime && a.unlocktime * 1000 >= cutoff) achievements++;
        }
    }

    const firstSeen = getLibraryFirstSeen();
    const byDay     = acquiresByDay(firstSeen);
    let added = 0;
    for (const iso of Object.values(firstSeen)) {
        if (byDay[iso.slice(0, 10)] > IMPORT_BATCH_THRESHOLD) continue;
        if (new Date(iso).getTime() >= cutoff) added++;
    }

    let wishlisted = 0;
    for (const g of getAll()) {
        const d = g.wishlist?.dateAdded;
        if (d == null) continue;
        const t = typeof d === 'number' ? d * 1000 : new Date(d).getTime();
        if (Number.isFinite(t) && t >= cutoff) wishlisted++;
    }

    const ratings = await countRecentRatings(cutoff);
    return { hours: Math.round(minutes / 60), achievements, added, wishlisted, ratings };
}

function getTodayRelease() {
    const todayIso   = new Date().toISOString().slice(0, 10);
    const { upcoming } = getUpcoming();
    if (!upcoming?.length) return null;

    const hit = upcoming.find(r => r.releaseDateIso === todayIso && !r.comingSoon);
    if (!hit) return null;

    const game = getAll().find(g => g.appid === hit.appid);
    return {
        appid:  hit.appid,
        name:   hit.name,
        header: game?.media?.header ?? `/relay/images/steam/games/${hit.appid}/header.jpg`,
    };
}

let _payload   = null;
let _payloadAt = 0;
let _inflight  = null;
let _lastFail  = 0;

// After a failed rebuild, wait this long before trying again — a NAS hiccup must
// not turn into a rebuild attempt on every single request.
const REFRESH_BACKOFF_MS = 15 * 1000;

/** Test hook — payload state is module-level and would otherwise leak between
 *  tests (same convention as nexus _resetCaches / sessions _resetForTests). */
export function _resetForTests() {
    _payload   = null;
    _payloadAt = 0;
    _inflight  = null;
    _lastFail  = 0;
    _libSets   = [];
    _wlSets    = [];
    _lastBuilt = 0;
}

// ── Disk-persisted last-known-good ────────────────────────────────────────────
// Warming at boot still costs a guides walk plus the session/achievement scans, so
// the very first request after a restart could still arrive before the payload
// exists. Persisting the assembled payload removes that window entirely: on boot it
// is read back in one call (no compute, no NAS walk, ~1 ms) and served immediately,
// while the background rebuild reconciles it.
const PAYLOAD_VERSION = 1;

function payloadFile() {
    return path.join(featureDir('home'), 'payload.json');
}

async function persistPayload(payload) {
    const file = payloadFile();
    const tmp  = `${file}.tmp`;
    try {
        await mkdir(path.dirname(file), { recursive: true });
        // tmp + rename: a torn write must never be readable as a valid payload.
        await writeFile(tmp, JSON.stringify({ v: PAYLOAD_VERSION, builtAt: new Date().toISOString(), payload }));
        await rename(tmp, file);
    } catch (err) {
        logger.warn('[home] Payload persist failed', { err: err.message });
    }
}

/**
 * Restore the persisted payload, or null.
 *
 * `release` ("released today") is dropped when the payload was built on an earlier
 * day — serving last-known-good is right, but claiming yesterday's game released
 * today is just wrong. Everything else (hours, posters, session card) is fine to
 * show slightly stale and is corrected by the rebuild moments later.
 */
async function restorePayload() {
    try {
        const raw = JSON.parse(await readFile(payloadFile(), 'utf8'));
        if (raw?.v !== PAYLOAD_VERSION || !raw.payload) return null;
        const builtAt = raw.builtAt ? new Date(raw.builtAt) : null;
        const sameDay = builtAt && builtAt.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
        const payload = raw.payload;
        if (!sameDay) payload.release = null;
        logger.info('[home] Payload restored from disk', { builtAt: raw.builtAt ?? null, sameDay: !!sameDay });
        return payload;
    } catch (err) {
        if (err.code !== 'ENOENT') logger.warn('[home] Persisted payload unreadable — will rebuild', { err: err.message });
        return null;
    }
}

async function buildPayload() {
    // Achievement counts feed the session card and the 30-day stats, and the cache
    // now loads off the boot critical path (see boot.js tier 1) — so wait for it here
    // rather than promoting a payload that reports zero unlocks. One load per
    // process; every rebuild after the first returns immediately.
    await ensureAchievementsLoaded().catch(err =>
        logger.warn('[home] Achievement cache unavailable — counts may read low', { err: err?.message ?? String(err) }));

    if (!_libSets.length || Date.now() - _lastBuilt > TTL_MS) {
        build();
    }

    const { posters: libPosters, next: nextLib } = popSet(_libSets, _libIdx);
    const { posters: wlPosters,  next: nextWl  } = popSet(_wlSets,  _wlIdx);
    _libIdx = nextLib;
    _wlIdx  = nextWl;

    const recentPlayed = getRecentPlayed();

    // Attach guide info to the top-N recent games so the client can render the
    // guide card without a second round-trip (see guide-card.service.js).
    await Promise.all(
        recentPlayed.slice(0, GUIDE_LOOKUP_LIMIT).map(async (g) => {
            g.guide = await getGuideCard(g.appid).catch(() => null);
        })
    );

    const stats = await getActivityStats();

    return {
        resume:       getResume(),       // kept for backward compatibility
        recentPlayed,                    // client filters + backfills the session card
        justBought:   getJustBought(),
        stats,
        release:      getTodayRelease(),
        libPosters,
        wlPosters,
    };
}

/** Drop the cached payload so the next request rebuilds (e.g. after a guide is
 *  marked used, so the "most recent guide" card updates immediately).
 *  Marks the payload stale rather than deleting it: the next request should still
 *  render the previous cards instantly and pick up the change a moment later. */
export function invalidateHomeCache() {
    _payloadAt = 0;
}

/**
 * Rebuild off the request path. Single-flight: a burst of requests arriving after
 * expiry triggers ONE rebuild, not one each.
 * A failure keeps the previous payload — degraded-but-present beats blank.
 */
function refreshInBackground() {
    if (_inflight) return _inflight;

    _inflight = buildPayload()
        .then((next) => {
            // Don't promote a degenerate payload built before the games cache is
            // warm — the session/sale cards derive from getAll(), so an empty build
            // would blank them. Leave the old payload (and stale stamp) in place so
            // the next request tries again.
            if (getAll().length > 0) {
                _payload   = next;
                _payloadAt = Date.now();
                _lastFail  = 0;
                // Fire-and-forget: the next restart serves this from disk instantly.
                persistPayload(next).catch(() => { /* logged in persistPayload */ });
            }
            return _payload ?? next;
        })
        .catch((err) => {
            _lastFail = Date.now();
            logger.error('[home] Payload rebuild failed — serving last-known-good', { err: err?.message ?? String(err) });
            return _payload;
        })
        .finally(() => { _inflight = null; });

    return _inflight;
}

/**
 * The landing-page payload — stale-while-revalidate.
 *
 * Assembling it walks the guides tree on the NAS and scans the session/achievement
 * stores, which is far too slow to sit on a render. It used to be cached for
 * PAYLOAD_TTL_MS and then rebuilt INLINE on the next request, so any gap in
 * browsing longer than the TTL meant the next visitor waited seconds for the page
 * to fill in. Now the TTL only decides when to refresh in the background; a cached
 * payload is always returned immediately, however old it is.
 *
 * Only a genuinely cold process (nothing built yet) awaits a build — and boot
 * warming (see warmHomeCache) means that normally finishes before the first visit.
 */
export async function getHomeData() {
    if (_payload) {
        const stale      = Date.now() - _payloadAt >= PAYLOAD_TTL_MS;
        const backingOff = _lastFail && Date.now() - _lastFail < REFRESH_BACKOFF_MS;
        if (stale && !backingOff) refreshInBackground();   // NOT awaited — that's the point
        return _payload;
    }

    // Nothing in memory yet (a request beat boot warming to it). Serve the persisted
    // copy rather than making this request wait for a full assembly, and let the
    // in-flight/next rebuild replace it. _payloadAt stays 0 so it reads as stale.
    if (!_inflight) {
        const restored = await restorePayload();
        if (restored) {
            if (!_payload) _payload = restored;
            refreshInBackground();
            return _payload;
        }
    }

    return await refreshInBackground();
}

/**
 * Build the payload at boot so the first visitor after a deploy/restart doesn't
 * have to wait for it either. Read-only (guide tree + session/achievement stores),
 * so it is safe to run on dev instances that must never write the NAS.
 * Fire-and-forget: startup must not block on the NAS.
 */
export function warmHomeCache() {
    // Restore first and separately: one file read, so the payload is servable within
    // milliseconds of boot even though the rebuild below takes longer. Left stale
    // (_payloadAt stays 0) so the rebuild still replaces it.
    restorePayload()
        .then(restored => { if (restored && !_payload) _payload = restored; })
        .catch(() => { /* logged in restorePayload */ });

    // The same prerequisites the routes ensure — a payload built before the games
    // cache is warm is degenerate and won't be promoted, wasting the walk.
    Promise.all([ensureGamesBuilt(), loadPlayLog()])
        .then(() => refreshInBackground())
        .catch(err => logger.error('[home] Cache warm failed', { err: err?.message ?? String(err) }));
}
