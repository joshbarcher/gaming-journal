import path from 'node:path';
import fs from 'node:fs/promises';
import logger from '../../logger.js';
import { mapChunked } from '../shared/map-chunked.js';
import { rateLimitSleep } from '../shared/rate-limit.js';
import { getAllGames } from '../shared/getAllGames.js';
import { rebuild } from '../shared/cache-manager.js';
import { featureDir } from '../shared/data-root.js';
import { tracked } from '../metrics/tracked.js';

const HLTB_BASE     = 'https://howlongtobeat.com';
const HLTB_UA       = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0';
const IMAGE_BASE    = `${HLTB_BASE}/games/`;
const MIN_SIMILARITY = 0.4;
const HLTB_MIN_MS = 3_000;
const HLTB_MAX_MS = 6_000;

function hltbDir()      { return featureDir('hltb'); }
function entryPath(id)  { return path.join(hltbDir(), `${id}.json`); }
function indexPath()    { return path.join(hltbDir(), 'index.json'); }

// Strip trademark/copyright symbols and punctuation that can break HLTB search terms
function cleanSearchName(name) {
    return name
        .replace(/[®©™]/g, '')       // trademark symbols
        .replace(/[^\w\s]/g, ' ')    // punctuation (colons, hyphens, etc.) → space
        .replace(/\s+/g, ' ')
        .trim();
}

// Dice-coefficient bigram similarity (0–1)
function similarity(a, b) {
    const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, '');
    const s1 = norm(a), s2 = norm(b);
    if (s1 === s2) return 1;
    const bigrams = s => { const bg = new Set(); for (let i = 0; i < s.length - 1; i++) bg.add(s.slice(i, i + 2)); return bg; };
    const b1 = bigrams(s1), b2 = bigrams(s2);
    const hits = [...b1].filter(bg => b2.has(bg)).length;
    return b1.size + b2.size === 0 ? 0 : (2 * hits) / (b1.size + b2.size);
}

async function getAuthToken() {
    const res = await fetch(`${HLTB_BASE}/api/bleed/init?t=${Date.now()}`, {
        headers: { 'User-Agent': HLTB_UA, 'Origin': HLTB_BASE, 'Referer': `${HLTB_BASE}/` },
    });
    if (!res.ok) throw new Error(`HLTB init failed: ${res.status}`);
    return res.json();
}

async function defaultSearch(name) {
    const { token, hpKey, hpVal } = await getAuthToken();
    const res = await fetch(`${HLTB_BASE}/api/bleed`, {
        method: 'POST',
        headers: {
            'User-Agent': HLTB_UA,
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': `${HLTB_BASE}/?q=${encodeURIComponent(name)}`,
            'Content-Type': 'application/json',
            'x-auth-token': token,
            'x-hp-key': hpKey,
            'x-hp-val': hpVal,
            'Origin': HLTB_BASE,
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
        },
        body: JSON.stringify({
            searchType: 'games',
            searchTerms: name.split(' '),
            searchPage: 1,
            size: 20,
            searchOptions: {
                games: { userId: 0, platform: '', sortCategory: 'popular', rangeCategory: 'main', rangeTime: { min: null, max: null }, gameplay: { perspective: '', flow: '', genre: '', difficulty: '' }, rangeYear: { min: '', max: '' }, modifier: '' },
                users: { sortCategory: 'postcount' },
                lists: { sortCategory: 'follows' },
                filter: '', sort: 0, randomizer: 0,
            },
            useCache: false,
            [hpKey]: hpVal,
        }),
    });
    if (!res.ok) throw new Error(`HLTB search failed: ${res.status}`);
    const body = await res.json();
    return body.data ?? [];
}

// results are raw HLTB API entries: { game_id, game_name, comp_main, comp_plus, comp_100, game_image, profile_steam, … }
function pickBestMatch(results, query, appid = null) {
    if (!results || results.length === 0) return null;

    // Prefer an exact Steam appid hit — HLTB returns profile_steam on many entries
    if (appid) {
        const exact = results.find(r => Number(r.profile_steam) === Number(appid));
        if (exact) return { ...exact, _sim: 1.0 };
    }

    // Fall back to name similarity
    const scored = results.map(r => ({ ...r, _sim: similarity(query, r.game_name) }));
    const best = scored.reduce((a, b) => (b._sim > a._sim ? b : a));
    return best._sim >= MIN_SIMILARITY ? best : null;
}

export async function getEntry(appid) {
    try { return JSON.parse(await fs.readFile(entryPath(appid), 'utf8')); }
    catch { return null; }
}

export async function getIndex() {
    try { return JSON.parse(await fs.readFile(indexPath(), 'utf8')); }
    catch { return []; }
}

async function rebuildIndex() {
    let files;
    try { files = await fs.readdir(hltbDir()); } catch { return []; }

    const eligible = files.filter((f) => f !== 'index.json' && f.endsWith('.json'));
    const raws     = await mapChunked(eligible, f => fs.readFile(path.join(hltbDir(), f), 'utf8').catch(() => null));

    const index = [];
    for (const raw of raws) {
        if (!raw) continue;
        try {
            const entry = JSON.parse(raw);
            if (entry.matched) {
                index.push({
                    appid:                 entry.appid,
                    steamName:             entry.steamName,
                    matchedName:           entry.matchedName,
                    confidence:            entry.confidence,
                    hltbId:                entry.hltbId,
                    gameplayMain:          entry.gameplayMain,
                    gameplayMainExtra:     entry.gameplayMainExtra,
                    gameplayCompletionist: entry.gameplayCompletionist,
                });
            }
        } catch { /* skip malformed */ }
    }

    await fs.writeFile(indexPath(), JSON.stringify(index, null, 2));
    return index;
}

// Exponential backoff for unmatched entries.
// Base: 30 min. Doubles each attempt, capped at 7 days.
// Attempt 1→30 min, 2→1 hr, 3→2 hr, 4→4 hr, 5→8 hr, 6→16 hr, 7→~32 hr, 8+→7 days
const BACKOFF_BASE_MS = 30 * 60 * 1000;
const BACKOFF_MAX_MS  =  7 * 24 * 60 * 60 * 1000;

function _nextRetryAt(attemptCount) {
    const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, attemptCount - 1), BACKOFF_MAX_MS);
    return new Date(Date.now() + delay).toISOString();
}

/**
 * @param {number|string} appid
 * @param {{ force?: boolean, searchFn?: (name: string) => Promise<any[]>, steamName?: string }} [opts]
 */
export async function syncGame(appid, { force = false, searchFn = defaultSearch, steamName } = {}) {
    // Resolve name: use provided steamName, or fall back to library lookup
    let name = steamName;
    if (!name) {
        const gamesPath = path.join(featureDir('steam'), 'games.json');
        let gamesData;
        try { gamesData = JSON.parse(await fs.readFile(gamesPath, 'utf8')); }
        catch { throw new Error('Games cache not found — run /api/steam/games/sync first'); }
        const game = (gamesData.games ?? []).find(g => g.appid === Number(appid));
        if (!game) throw new Error(`App ${appid} not found in Steam library`);
        name = game.name;
    }

    await fs.mkdir(hltbDir(), { recursive: true });
    const dest = entryPath(Number(appid));

    // Read existing entry to preserve retry state
    let existing = null;
    try { existing = JSON.parse(await fs.readFile(dest, 'utf8')); } catch { /* not cached */ }

    // Skip only when the entry is already matched AND has real completion times.
    // "matched with all-zero times" means HLTB found the game but times hadn't been
    // submitted yet — treat the same as unmatched so we keep retrying.
    const existingHasTimes = existing?.matched &&
        !!(existing.gameplayMain || existing.gameplayMainExtra || existing.gameplayCompletionist);
    if (!force && existingHasTimes) return { skipped: true, entry: existing };

    const results = await searchFn(cleanSearchName(name));

    // A 200-but-empty search result (a transient HLTB hiccup) must not wipe good
    // completion times we already have. Preserve the existing matched entry. A
    // THROWN search error never reaches here — it propagates to the caller, which
    // already leaves the entry untouched.
    if ((!results || results.length === 0) && existingHasTimes) {
        logger.warn('[hltb] Empty search result — keeping cached times', { appid, name });
        return { skipped: true, entry: existing };
    }

    const match   = pickBestMatch(results, name, Number(appid));

    const hasTimes = !!(match?.comp_main || match?.comp_plus || match?.comp_100);
    const resolved = match && hasTimes;           // truly done — matched AND has times
    const retryCount = resolved ? 0 : (existing?.retryCount ?? 0) + 1;

    const entry = {
        appid:                 Number(appid),
        steamName:             name,
        fetchedAt:             new Date().toISOString(),
        matched:               match !== null,
        matchedName:           match?.game_name          ?? null,
        confidence:            match?._sim               ?? 0,
        hltbId:                match?.game_id            ?? null,
        gameplayMain:          match ? match.comp_main  / 3600 : null,
        gameplayMainExtra:     match ? match.comp_plus  / 3600 : null,
        gameplayCompletionist: match ? match.comp_100   / 3600 : null,
        imageUrl:              match?.game_image ? IMAGE_BASE + match.game_image : null,
        // Retry tracking — cleared only when matched AND has real times
        retryCount:            retryCount,
        nextRetryAt:           resolved ? null : _nextRetryAt(retryCount),
    };

    await fs.writeFile(dest, JSON.stringify(entry, null, 2));
    await rebuildIndex();
    return { skipped: false, entry };
}

/**
 * Bulk-sync HLTB completion times for all owned Steam games.
 *
 * @param {object}   [opts]
 * @param {boolean}  [opts.force=false]   - Re-fetch even if cached.
 * @param {Function} [opts.searchFn]      - Override search for testing.
 * @param {Function} [opts.onProgress]    - Called as (done, total) after each game.
 */
export async function syncAll({ force = false, searchFn = defaultSearch, onProgress } = {}) {
    const games = await getAllGames();
    if (games.length === 0) throw new Error('No games found — run Steam sync first');
    await fs.mkdir(hltbDir(), { recursive: true });

    let fetched = 0, skipped = 0, noMatch = 0, failed = 0;

    for (let i = 0; i < games.length; i++) {
        const game = games[i];
        const dest = entryPath(game.appid);

        // Read existing entry to check skip conditions and preserve retry state.
        let existing = null;
        try { existing = JSON.parse(await fs.readFile(dest, 'utf8')); } catch { /* not cached yet */ }

        if (!force && existing) {
            // Skip fully matched games.
            if (existing.matched) { skipped++; if (onProgress) onProgress(i + 1, games.length); continue; }
            // Respect exponential backoff for unmatched games.
            if (existing.nextRetryAt && new Date(existing.nextRetryAt).getTime() > Date.now()) {
                skipped++; if (onProgress) onProgress(i + 1, games.length); continue;
            }
        }

        try {
            const results = await searchFn(cleanSearchName(game.name));
            const match   = pickBestMatch(results, game.name, game.appid);

            const hasTimes   = !!(match?.comp_main || match?.comp_plus || match?.comp_100);

            // Same protection as syncGame (line ~193): a force refresh that comes back empty,
            // match-less, or time-less must not null out completion times we already have.
            const existingHasTimes = !!(existing?.gameplayMain || existing?.gameplayMainExtra || existing?.gameplayCompletionist);
            if (!hasTimes && existingHasTimes) {
                logger.warn('[hltb] Force refresh returned no usable times — keeping cached', { appid: game.appid, name: game.name });
                skipped++; if (onProgress) onProgress(i + 1, games.length); continue;
            }

            const resolved   = match && hasTimes;
            const retryCount = resolved ? 0 : (existing?.retryCount ?? 0) + 1;

            const entry = {
                appid:                 game.appid,
                steamName:             game.name,
                fetchedAt:             new Date().toISOString(),
                matched:               match !== null,
                matchedName:           match?.game_name          ?? null,
                confidence:            match?._sim               ?? 0,
                hltbId:                match?.game_id            ?? null,
                gameplayMain:          match ? match.comp_main  / 3600 : null,
                gameplayMainExtra:     match ? match.comp_plus  / 3600 : null,
                gameplayCompletionist: match ? match.comp_100   / 3600 : null,
                imageUrl:              match?.game_image ? IMAGE_BASE + match.game_image : null,
                retryCount,
                nextRetryAt:           resolved ? null : _nextRetryAt(retryCount),
            };

            await fs.writeFile(dest, JSON.stringify(entry, null, 2));
            match ? fetched++ : noMatch++;
        } catch (err) {
            logger.warn('[hltb] Search failed', { appid: game.appid, name: game.name, err: err.message });
            failed++;
        }

        if (onProgress) onProgress(i + 1, games.length);
        if (i < games.length - 1) {
            const delay = HLTB_MIN_MS + Math.random() * (HLTB_MAX_MS - HLTB_MIN_MS);
            await rateLimitSleep(delay);
        }
    }

    await rebuildIndex();
    logger.info('[hltb] Sync complete', { fetched, skipped, noMatch, failed, total: games.length });
    return { fetched, skipped, noMatch, failed, total: games.length };
}

// ── Periodic retry scheduler ──────────────────────────────────────────────────
//
// Runs every 30 minutes and retries unmatched games using exponential backoff
// so games that genuinely have no HLTB page don't get hammered forever:
//
//   Attempt  1 →  30 min
//   Attempt  2 →   1 hr
//   Attempt  3 →   2 hr
//   Attempt  4 →   4 hr
//   Attempt  5 →   8 hr
//   Attempt  6 →  16 hr
//   Attempt  7 →  ~32 hr
//   Attempt  8+ →   7 days  (max — checked weekly thereafter)
//
// Each tick only processes games whose nextRetryAt is in the past.

const RETRY_INTERVAL_MS = 30 * 60 * 1000; // how often the scheduler wakes up

async function _retryUnmatched() {
    const now   = Date.now();
    const games = await getAllGames();

    const pending = [];
    let snoozed = 0;
    for (const game of games) {
        const entry = await getEntry(game.appid);
        const hasTimes = entry?.matched &&
            !!(entry.gameplayMain || entry.gameplayMainExtra || entry.gameplayCompletionist);

        if (hasTimes) {
            continue; // fully resolved — skip
        }

        // Needs a retry: never fetched, unmatched, or matched-but-no-times
        const nextRetry = entry?.nextRetryAt ? new Date(entry.nextRetryAt).getTime() : 0;
        if (now >= nextRetry) {
            pending.push(game);
        } else {
            snoozed++;
        }
    }

    if (!pending.length) {
        logger.info('[hltb] Retry scheduler: nothing due', { snoozed });
        return { fetched: 0, skipped: snoozed, failed: 0, total: 0 };
    }

    logger.info('[hltb] Retry scheduler: processing due games', { due: pending.length, snoozed });
    let matched = 0, failed = 0;

    for (let i = 0; i < pending.length; i++) {
        const game = pending[i];
        try {
            const result = await syncGame(game.appid, { steamName: game.name });
            if (!result.skipped && result.entry?.matched) {
                matched++;
                logger.info('[hltb] Retry scheduler: matched', { appid: game.appid, name: game.name });
            } else if (!result.skipped) {
                const attempt = result.entry?.retryCount ?? '?';
                const next    = result.entry?.nextRetryAt ?? 'unknown';
                logger.info('[hltb] Retry scheduler: still no match, backing off',
                    { appid: game.appid, attempt, nextRetryAt: next });
            }
        } catch (err) {
            failed++;
            logger.warn('[hltb] Retry scheduler: sync failed', { appid: game.appid, err: err.message });
        }
        if (i < pending.length - 1) {
            const delay = HLTB_MIN_MS + Math.random() * (HLTB_MAX_MS - HLTB_MIN_MS);
            await new Promise(r => setTimeout(r, delay));
        }
    }

    if (matched > 0) {
        await rebuildIndex();
        await rebuild('games');
        logger.info('[hltb] Retry scheduler: done, rebuilt games cache', { matched, due: pending.length });
    } else {
        logger.info('[hltb] Retry scheduler: done, no new matches', { due: pending.length });
    }

    // A match is a game that had no HLTB times and now does — new information.
    return { fetched: matched, created: matched, skipped: snoozed, failed, total: pending.length };
}

export function startHltbRetryScheduler() {
    const run = () => tracked('hltb', () => _retryUnmatched())
        .catch(err => logger.error('[hltb] Retry scheduler error', err));

    // First run after a short warm-up delay so the server is fully initialised
    setTimeout(run, 15_000);
    setInterval(run, RETRY_INTERVAL_MS);
    logger.info('[hltb] Retry scheduler started', { intervalMin: 30 });
}
