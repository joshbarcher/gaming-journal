// Ported verbatim from relay-server src/services/steam/store.service.js
// (docs/relay-fold-in.md §6). Import rewrites only: utility/* → ../shared/*,
// data paths via featureDir('steam') instead of path.join(DATA_DIR, 'relay', ...).
import path from 'node:path';
import fs from 'node:fs/promises';
import logger from '../../logger.js';
import { steamFetch, processBatch } from '../shared/steam-fetch.js';

import { mapChunked } from '../shared/map-chunked.js';
import { featureDir } from '../shared/data-root.js';

const STORE_API   = 'https://store.steampowered.com';
const STEAMSPY_API = 'https://steamspy.com/api.php';

const STEAMSPY_MAX_RETRIES = 4;

async function steamspyFetch(appid) {
    const url = `${STEAMSPY_API}?request=appdetails&appid=${appid}`;
    let attempt = 0;

    while (true) {
        const res = await fetch(url);

        if (res.ok) {
            const body = await res.json();
            // SteamSpy returns HTTP 200 even for unknown appids — detect empty response
            if (typeof body !== 'object' || body === null || !('appid' in body)) {
                throw new Error(`SteamSpy returned no data for appid ${appid}`);
            }
            return body;
        }

        if (attempt >= STEAMSPY_MAX_RETRIES) {
            throw new Error(`SteamSpy ${res.status} after ${attempt} retries for appid ${appid}`);
        }

        let waitMs;
        if (res.status === 429) {
            const retryAfter = res.headers.get('Retry-After');
            waitMs = retryAfter ? parseInt(retryAfter, 10) * 1_000 : 10_000;
            logger.warn('[steamspy] Rate limited', { appid, waitMs, attempt });
        } else {
            waitMs = Math.pow(2, attempt) * 1_000;
            logger.warn(`[steamspy] ${res.status} error — retrying`, { appid, waitMs, attempt });
        }

        attempt++;
        // Not rateLimitSleep: retry backoff is observed by tests that stub setTimeout.
        await new Promise(r => setTimeout(r, waitMs));
    }
}

function storeDir() {
    return path.join(featureDir('steam'), 'store');
}

function appDetailPath(appid) {
    return path.join(storeDir(), `${appid}.json`);
}

function dataDir() {
    return featureDir('steam');
}

const KEEP_FIELDS = [
    'steam_appid', 'name', 'type', 'is_free',
    'short_description', 'about_the_game', 'detailed_description',
    'developers', 'publishers',
    'price_overview',
    'platforms',
    'metacritic',
    'categories',
    'genres',
    'tags',
    'release_date',
    'recommendations',
    'content_descriptors',
    'required_age',
    'screenshots',
    'background_raw',
    'background',
    'header_image',
    'capsule_image',
];

// Core fields sufficient to consider a store entry "cached" — avoids re-fetching
// existing files just because KEEP_FIELDS grew. Run with force=true to refresh all.
const SKIP_FIELDS = ['steam_appid', 'name', 'type', 'screenshots', 'detailed_description'];

function pruneAppDetail(raw) {
    const out = {};
    for (const key of KEEP_FIELDS) {
        if (key in raw) out[key] = raw[key];
    }
    return out;
}

async function fetchAppDetail(appid) {
    const url = new URL(`${STORE_API}/api/appdetails`);
    url.searchParams.set('appids', appid);
    url.searchParams.set('format', 'json');

    const res  = await steamFetch(url.toString());
    const body = await res.json();

    const entry = body[String(appid)];
    if (!entry?.success) return null;

    return pruneAppDetail(entry.data);
}

// Distinguish "nothing worth keeping on disk" from "a good/partial entry exists".
// fetchAppDetail() returns null for BOTH a genuine missing store page and a Steam
// throttle — both answer HTTP 200 with success:false, indistinguishable in the body —
// so before stamping the {unavailable} sentinel we check whether real data is already
// cached. If so, a null is far more likely a transient throttle/403 than a real
// delisting, and we preserve the good data rather than blanking it (which would also
// freeze the entry for the 24h recheck TTL).
async function hasCachedStoreData(dest) {
    try {
        const cached = JSON.parse(await fs.readFile(dest, 'utf8'));
        return !!cached && !cached.unavailable;
    } catch {
        return false;   // no file / unreadable / sentinel → nothing good to protect
    }
}

/** @param {{ force?: boolean, onProgress?: (done: number, total: number) => void }} [opts] */
export async function syncGameDetails({ force = false, onProgress } = {}) {
    const gamesPath = path.join(dataDir(), 'games.json');
    let gamesData;
    try {
        gamesData = JSON.parse(await fs.readFile(gamesPath, 'utf8'));
    } catch {
        throw new Error('Games cache not found — run /api/steam/games/sync first');
    }

    const games = gamesData.games ?? [];
    try {
        const wishlistData = JSON.parse(await fs.readFile(path.join(dataDir(), 'wishlist.json'), 'utf8'));
        const ownedIds = new Set(games.map((g) => g.appid));
        for (const id of Object.keys(wishlistData.items ?? {})) {
            const appid = Number(id);
            if (!ownedIds.has(appid)) games.push({ appid });
        }
    } catch { /* wishlist not synced yet — owned games only */ }

    await fs.mkdir(storeDir(), { recursive: true });

    let fetched  = 0;
    let skipped  = 0;
    let noData   = 0;
    let done     = 0;

    await processBatch(
        games,
        async (game) => {
            const dest = appDetailPath(game.appid);

            if (!force) {
                try {
                    const cached = JSON.parse(await fs.readFile(dest, 'utf8'));
                    if (cached.unavailable || SKIP_FIELDS.every((k) => k in cached)) {
                        skipped++;
                        done++;
                        if (onProgress) onProgress(done, games.length);
                        return false;
                    }
                } catch { /* not cached yet — fall through */ }
            }

            const detail = await fetchAppDetail(game.appid);

            if (detail) {
                await fs.writeFile(dest, JSON.stringify(detail, null, 2));
                fetched++;
            } else if (await hasCachedStoreData(dest)) {
                // Ambiguous success:false over existing good data → almost certainly a
                // throttle. Preserve the cached entry instead of overwriting it with the
                // sentinel.
                skipped++;
            } else {
                await fs.writeFile(dest, JSON.stringify({ steam_appid: Number(game.appid), unavailable: true, fetchedAt: new Date().toISOString() }));
                noData++;
            }

            done++;
            if (onProgress) onProgress(done, games.length);
            return true;
        },
        { requestsPerSecond: 1 }
    );

    logger.info('[steam-store] Game details sync complete', {
        fetched, skipped, noData, total: games.length,
    });
    return { fetched, skipped, noData, total: games.length };
}

export async function syncOne(appid) {
    const dest = appDetailPath(appid);
    try {
        const cached = JSON.parse(await fs.readFile(dest, 'utf8'));
        // Sentinel: Steam previously returned no data for this app — don't retry
        if (cached.unavailable) return null;
        if (SKIP_FIELDS.every((k) => k in cached)) {
            // Fully cached but may be missing tags — patch them in cheaply
            if (!cached.tags || Object.keys(cached.tags).length === 0) {
                try {
                    const spy  = await steamspyFetch(appid);
                    const tags = spy.tags;
                    if (tags && typeof tags === 'object' && Object.keys(tags).length > 0) {
                        cached.tags = tags;
                        await fs.writeFile(dest, JSON.stringify(cached, null, 2), 'utf8');
                    }
                } catch { /* non-fatal — tags will arrive on next sync */ }
            }
            return cached;
        }
    } catch { /* not cached */ }
    let detail;
    try {
        detail = await fetchAppDetail(appid);
    } catch (err) {
        // steamFetch throws on non-retryable statuses (e.g. 403) — treat the same as
        // "Steam returned no data" rather than letting it become an unhandled rejection
        // that crashes the whole process (this is an async Express handler with no
        // caller-side try/catch).
        logger.warn('[steam-store] appdetails fetch failed', { appid, err: err.message });
        detail = null;
    }
    if (detail) {
        await fs.mkdir(storeDir(), { recursive: true });
        await fs.writeFile(dest, JSON.stringify(detail, null, 2));
    } else if (!(await hasCachedStoreData(dest))) {
        // Steam returned no data AND nothing good is cached — write the sentinel so we
        // don't retry on every backfill. If good data WERE cached, a null here is far
        // more likely a throttle/403 than a real delisting, so leave it untouched.
        await fs.mkdir(storeDir(), { recursive: true });
        await fs.writeFile(dest, JSON.stringify({ steam_appid: Number(appid), unavailable: true, fetchedAt: new Date().toISOString() }));
    }
    return detail;
}

// Patch tags onto all cached store files that are missing them.
// Uses appdetails?filters=tags — a tiny response, much faster than a full re-sync.
/** @param {{ force?: boolean, onProgress?: (done: number, total: number, file?: string, status?: string) => void }} [opts] */
export async function syncTags({ force = false, onProgress } = {}) {
    let files;
    try {
        files = await fs.readdir(storeDir());
    } catch {
        throw new Error('Store cache directory not found — run details sync first');
    }

    const jsonFiles = files.filter(f => f.endsWith('.json'));
    let patched = 0, skipped = 0, failed = 0, done = 0;

    await processBatch(
        jsonFiles,
        async (file) => {
            const filePath = path.join(storeDir(), file);
            let cached;
            try {
                cached = JSON.parse(await fs.readFile(filePath, 'utf8'));
            } catch {
                done++;
                return false;
            }

            if (!force && cached.tags && Object.keys(cached.tags).length > 0) {
                skipped++;
                done++;
                if (onProgress) onProgress(done, jsonFiles.length, file, 'skip');
                return false;
            }

            const appid = cached.steam_appid ?? parseInt(file, 10);
            if (!appid) { done++; return false; }

            let status = 'skip';
            try {
                const spy  = await steamspyFetch(appid);
                const tags = spy.tags;
                if (tags && typeof tags === 'object' && Object.keys(tags).length > 0) {
                    cached.tags = tags;
                    await fs.writeFile(filePath, JSON.stringify(cached, null, 2), 'utf8');
                    patched++;
                    status = `patched (${Object.keys(tags).length} tags)`;
                } else {
                    skipped++;
                    status = 'no tags';
                }
            } catch (err) {
                failed++;
                status = `error: ${err.message}`;
            }

            done++;
            if (onProgress) onProgress(done, jsonFiles.length, cached.name ?? file, status);
            return true;
        },
        { requestsPerSecond: 2, jitterMs: 150 }
    );

    logger.info('[steam-store] Tags sync complete', { patched, skipped, failed, total: jsonFiles.length });
    return { patched, skipped, failed, total: jsonFiles.length };
}

// Re-fetch a previously-unavailable app — bypasses the sentinel so Steam gets
// another chance. Updates fetchedAt if still unavailable, replaces file if recovered.
export async function recheckAppDetail(appid) {
    const dest = appDetailPath(appid);
    let detail;
    try {
        detail = await fetchAppDetail(appid);
    } catch (err) {
        logger.warn('[steam-store] appdetails recheck failed', { appid, err: err.message });
        detail = null;
    }
    if (detail) {
        await fs.mkdir(storeDir(), { recursive: true });
        await fs.writeFile(dest, JSON.stringify(detail, null, 2));
        return detail;
    }
    // Still unavailable — reset fetchedAt so the 24-hour TTL starts fresh
    await fs.writeFile(dest, JSON.stringify({
        steam_appid: Number(appid),
        unavailable: true,
        fetchedAt:   new Date().toISOString(),
    }));
    return null;
}

export async function getGameDetail(appid) {
    try {
        const raw = await fs.readFile(appDetailPath(appid), 'utf8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export async function getGameDetailIndex() {
    let files;
    try {
        files = await fs.readdir(storeDir());
    } catch {
        return [];
    }

    const eligible = files.filter((f) => f.endsWith('.json'));
    const raws     = await mapChunked(eligible, f => fs.readFile(path.join(storeDir(), f), 'utf8').catch(() => null));

    const index = [];
    for (const raw of raws) {
        if (!raw) continue;
        try {
            const detail = JSON.parse(raw);
            index.push({
                appid:        detail.steam_appid,
                name:         detail.name,
                type:         detail.type,
                genres:       detail.genres?.map((g) => g.description) ?? [],
                developers:   detail.developers ?? [],
                metacritic:   detail.metacritic?.score ?? null,
                release_date: detail.release_date?.date ?? null,
                is_free:      detail.is_free ?? false,
            });
        } catch { /* skip malformed file */ }
    }

    return index;
}
