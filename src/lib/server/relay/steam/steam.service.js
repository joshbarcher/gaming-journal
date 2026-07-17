// Ported verbatim from relay-server src/services/steam/steam.service.js
// (docs/relay-fold-in.md §6 — logic byte-identical; only imports + data-dir
// helpers rewritten). Data stays under $RELAY_DATA_ROOT/steam — same on-disk
// paths as the relay.
//
// One deliberate deviation, a fold-in seam (not a behavior fix): the
// now-playing in-memory fallback inside _syncAchievementsImpl is commented
// out — now-playing.service.js is Wave 4 and not ported yet. The block is
// preserved verbatim in a comment for restoration when the poller ports.
import path from 'node:path';
import fs from 'node:fs/promises';
import logger from '../../logger.js';
import { ManagedFile } from '../shared/managed-file.js';
import { steamFetch, processBatch } from '../shared/steam-fetch.js';
import { featureDir } from '../shared/data-root.js';
import { scrapeAchievementSchema } from './achievement-schema-scraper.js';

const STEAM_API = 'https://api.steampowered.com';
const STORE_API = 'https://store.steampowered.com';

const GAMES_TTL_MS          = 24 * 60 * 60 * 1_000;
const ACHIEVEMENTS_TTL_MS   =  6 * 60 * 60 * 1_000;
const NO_ACH_TTL_MS         = 30 * 24 * 60 * 60 * 1_000; // confirmed no achievements — recheck monthly
const NULL_REVIEW_TTL_MS    = 30 * 24 * 60 * 60 * 1_000; // confirmed no user review — recheck monthly
const RECENT_PLAYED_TTL_MS  =  1 * 60 * 60 * 1_000;
const WISHLIST_TTL_MS       = 24 * 60 * 60 * 1_000;

const MIN_PLAYTIME = 1;
const MAX_REVIEW_SEARCH_PAGES = 3;

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

function achDir() {
    return path.join(dataDir(), 'achievements');
}

function makeAchFile(appid) {
    return new ManagedFile({
        filePath: path.join(achDir(), `${appid}.json`),
        name: `steam-ach-${appid}`,
        defaultValue: () => null,
    });
}

// In-memory cache populated at server start; updated by syncAchievements.
let _achCache = new Map();

// Each loader below caches the LOAD PROMISE, not just the eventual ManagedFile object. The
// previous pattern ("if (!_x) { _x = makeFile(...); await _x.load() }") assigns _x synchronously
// before awaiting — any second caller arriving in that gap (before .load() resolves) sees _x as
// already truthy, skips loading entirely, and calls .get() on a file that's not loaded yet, which
// throws "not loaded — call await load() first". Confirmed live: this silently corrupted
// games.service.js's wishlist merge (its getWishlist().catch(() => ({items:{}})) swallowed the
// exception), tagging only 16 games as wishlisted instead of the real ~1100, because
// games.service.js and wishlist.service.js's cache builds call getWishlist() concurrently at boot
// and the race decided which one actually got real data. Caching the promise itself means every
// concurrent caller awaits the exact same in-flight load, eliminating the race.
let _gamesFilePromise          = null;
let _reviewsFilePromise        = null;
let _recentlyPlayedFilePromise = null;
let _wishlistFilePromise       = null;

function _loadGamesFile() {
    if (!_gamesFilePromise) {
        const file = makeFile('games', () => ({ fetchedAt: null, gameCount: 0, games: [] }));
        _gamesFilePromise = file.load().then(() => file);
    }
    return _gamesFilePromise;
}

function _loadReviewsFile() {
    if (!_reviewsFilePromise) {
        const file = makeFile('reviews', () => ({}));
        _reviewsFilePromise = file.load().then(() => file);
    }
    return _reviewsFilePromise;
}

export async function getReviewsFile() {
    return _loadReviewsFile();
}

function _loadRecentlyPlayedFile() {
    if (!_recentlyPlayedFilePromise) {
        const file = makeFile('recently-played', () => ({ fetchedAt: null, totalCount: 0, games: [] }));
        _recentlyPlayedFilePromise = file.load().then(() => file);
    }
    return _recentlyPlayedFilePromise;
}

function _loadWishlistFile() {
    if (!_wishlistFilePromise) {
        const file = makeFile('wishlist', () => ({ fetchedAt: null, itemCount: 0, items: {} }));
        _wishlistFilePromise = file.load().then(() => file);
    }
    return _wishlistFilePromise;
}

function cacheIsFresh(fetchedAt, ttlMs) {
    if (!fetchedAt) return false;
    return Date.now() - new Date(fetchedAt).getTime() < ttlMs;
}

// ── Owned games ───────────────────────────────────────────────────────────────

async function fetchOwnedGames(apiKey, steamId) {
    const url = new URL(`${STEAM_API}/IPlayerService/GetOwnedGames/v1/`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('steamid', steamId);
    url.searchParams.set('include_appinfo', '1');
    url.searchParams.set('include_played_free_games', '1');
    url.searchParams.set('format', 'json');

    const res = await steamFetch(url.toString());
    const body = await res.json();
    return body.response ?? {};
}

export async function syncGames({ force = false } = {}) {
    const apiKey = process.env.STEAM_API_KEY;
    const steamId = process.env.STEAM_ID;
    if (!apiKey) throw new Error('STEAM_API_KEY is not set');
    if (!steamId) throw new Error('STEAM_ID is not set');

    const file = await _loadGamesFile();
    const cached = file.get();

    if (!force && cacheIsFresh(cached.fetchedAt, GAMES_TTL_MS)) {
        const ageMin = Math.round((Date.now() - new Date(cached.fetchedAt).getTime()) / 60_000);
        logger.info('[steam] Games cache is fresh — skipping sync', { ageMin, gameCount: cached.gameCount });
        return cached;
    }

    logger.info('[steam] Syncing owned games from Steam API');
    const raw = await fetchOwnedGames(apiKey, steamId);
    const games = raw.games ?? [];

    const next = {
        fetchedAt: new Date().toISOString(),
        gameCount: raw.game_count ?? games.length,
        games,
    };

    await file.set(next);
    await file.flush();

    logger.info('[steam] Games sync complete', { count: games.length });
    return next;
}

export async function getGames() {
    return (await _loadGamesFile()).get();
}

// ── Achievements ──────────────────────────────────────────────────────────────

async function fetchAchievements(apiKey, steamId, appId) {
    const url = new URL(`${STEAM_API}/ISteamUserStats/GetPlayerAchievements/v1/`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('steamid', steamId);
    url.searchParams.set('appid', appId);
    url.searchParams.set('format', 'json');

    const res = await steamFetch(url.toString());
    const body = await res.json();
    return body.playerstats ?? {};
}

/**
 * Lightweight single-game achievement refresh — player progress only, no schema
 * re-fetch.  Called by the now-playing poller the moment a new unlock is detected
 * so the achievements page reflects it immediately rather than waiting for the
 * next 30-minute sync tick.
 *
 * No-ops when the game has no cached schema (nothing to merge against).
 */
export async function refreshPlayerAchievements(appid) {
    const apiKey  = process.env.STEAM_API_KEY;
    const steamId = process.env.STEAM_ID;
    if (!apiKey || !steamId) return;

    const snapshot = _achCache.get(String(appid));
    if (!snapshot?.achievements?.length) return;   // no schema cached — nothing to update

    try {
        const stats     = await fetchAchievements(apiKey, steamId, appid);
        const playerMap = {};
        for (const a of stats.achievements ?? []) playerMap[a.apiname] = a;

        const merged = snapshot.achievements.map(ach => ({
            ...ach,
            achieved:    playerMap[ach.apiname]?.achieved    ?? ach.achieved,
            unlocktime:  playerMap[ach.apiname]?.unlocktime  ?? ach.unlocktime,
        }));

        await _writeGameAchievements(appid, {
            ...snapshot,
            fetchedAt:    new Date().toISOString(),
            achievements: merged,
            hasPlayerData: true,
        });
        logger.debug('[steam] Achievement cache refreshed for active game', { appid });
    } catch (err) {
        logger.debug('[steam] Mid-session achievement refresh failed', { appid, err: err.message });
    }
}

/**
 * On-demand achievement sync for a single game.
 *
 * Called by the now-playing poller when a session opens for a game that has
 * no cached achievement schema — i.e. the user just bought/installed it.
 *
 * If the schema is already cached, delegates to refreshPlayerAchievements
 * (cheaper: skips the GetSchemaForGame call).
 * If a full syncAchievements() is already running, skips to avoid conflicts.
 */
export async function syncAchievementsForGame(appid, name) {
    const apiKey  = process.env.STEAM_API_KEY;
    const steamId = process.env.STEAM_ID;
    if (!apiKey || !steamId) return;

    // If a full sync is in progress it will pick this game up — don't race it.
    if (_syncAchievementsRunning) return;

    const existing = _achCache.get(String(appid));
    if (existing?.achievements?.length) {
        // Schema is cached — just refresh player data (same as mid-session refresh).
        return refreshPlayerAchievements(appid);
    }

    logger.info('[steam] On-demand achievement fetch for new game', { appid, name });
    try {
        // ── 1. Schema ──────────────────────────────────────────────────────────
        let schemaAchs = [];
        let scraped    = [];
        try {
            schemaAchs = await fetchAchievementSchema(apiKey, appid);
        } catch { /* fall through to scraper */ }

        if (schemaAchs.length === 0) {
            scraped = await scrapeAchievementSchema(appid);
        }

        if (schemaAchs.length === 0 && scraped.length === 0) {
            // No achievements for this game — write empty entry so we don't retry.
            await _writeGameAchievements(appid, {
                fetchedAt: new Date().toISOString(), gameName: name,
                achievements: [], hasPlayerData: false,
            });
            logger.debug('[steam] No achievement schema for new game', { appid, name });
            return;
        }

        // ── 2. Player progress ─────────────────────────────────────────────────
        const playerMap = {};
        try {
            const stats = await fetchAchievements(apiKey, steamId, appid);
            for (const a of stats.achievements ?? []) playerMap[a.apiname] = a;
        } catch { /* player data unavailable (400/403) — show schema anyway */ }

        const hasPlayerData = Object.keys(playerMap).length > 0;

        // ── 3. Merge ───────────────────────────────────────────────────────────
        let merged;
        if (schemaAchs.length > 0) {
            merged = schemaAchs.map(s => {
                const p = playerMap[s.name] ?? {};
                return {
                    apiname:     s.name,
                    displayName: s.displayName ?? null,
                    description: s.description ?? null,
                    icon:        s.icon        ?? null,
                    icongray:    s.icongray    ?? null,
                    hidden:      s.hidden      ?? 0,
                    achieved:    p.achieved    ?? 0,
                    unlocktime:  p.unlocktime  ?? 0,
                };
            });
        } else {
            const playerArr = Object.values(playerMap);
            merged = scraped.map((s, i) => {
                const p = playerArr[i] ?? {};
                return {
                    apiname:     p.apiname     ?? `ach_${i}`,
                    displayName: s.displayName ?? null,
                    description: s.description ?? null,
                    icon:        s.icon        ?? null,
                    icongray:    null,
                    hidden:      0,
                    achieved:    p.achieved    ?? 0,
                    unlocktime:  p.unlocktime  ?? 0,
                };
            });
        }

        await _writeGameAchievements(appid, {
            fetchedAt: new Date().toISOString(), gameName: name,
            achievements: merged, hasPlayerData,
        });
        logger.info('[steam] On-demand achievement fetch complete', {
            appid, name, count: merged.length, playerData: hasPlayerData,
        });
    } catch (err) {
        logger.warn('[steam] On-demand achievement fetch failed', { appid, name, err: err.message });
    }
}

/**
 * Fetch the current player's achievement status for a single game right now.
 * Returns an array of { apiname, achieved, unlocktime } — or [] on any error.
 * Used by the now-playing poller to capture session baselines and mid-session
 * snapshots so earned achievements can be attributed to a specific play session.
 */
export async function fetchPlayerAchievementsNow(appid) {
    const apiKey  = process.env.STEAM_API_KEY;
    const steamId = process.env.STEAM_ID;
    if (!apiKey || !steamId) return [];
    try {
        const stats = await fetchAchievements(apiKey, steamId, appid);
        return (stats.achievements ?? []).map(a => ({
            apiname:    a.apiname,
            achieved:   a.achieved,
            unlocktime: a.unlocktime,
        }));
    } catch {
        return [];
    }
}

async function fetchAchievementSchema(apiKey, appId) {
    const url = new URL(`${STEAM_API}/ISteamUserStats/GetSchemaForGame/v2/`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('appid', appId);
    url.searchParams.set('format', 'json');

    const res = await steamFetch(url.toString());
    const body = await res.json();
    return body.game?.availableGameStats?.achievements ?? [];
}

/**
 * An entry needs repair if it has achievements but none of them have a
 * displayName — this indicates the data was cached before schema enrichment
 * was added, or the schema API silently returned empty on a previous run.
 */
function _needsRepair(entry) {
    const achs = entry?.achievements ?? [];
    return achs.length > 0 && achs[0].displayName == null;
}

/**
 * True when a played game has schema data but no player progress yet.
 * Triggers a lightweight player-data-only re-fetch (1 API call, not 2).
 * Only applies to games with recorded playtime — unplayed games won't
 * have any achievements to fetch.
 */
function _needsPlayerData(entry, game) {
    if ((game.playtime_forever ?? 0) < MIN_PLAYTIME) return false;
    if (entry?.playerDataBlocked === true) return false;
    const achs = entry?.achievements ?? [];
    return achs.length > 0 && entry.hasPlayerData === false;
}

async function _migrateAchievementsMonolith() {
    const monolithPath = path.join(dataDir(), 'achievements.json');
    let raw;
    try {
        raw = await fs.readFile(monolithPath, 'utf8');
    } catch {
        return;
    }
    const data = JSON.parse(raw);
    const dir = achDir();
    await fs.mkdir(dir, { recursive: true });
    const migrationEntries = Object.entries(data);
    for (let i = 0; i < migrationEntries.length; i += 20) {
        await Promise.all(
            migrationEntries.slice(i, i + 20).map(([appid, entry]) =>
                fs.writeFile(path.join(dir, `${appid}.json`), JSON.stringify(entry, null, 2))
            )
        );
    }
    await fs.rename(monolithPath, `${monolithPath}.migrated`);
    logger.info('[steam] Migrated monolithic achievements.json to per-game files', { games: Object.keys(data).length });
}

export async function loadAchievementsCache() {
    await _migrateAchievementsMonolith();

    let entries;
    try {
        entries = await fs.readdir(achDir());
    } catch {
        return;
    }

    _achCache.clear();
    const files = entries.filter(f => /^\d+\.json$/.test(f));
    const CONCURRENCY = 20;
    for (let i = 0; i < files.length; i += CONCURRENCY) {
        await Promise.all(
            files.slice(i, i + CONCURRENCY).map(async (f) => {
                const appid = f.slice(0, -5);
                try {
                    const data = JSON.parse(await fs.readFile(path.join(achDir(), f), 'utf8'));
                    if (data) _achCache.set(appid, data);
                } catch (err) {
                    logger.warn('[steam] Failed to load achievement cache entry', { file: f, err: err.message });
                }
            })
        );
    }

    logger.info('[steam] Achievement cache loaded', { games: _achCache.size });
}

// Prevents the 30-min tick and a manual repair call from running concurrently.
let _syncAchievementsRunning = false;

/**
 * Sync achievements for all candidate games.
 *
 * Candidate set (union):
 *   - Games with playtime_forever >= MIN_PLAYTIME  (played games)
 *   - Games with has_community_visible_stats === true  (have Steam achievements
 *     even if playtime is untracked — e.g. played offline or via other means)
 *
 * A game is queued for re-fetch when ANY of:
 *   - Never fetched before
 *   - Cache entry is missing displayName (stale pre-schema data) → repair
 *   - Cache is older than ACHIEVEMENTS_TTL_MS AND game was played since fetch
 *   - force = true
 *
 * When GetSchemaForGame returns an empty schema, falls back to scraping the
 * Steam Community stats page and joins by position (both APIs return
 * achievements in schema-defined order).
 *
 * @returns {{ synced, failed, skipped, syncedAppids: number[] }}
 */
export async function syncAchievements({ force = false, onProgress, scrapeFn = scrapeAchievementSchema } = {}) {
    if (_syncAchievementsRunning) {
        logger.info('[steam] Achievement sync already in progress — skipping concurrent call');
        return { synced: 0, failed: 0, skipped: 0, syncedAppids: [] };
    }
    _syncAchievementsRunning = true;
    try {
        return await _syncAchievementsImpl({ force, onProgress, scrapeFn });
    } finally {
        _syncAchievementsRunning = false;
    }
}

async function _syncAchievementsImpl({ force, onProgress, scrapeFn }) {
    const apiKey  = process.env.STEAM_API_KEY;
    const steamId = process.env.STEAM_ID;
    if (!apiKey)  throw new Error('STEAM_API_KEY is not set');
    if (!steamId) throw new Error('STEAM_ID is not set');

    const gamesData = await getGames();

    // Include played games AND any game Steam says has community achievement stats
    const candidates = (gamesData.games ?? []).filter(
        (g) => g.playtime_forever >= MIN_PLAYTIME || g.has_community_visible_stats === true
    );

    if (candidates.length === 0) {
        logger.info('[steam] No candidate games found — achievements sync skipped');
        return { synced: 0, failed: 0, skipped: 0, syncedAppids: [] };
    }

    // Always refresh the game being actively played. Steam freezes both
    // rtime_last_played and playtime during a live session, so the delta gate
    // below would skip the one game whose achievements the user most wants to
    // see update mid-session. Prefer the persisted open session (stable across
    // now-playing poll flaps and relay restarts); fall back to the in-memory
    // now-playing state. Lazy imports avoid a static circular dependency
    // (both modules import from this one).
    let activeAppid = null;
    let activeName  = null;
    try {
        const { getOpenSession } = await import('./play-log.service.js');
        const open = await getOpenSession();
        if (open?.appid != null) { activeAppid = Number(open.appid); activeName = open.name ?? null; }
    } catch { /* ignore */ }
    // Wave 4 (fold-in): the relay falls back to the in-memory now-playing poller
    // state when no persisted open session exists. now-playing.service.js is not
    // ported yet (Wave 4), so the fallback is disabled — restore verbatim when
    // the poller ports:
    //     if (activeAppid == null) {
    //         try {
    //             const { get: getNowPlaying } = await import('./now-playing.service.js');
    //             const playing = getNowPlaying().playing;
    //             if (playing?.appid != null) { activeAppid = Number(playing.appid); activeName = playing.name ?? null; }
    //         } catch { /* now-playing unavailable — ignore */ }
    //     }

    const toFetch = force
        ? candidates
        : candidates.filter((g) => {
            if (activeAppid != null && Number(g.appid) === activeAppid) return true;
            const entry = _achCache.get(String(g.appid));
            if (!entry?.fetchedAt)           return true;
            if (_needsRepair(entry))         return true;
            // Games confirmed to have no achievements: recheck monthly, not every 6 hours.
            if (entry.achievements?.length === 0) return !cacheIsFresh(entry.fetchedAt, NO_ACH_TTL_MS);
            // TTL gate must come before _needsPlayerData — otherwise games where the player
            // stats API permanently returns 403/400 get re-queued on every 30-min tick.
            if (cacheIsFresh(entry.fetchedAt, ACHIEVEMENTS_TTL_MS)) return false;
            if (_needsPlayerData(entry, g))  return true;
            const lastPlayed  = (g.rtime_last_played ?? 0) * 1_000;
            const lastFetched = new Date(entry.fetchedAt).getTime();
            return lastPlayed > lastFetched;
        });

    // The active game may not even be in `candidates` (Steam can report 0
    // playtime / no community-stats flag mid-session), so force-inclusion via
    // the filter above isn't enough — add it explicitly if still missing.
    if (activeAppid != null && !toFetch.some((g) => Number(g.appid) === activeAppid)) {
        const known = candidates.find((g) => Number(g.appid) === activeAppid);
        toFetch.push(known ?? { appid: activeAppid, name: activeName ?? String(activeAppid) });
    }

    logger.info('[steam] Achievements sync queued', {
        candidates: candidates.length,
        queued:     toFetch.length,
        skipped:    candidates.length - toFetch.length,
        activeAppid,
    });

    let synced       = 0;
    let failed       = 0;
    const syncedAppids = [];

    await processBatch(
        toFetch,
        async (game, idx) => {
            const progress = `[${idx + 1}/${toFetch.length}]`;
            try {
                const snapshot      = _achCache.get(String(game.appid));
                const playerDataOnly =
                    (snapshot?.achievements?.length ?? 0) > 0 &&
                    snapshot?.hasPlayerData === false;

                // ── 1. Schema (drives the full achievement list) ───────────────
                // Skipped in player-data-only mode — schema is already cached.
                let schemaAchs = [];
                let scraped    = [];

                if (!playerDataOnly) {
                    try {
                        schemaAchs = await fetchAchievementSchema(apiKey, game.appid);
                    } catch { /* fall through to scraper */ }

                    if (schemaAchs.length === 0) {
                        scraped = await scrapeFn(game.appid);
                        if (scraped.length > 0) {
                            logger.info('[steam] Using community-page fallback for schema', {
                                appid: game.appid, name: game.name, scraped: scraped.length,
                            });
                        }
                    }

                    if (schemaAchs.length === 0 && scraped.length === 0) {
                        logger.debug(`[steam] Achievement sync ${progress} SKIP ${game.name} — no schema`);
                        await _writeGameAchievements(game.appid, {
                            fetchedAt: new Date().toISOString(), gameName: game.name,
                            achievements: [], hasPlayerData: false,
                        });
                        return true;
                    }
                }

                // ── 2. Player progress (403/400 not fatal — show schema anyway) ─
                let playerMap = {};
                let playerDataBlocked = false;
                try {
                    const stats = await fetchAchievements(apiKey, steamId, game.appid);
                    for (const a of stats.achievements ?? []) playerMap[a.apiname] = a;
                } catch (playerErr) {
                    const code = playerErr.message.match(/\b(400|403)\b/)?.[1];
                    if (!code) throw playerErr;
                    playerDataBlocked = true;
                    logger.debug(`[steam] Achievement sync ${progress} player data unavailable (${code}) — ${game.name}`);
                }

                const hasPlayerData = Object.keys(playerMap).length > 0;

                // Data-integrity fallback for the merge paths below: prefer fresh
                // player data, then the prior stored value, and only then 0 — so a
                // blocked API (400/403, most often a temporarily private Steam
                // profile) or a flaky response can never downgrade a real unlock
                // back to locked. The schema list + playerDataBlocked flag are
                // still written (so the UI shows the list and the re-queue logic
                // works); only the achieved/unlocktime values are protected.
                const priorAch = {};
                for (const a of snapshot?.achievements ?? []) priorAch[a.apiname] = a;

                // ── 3. Merge ──────────────────────────────────────────────────
                let merged;
                if (playerDataOnly) {
                    // Fast path: schema already stored — just patch achieved/unlocktime.
                    // No GetSchemaForGame call needed, halves API usage for fill passes.
                    merged = snapshot.achievements.map((ach) => ({
                        ...ach,
                        achieved:   playerMap[ach.apiname]?.achieved   ?? ach.achieved,
                        unlocktime: playerMap[ach.apiname]?.unlocktime ?? ach.unlocktime,
                    }));
                } else if (schemaAchs.length > 0) {
                    // Schema-driven: full list, player progress overlaid by apiname.
                    merged = schemaAchs.map((s) => {
                        const p = playerMap[s.name] ?? {};
                        return {
                            apiname:     s.name,
                            displayName: s.displayName ?? null,
                            description: s.description ?? null,
                            icon:        s.icon        ?? null,
                            icongray:    s.icongray    ?? null,
                            hidden:      s.hidden      ?? 0,
                            achieved:    p.achieved    ?? priorAch[s.name]?.achieved   ?? 0,
                            unlocktime:  p.unlocktime  ?? priorAch[s.name]?.unlocktime ?? 0,
                        };
                    });
                } else {
                    // Scraper-driven: positional join (both sources use schema order).
                    const playerArr = Object.values(playerMap);
                    merged = scraped.map((s, i) => {
                        const p = playerArr[i] ?? {};
                        const prior = snapshot?.achievements?.[i] ?? {};   // positional preserve
                        return {
                            apiname:     p.apiname     ?? prior.apiname ?? `ach_${i}`,
                            displayName: s.displayName ?? null,
                            description: s.description ?? null,
                            icon:        s.icon        ?? null,
                            icongray:    null,
                            hidden:      0,
                            achieved:    p.achieved    ?? prior.achieved   ?? 0,
                            unlocktime:  p.unlocktime  ?? prior.unlocktime ?? 0,
                        };
                    });
                }

                await _writeGameAchievements(game.appid, {
                    fetchedAt:        new Date().toISOString(),
                    gameName:         game.name,
                    achievements:     merged,
                    hasPlayerData,
                    playerDataBlocked,
                });
                synced++;
                syncedAppids.push(game.appid);
                const source = playerDataOnly ? 'player-fill'
                             : schemaAchs.length > 0 ? 'api' : 'scraper';
                logger.info(`[steam] Achievement sync ${progress} OK   ${game.name}`, {
                    appid: game.appid, achievements: merged.length, source, playerData: hasPlayerData,
                });
                return true;
            } catch (err) {
                logger.warn(`[steam] Achievement sync ${progress} FAIL ${game.name}`, {
                    appid: game.appid, err: err.message,
                });
                failed++;
                return true;
            }
        },
        { requestsPerSecond: 0.5, jitterMs: 1_000, onProgress }
    );

    logger.info('[steam] Achievements sync complete', {
        synced, failed, skipped: candidates.length - toFetch.length,
    });
    return { synced, failed, skipped: candidates.length - toFetch.length, syncedAppids };
}

async function _writeGameAchievements(appid, entry) {
    const gf = makeAchFile(appid);
    await gf.load();
    await gf.set(entry);
    await gf.flush();
    await gf.close();
    _achCache.set(String(appid), entry);
}

/**
 * Full repair pass — re-syncs every game that is missing metadata or has never
 * been fetched (including zero-playtime games with community stats), then
 * immediately downloads achievement icons for all newly synced games.
 *
 * Safe to call at any time; already-complete entries are skipped by the
 * normal delta logic inside syncAchievements.
 */
export async function repairAchievements({ onProgress } = {}) {
    const { syncAchievementImages } = await import('./images.service.js');
    const result = await syncAchievements({ force: false, onProgress });
    if (result.syncedAppids.length > 0) {
        logger.info('[steam] Downloading images for repaired achievements', {
            games: result.syncedAppids.length,
        });
        await syncAchievementImages({ appids: result.syncedAppids });
    }
    return result;
}

const _RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

function _localAchPath(appid, apiname, variant, cdnUrl) {
    if (!cdnUrl) return null;
    let safeName = apiname
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
        .replace(/[. ]+$/, '_');
    if (_RESERVED.test(safeName)) safeName = `_${safeName}`;
    const segment = cdnUrl.split('/').pop();
    return `/relay/images/steam/achievements/${appid}/${safeName}_${variant}_${segment}`;
}

export function getAchievements() {
    const result = {};
    for (const [appid, entry] of _achCache) {
        result[appid] = {
            ...entry,
            achievements: (entry.achievements ?? []).map(ach => ({
                ...ach,
                localIcon:     _localAchPath(appid, ach.apiname, 'color', ach.icon),
                localIconGray: _localAchPath(appid, ach.apiname, 'gray',  ach.icongray),
            })),
        };
    }
    return result;
}

// ── Recently played ───────────────────────────────────────────────────────────

export async function syncRecentlyPlayed({ force = false } = {}) {
    const apiKey = process.env.STEAM_API_KEY;
    const steamId = process.env.STEAM_ID;
    if (!apiKey) throw new Error('STEAM_API_KEY is not set');
    if (!steamId) throw new Error('STEAM_ID is not set');

    const file = await _loadRecentlyPlayedFile();
    const cached = file.get();

    if (!force && cacheIsFresh(cached.fetchedAt, RECENT_PLAYED_TTL_MS)) {
        const ageMin = Math.round((Date.now() - new Date(cached.fetchedAt).getTime()) / 60_000);
        logger.info('[steam] Recently-played cache is fresh — skipping sync', { ageMin });
        return cached;
    }

    logger.info('[steam] Syncing recently played from Steam API');

    const url = new URL(`${STEAM_API}/IPlayerService/GetRecentlyPlayedGames/v1/`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('steamid', steamId);
    url.searchParams.set('count', '0');
    url.searchParams.set('format', 'json');

    const res = await steamFetch(url.toString());
    const body = await res.json();
    const raw = body.response ?? {};

    const next = {
        fetchedAt: new Date().toISOString(),
        totalCount: raw.total_count ?? 0,
        games: raw.games ?? [],
    };

    await file.set(next);
    await file.flush();

    logger.info('[steam] Recently-played sync complete', { count: next.games.length });
    return next;
}

export async function getRecentlyPlayed() {
    return (await _loadRecentlyPlayedFile()).get();
}

// ── Wishlist ──────────────────────────────────────────────────────────────────

async function fetchWishlist(apiKey, steamId) {
    const url = new URL(`${STEAM_API}/IWishlistService/GetWishlist/v1/`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('steamid', steamId);

    const res  = await steamFetch(url.toString());
    const body = await res.json();
    return body.response?.items ?? [];
}

export async function syncWishlist({ force = false } = {}) {
    const apiKey  = process.env.STEAM_API_KEY;
    const steamId = process.env.STEAM_ID;
    if (!apiKey)  throw new Error('STEAM_API_KEY is not set');
    if (!steamId) throw new Error('STEAM_ID is not set');

    const file = await _loadWishlistFile();
    const cached = file.get();

    if (!force && cacheIsFresh(cached.fetchedAt, WISHLIST_TTL_MS)) {
        const ageMin = Math.round((Date.now() - new Date(cached.fetchedAt).getTime()) / 60_000);
        logger.info('[steam] Wishlist cache is fresh — skipping sync', { ageMin });
        return cached;
    }

    logger.info('[steam] Syncing wishlist from Steam Web API');

    const rawItems = await fetchWishlist(apiKey, steamId);

    const items = {};
    for (const item of rawItems) {
        items[item.appid] = {
            priority:   item.priority,
            date_added: item.date_added,
        };
    }

    const next = {
        fetchedAt: new Date().toISOString(),
        itemCount: rawItems.length,
        items,
    };

    await file.set(next);
    await file.flush();

    logger.info('[steam] Wishlist sync complete', { itemCount: next.itemCount });
    return next;
}

export async function getWishlist() {
    return (await _loadWishlistFile()).get();
}

// ── Reviews ───────────────────────────────────────────────────────────────────

async function findUserReview(steamId, appId) {
    let cursor = '*';

    for (let page = 0; page < MAX_REVIEW_SEARCH_PAGES; page++) {
        const url = new URL(`${STORE_API}/appreviews/${appId}`);
        url.searchParams.set('json', '1');
        url.searchParams.set('filter', 'all');
        url.searchParams.set('language', 'all');
        url.searchParams.set('review_type', 'all');
        url.searchParams.set('purchase_type', 'all');
        url.searchParams.set('cursor', cursor);
        url.searchParams.set('num_per_page', '100');
        url.searchParams.set('filter_offtopic_activity', '0');

        const res = await steamFetch(url.toString());
        const body = await res.json();

        if (body.success !== 1) break;

        const reviews = body.reviews ?? [];
        const mine = reviews.find((r) => r.author?.steamid === steamId);
        if (mine) return mine;

        if (reviews.length < 100 || !body.cursor || body.cursor === cursor) break;
        cursor = body.cursor;

        await new Promise((r) => setTimeout(r, 1_000));
    }

    return null;
}

export async function syncReviews({ force = false, onProgress } = {}) {
    const apiKey = process.env.STEAM_API_KEY;
    const steamId = process.env.STEAM_ID;
    if (!apiKey) throw new Error('STEAM_API_KEY is not set');
    if (!steamId) throw new Error('STEAM_ID is not set');

    const gamesData = await getGames();
    const playedGames = (gamesData.games ?? []).filter((g) => g.playtime_forever >= MIN_PLAYTIME);

    const reviewFile = await _loadReviewsFile();
    const cache = reviewFile.get();

    const toCheck = force
        ? playedGames
        : playedGames.filter((g) => {
            const entry = cache[g.appid];
            if (!entry?.fetchedAt) return true;
            // No review found: recheck monthly rather than every tick
            if (entry.review === null) return !cacheIsFresh(entry.fetchedAt, NULL_REVIEW_TTL_MS);
            const lastPlayed = g.rtime_last_played * 1_000;
            const lastChecked = new Date(entry.fetchedAt).getTime();
            return lastPlayed > lastChecked;
        });

    logger.info('[steam] Reviews sync queued', {
        played: playedGames.length,
        queued: toCheck.length,
        skipped: playedGames.length - toCheck.length,
    });

    let found = 0;
    let notFound = 0;
    let failed = 0;
    const updates = {};

    await processBatch(
        toCheck,
        async (game) => {
            try {
                const review = await findUserReview(steamId, game.appid);
                const existing = cache[game.appid];
                updates[game.appid] = {
                    ...(existing?._scraperTs != null ? { _scraperTs: existing._scraperTs } : {}),
                    fetchedAt: new Date().toISOString(),
                    gameName: game.name,
                    review: review ?? null,
                };
                review ? found++ : notFound++;
            } catch (err) {
                logger.warn('[steam] Review fetch failed', { appid: game.appid, name: game.name, err: err.message });
                failed++;
            }
            return true;
        },
        { requestsPerSecond: 1, onProgress }
    );

    if (Object.keys(updates).length > 0) {
        await reviewFile.set({ ...reviewFile.get(), ...updates });
        await reviewFile.flush();
    }

    logger.info('[steam] Reviews sync complete', { found, notFound, failed, skipped: playedGames.length - toCheck.length });
    return { found, notFound, failed, skipped: playedGames.length - toCheck.length };
}

export function getAchievementsForGame(appid) {
    const entry = _achCache.get(String(appid));
    if (!entry) return null;
    return {
        ...entry,
        achievements: (entry.achievements ?? []).map(ach => ({
            ...ach,
            localIcon:     _localAchPath(appid, ach.apiname, 'color', ach.icon),
            localIconGray: _localAchPath(appid, ach.apiname, 'gray',  ach.icongray),
        })),
    };
}

export async function getReviews() {
    return (await _loadReviewsFile()).get();
}

// ── Review scan (dedicated — exhaustive search across all played games) ────────

async function findUserReviewExhaustive(steamId, appId) {
    let cursor = '*';

    // No page cap — keep going until we find the review or exhaust all pages.
    // Safety ceiling: 50 pages × 100 reviews = 5,000 reviews checked per game.
    for (let page = 0; page < 50; page++) {
        const url = new URL(`${STORE_API}/appreviews/${appId}`);
        url.searchParams.set('json', '1');
        url.searchParams.set('filter', 'all');
        url.searchParams.set('language', 'all');
        url.searchParams.set('review_type', 'all');
        url.searchParams.set('purchase_type', 'all');
        url.searchParams.set('cursor', cursor);
        url.searchParams.set('num_per_page', '100');
        url.searchParams.set('filter_offtopic_activity', '0');

        const res  = await steamFetch(url.toString());
        const body = await res.json();

        if (body.success !== 1) break;

        const reviews = body.reviews ?? [];
        const mine    = reviews.find((r) => r.author?.steamid === steamId);
        if (mine) return mine;

        // No more pages
        if (reviews.length < 100 || !body.cursor || body.cursor === cursor) break;
        cursor = body.cursor;

        await new Promise((r) => setTimeout(r, 1_000));
    }

    return null;
}

export async function scanReviews({ force = false, onProgress } = {}) {
    const apiKey  = process.env.STEAM_API_KEY;
    const steamId = process.env.STEAM_ID;
    if (!apiKey)  throw new Error('STEAM_API_KEY is not set');
    if (!steamId) throw new Error('STEAM_ID is not set');

    const gamesData  = await getGames();
    const playedGames = (gamesData.games ?? []).filter((g) => g.playtime_forever >= MIN_PLAYTIME);

    const reviewFile = await _loadReviewsFile();
    const cache = reviewFile.get();

    const alreadyFound = Object.values(cache).filter((e) => e?.review != null).length;

    const toCheck = force
        ? playedGames
        : playedGames.filter((g) => {
            const entry = cache[g.appid];
            // Already have a review cached — no need to re-scan
            if (entry?.review != null) return false;
            // Never checked — include
            if (!entry?.fetchedAt) return true;
            // Checked before, no review found — only retry if played since last check
            const lastPlayed  = g.rtime_last_played * 1_000;
            const lastChecked = new Date(entry.fetchedAt).getTime();
            return lastPlayed > lastChecked;
        });

    logger.info('[steam] Reviews scan queued', {
        played:       playedGames.length,
        alreadyFound,
        queued:       toCheck.length,
        skipped:      playedGames.length - toCheck.length,
    });

    let found    = 0;
    let notFound = 0;
    let failed   = 0;

    await processBatch(
        toCheck,
        async (game, idx) => {
            const progress = `${idx + 1}/${toCheck.length}`;
            try {
                const review  = await findUserReviewExhaustive(steamId, game.appid);
                const updated = reviewFile.get();
                await reviewFile.set({
                    ...updated,
                    [game.appid]: {
                        fetchedAt: new Date().toISOString(),
                        gameName:  game.name,
                        review:    review ?? null,
                    },
                });
                if (review) {
                    found++;
                    logger.info(`[steam] Review scan [${progress}] FOUND     ${game.name}`);
                } else {
                    notFound++;
                    logger.info(`[steam] Review scan [${progress}] not found ${game.name}`);
                }
            } catch (err) {
                failed++;
                logger.warn(`[steam] Review scan [${progress}] FAILED    ${game.name} — ${err.message}`);
            }
            return true;
        },
        { requestsPerSecond: 1, onProgress }
    );

    await reviewFile.flush();

    const totalFound = alreadyFound + found;

    logger.info('[steam] Reviews scan complete', { found, notFound, failed, totalFound, skipped: playedGames.length - toCheck.length });
    return { found, notFound, failed, skipped: playedGames.length - toCheck.length, totalFound };
}

export async function getReview(appid) {
    const all = await getReviews();
    return all[appid] ?? all[Number(appid)] ?? null;
}
