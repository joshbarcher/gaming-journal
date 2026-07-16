// Ported verbatim from relay-server src/services/steam/sessions.service.js
// (docs/relay-fold-in.md §6 — logic byte-identical; only imports + data-dir
// helpers rewritten). Data stays under $RELAY_DATA_ROOT/steam — same on-disk
// paths as the relay (playtime-snapshots.json, sessions.json).
//
// startSnapshotScheduler() is THE 30-minute steam tick: snapshot + derive,
// recently-played sync, account cache rebuild, player-counts collection,
// review scraping, library/wishlist sync, provision of new games, wishlist
// rechecks, cache rebuilds, and the achievements sync + icon download. It must
// be boot-wired behind the scheduler harness (prod-only) — never started as an
// import side effect.
import path from 'node:path';
import logger from '../../logger.js';
import { ManagedFile } from '../shared/managed-file.js';
import { readFlags, isSoftware } from '../shared/flags.js';
import { steamFetch } from '../shared/steam-fetch.js';
import { featureDir } from '../shared/data-root.js';
import { syncRecentlyPlayed, syncGames, syncWishlist, syncAchievements, getGames, getWishlist, getRecentlyPlayed } from './steam.service.js';
import { syncAchievementImages } from './images.service.js';
import { incrementalScrapeReviews } from './scrape-reviews.service.js';
import { rebuild } from '../shared/cache-manager.js';
import { collectOwned, collectGlobalTop } from './player-counts.service.js';
import { getKnownAppids, provisionNewGames, recheckUnavailableWishlistItems, cleanupLocalWishlist } from '../provision.service.js';
import { tracked } from '../metrics/tracked.js';

/**
 * syncGames/syncWishlist/syncRecentlyPlayed return the same cache object whether
 * they called the Steam API or short-circuited on a fresh cache (24h TTL for
 * games and wishlist).  The only observable difference is fetchedAt, so compare
 * it against the value from before the call to decide whether records were
 * actually pulled.  Without this, a once-a-day library sync would be charted as
 * having pulled its full game count on every one of the day's 48 ticks.
 *
 * `created` counts entries that were not in the previous cache — a library
 * re-fetch pulls 2,000 games and creates none of them unless you bought one.
 * That, not `fetched`, is what the new-records chart plots.
 */
export function countIfRefetched(before, after, size, created = 0) {
    const refetched = after?.fetchedAt && after.fetchedAt !== before;
    return refetched
        ? { fetched: size(after), created, total: size(after) }
        : { fetched: 0, created: 0, skipped: size(after), total: size(after) };
}

/** Count keys present in `after` but not `before`. */
export function countNewIds(beforeIds, afterIds) {
    const known = new Set(beforeIds);
    return afterIds.reduce((n, id) => (known.has(id) ? n : n + 1), 0);
}

const STEAM_API = 'https://api.steampowered.com';

const SESSION_GAP_MS = 90 * 60 * 1_000;
const SNAPSHOT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export const SNAPSHOT_INTERVAL_MS = 30 * 60 * 1_000;

function dataDir() {
    return featureDir('steam');
}

function makeFile(name, defaultValue) {
    return new ManagedFile({
        filePath: path.join(dataDir(), `${name}.json`),
        name: `steam-${name}`,
        defaultValue,
    });
}

let _snapshotsFile = null;
let _sessionsFile  = null;

async function _loadSnapshotsFile() {
    if (!_snapshotsFile) {
        _snapshotsFile = makeFile('playtime-snapshots', () => ({ snapshots: [] }));
        await _snapshotsFile.load();
    }
    return _snapshotsFile;
}

async function _loadSessionsFile() {
    if (!_sessionsFile) {
        _sessionsFile = makeFile('sessions', () => ({}));
        await _sessionsFile.load();
    }
    return _sessionsFile;
}

/**
 * Drops the memoized ManagedFiles so the next call re-reads from disk.
 *
 * Only tests need this: they seed playtime-snapshots.json directly, and would
 * otherwise keep seeing whatever an earlier test left in memory — ManagedFile.get()
 * never touches disk after load(). Production writes only ever go through these
 * same handles, so there the in-memory copy is authoritative.
 */
export function _resetForTests() {
    _snapshotsFile = null;
    _sessionsFile  = null;
}

async function fetchRecentlyPlayed(apiKey, steamId) {
    const url = new URL(`${STEAM_API}/IPlayerService/GetRecentlyPlayedGames/v1/`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('steamid', steamId);
    url.searchParams.set('count', '0');
    const res  = await steamFetch(url.toString());
    const body = await res.json();
    return (body.response?.games ?? []).map((g) => ({
        appid:            g.appid,
        name:             g.name,
        playtime_forever: g.playtime_forever,
    }));
}

export async function takeSnapshot() {
    const apiKey  = process.env.STEAM_API_KEY;
    const steamId = process.env.STEAM_ID;
    if (!apiKey)  throw new Error('STEAM_API_KEY is not set');
    if (!steamId) throw new Error('STEAM_ID is not set');

    const file = await _loadSnapshotsFile();
    const data = file.get();

    const games    = await fetchRecentlyPlayed(apiKey, steamId);
    const takenAt  = new Date().toISOString();
    const cutoff   = Date.now() - SNAPSHOT_RETENTION_MS;

    const pruned = data.snapshots.filter(
        (s) => new Date(s.takenAt).getTime() > cutoff
    );
    pruned.push({ takenAt, games });

    await file.set({ snapshots: pruned });
    await file.flush();

    logger.debug('[steam-sessions] Snapshot taken', { gameCount: games.length, totalSnapshots: pruned.length });
    return { takenAt, gameCount: games.length };
}

function deriveSessionsForGame(observations) {
    const sessions = [];
    let sessionStart  = null;
    let sessionEnd    = null;
    let sessionMinutes = 0;
    let prevPlaytime  = null;
    let prevTime      = null;

    for (const obs of observations) {
        if (prevPlaytime === null) {
            prevPlaytime = obs.playtime;
            prevTime     = obs.takenAt;
            continue;
        }

        const delta   = obs.playtime - prevPlaytime;
        const gapMs   = obs.takenAt - prevTime;

        if (delta > 0) {
            if (sessionStart === null) sessionStart = prevTime;
            sessionMinutes += delta;
            sessionEnd = obs.takenAt;
        } else if (sessionStart !== null && gapMs >= SESSION_GAP_MS) {
            sessions.push({
                startedAt:   new Date(sessionStart).toISOString(),
                endedAt:     new Date(sessionEnd).toISOString(),
                durationMin: sessionMinutes,
            });
            sessionStart   = null;
            sessionEnd     = null;
            sessionMinutes = 0;
        }

        prevPlaytime = obs.playtime;
        prevTime     = obs.takenAt;
    }

    if (sessionStart !== null) {
        sessions.push({
            startedAt:   new Date(sessionStart).toISOString(),
            endedAt:     new Date(sessionEnd).toISOString(),
            durationMin: sessionMinutes,
        });
    }

    return sessions;
}

export async function deriveSessions() {
    const snapshotFile = await _loadSnapshotsFile();
    const { snapshots } = snapshotFile.get();

    if (snapshots.length < 2) {
        logger.info('[steam-sessions] Not enough snapshots to derive sessions', {
            count: snapshots.length,
        });
        return {};
    }

    const gameObs = {};
    for (const snap of snapshots) {
        const t = new Date(snap.takenAt).getTime();
        for (const g of snap.games ?? []) {
            if (!gameObs[g.appid]) gameObs[g.appid] = { name: g.name, obs: [] };
            gameObs[g.appid].obs.push({ takenAt: t, playtime: g.playtime_forever });
        }
    }

    const flags  = await readFlags();
    const result = {};
    for (const [appid, { name, obs }] of Object.entries(gameObs)) {
        if (isSoftware(flags, appid)) continue;
        obs.sort((a, b) => a.takenAt - b.takenAt);
        const sessions = deriveSessionsForGame(obs);
        if (sessions.length > 0) {
            result[appid] = { name, sessions };
        }
    }

    const sessionFile = await _loadSessionsFile();
    await sessionFile.set(result);
    await sessionFile.flush();

    const totalSessions = Object.values(result).reduce((n, g) => n + g.sessions.length, 0);
    logger.info('[steam-sessions] Sessions derived', {
        games: Object.keys(result).length,
        sessions: totalSessions,
    });
    return result;
}

export async function getSessions() {
    return (await _loadSessionsFile()).get();
}

export async function getSnapshots() {
    return (await _loadSnapshotsFile()).get();
}

let _snapshotTimer = null;

export async function startSnapshotScheduler() {
    if (_snapshotTimer) return;

    await Promise.all([_loadSnapshotsFile(), _loadSessionsFile()]);

    async function tick() {
        try {
            // One playtime snapshot per tick — the "record pulled" here is the
            // snapshot itself, not a per-game row.
            await tracked('steam:sessions', async () => {
                await takeSnapshot();
                await deriveSessions();
                return { fetched: 1, total: 1 };
            });

            const recentBefore = await getRecentlyPlayed();
            await tracked(
                'steam:library',
                () => syncRecentlyPlayed(),
                r => countIfRefetched(
                    recentBefore?.fetchedAt, r,
                    v => v?.games?.length ?? 0,
                    countNewIds(
                        (recentBefore?.games ?? []).map(g => g.appid),
                        (r?.games ?? []).map(g => g.appid),
                    ),
                ),
            );

            await rebuild('account');
            await tracked('steam:player-counts', () => collectOwned());
            await tracked('steam:player-counts', () => collectGlobalTop());
            await rebuild('player-counts');
            await tracked('steam:reviews', () => incrementalScrapeReviews());

            const prevIds = await getKnownAppids();

            const gamesBefore = await getGames();
            await tracked(
                'steam:library',
                () => syncGames(),
                r => countIfRefetched(
                    gamesBefore?.fetchedAt, r,
                    v => v?.games?.length ?? 0,
                    // Non-zero only when you actually acquired a game.
                    countNewIds(
                        (gamesBefore?.games ?? []).map(g => g.appid),
                        (r?.games ?? []).map(g => g.appid),
                    ),
                ),
            );

            await cleanupLocalWishlist();

            const wishlistBefore = await getWishlist();
            await tracked(
                'steam:library',
                () => syncWishlist(),
                r => countIfRefetched(
                    wishlistBefore?.fetchedAt, r,
                    v => Object.keys(v?.items ?? {}).length,
                    countNewIds(Object.keys(wishlistBefore?.items ?? {}), Object.keys(r?.items ?? {})),
                ),
            );

            await provisionNewGames(prevIds);
            await recheckUnavailableWishlistItems();
            // 'games' must rebuild alongside 'wishlist' here — poster-pool.service.js's wishlist
            // source tagging comes from the 'games' cache, not the 'wishlist' cache. Without this,
            // 'wishlist' keeps growing every tick (syncWishlist() above) while 'games' stays frozen
            // at whatever it was at last server boot, silently starving the Home mosaic's wishlist
            // candidate pool down to whatever handful of games happened to be tagged back then.
            await rebuild('wishlist', 'games', 'upcoming');

            // Sync achievements for any games that are new, have been played
            // since the last fetch, or still have stale/missing metadata.
            // Then immediately download icons only for the games we just synced.
            // syncAchievements only re-fetches games that are new or have been
            // played since their last fetch, so every synced game is a record
            // whose stored content changed — an update, not a creation.
            const { syncedAppids } = await tracked(
                'steam:achievements',
                () => syncAchievements(),
                r => ({ fetched: r.synced, updated: r.synced, skipped: r.skipped, failed: r.failed }),
            );
            if (syncedAppids.length > 0) {
                logger.info('[steam-sessions] Downloading achievement images for synced games', {
                    count: syncedAppids.length,
                });
                await tracked('steam:images', () => syncAchievementImages({ appids: syncedAppids }));
            }
        } catch (err) {
            logger.error('[steam-sessions] Snapshot tick failed', err);
        }
    }

    // Delay the first tick by 60 s so the server can finish binding, pass its
    // health check, and complete the initial cache builds before doing the
    // heavy Steam API + player-counts work.
    setTimeout(tick, 60_000);
    _snapshotTimer = setInterval(tick, SNAPSHOT_INTERVAL_MS);
    logger.info('[steam-sessions] Snapshot scheduler started', {
        intervalMin: SNAPSHOT_INTERVAL_MS / 60_000,
    });
}

export function stopSnapshotScheduler() {
    if (_snapshotTimer) {
        clearInterval(_snapshotTimer);
        _snapshotTimer = null;
        logger.info('[steam-sessions] Snapshot scheduler stopped');
    }
}
