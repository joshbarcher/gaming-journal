import path from 'node:path';
import fs from 'node:fs/promises';
import logger from '../../logger.js';
import { mapChunked } from '../shared/map-chunked.js';
import { getAllGames } from '../shared/getAllGames.js';
import { featureDir } from '../shared/data-root.js';
// Read-only until Wave 3 — the relay still owns the steam cache files.
import { readWishlistCache as getWishlist, readGamesCache as getSteamGames } from '../shared/steam-caches.js';
import { tracked } from '../metrics/tracked.js';

const ITAD_BASE       = 'https://api.isthereanydeal.com';
const BATCH_SIZE      = 100;
const ID_DELAY_MIN_MS    = 100;
const ID_DELAY_MAX_MS    = 300;
const BATCH_DELAY_MIN_MS = 300;
const BATCH_DELAY_MAX_MS = 700;
const RESOLVE_DELAY_MIN_MS  = 250;  // jitter between redirect follows
const RESOLVE_DELAY_MAX_MS  = 750;
const RESOLVE_GAME_DELAY_MS = 150;  // extra gap between games during resolveAll/verifyAll
const URL_RESOLVE_TTL_MS    = 14 * 24 * 60 * 60 * 1_000; // re-resolve after 14 days

function jitter(min, max) {
    return min + Math.random() * (max - min);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Opt-in stores — numeric IDs as used by the ITAD v3 API
export const STORES = [
    { id: 61, name: 'Steam' },
    { id: 20, name: 'GameBillet' },
    { id:  6, name: 'Fanatical' },
    { id: 37, name: 'Humble Store' },
    { id: 29, name: 'GamesPlanet US' },
    { id: 26, name: 'GamesPlanet UK' },
    { id: 27, name: 'GamesPlanet DE' },
    { id: 28, name: 'GamesPlanet FR' },
    { id: 36, name: 'GreenManGaming' },
];
export const STORE_IDS = new Set(STORES.map(s => s.id));

function itadDir()        { return featureDir('itad'); }
function entryPath(appid) { return path.join(itadDir(), `${appid}.json`); }
function indexPath()      { return path.join(itadDir(), 'index.json'); }

function apiKey() {
    const key = process.env.ITAD_API_KEY;
    if (!key) throw new Error('ITAD_API_KEY not configured');
    return key;
}

function country() {
    return process.env.ITAD_COUNTRY ?? 'US';
}

// ── ITAD API calls ────────────────────────────────────────────────────────────

async function lookupItadId(appid, fetchFn = fetch) {
    const res = await fetchFn(
        `${ITAD_BASE}/games/lookup/v1?key=${apiKey()}&appid=${appid}`
    );
    if (!res.ok) throw new Error(`ITAD lookup failed: ${res.status}`);
    const body = await res.json();
    return body.found ? body.game.id : null;
}

async function fetchPrices(itadIds, fetchFn = fetch) {
    const res = await fetchFn(
        `${ITAD_BASE}/games/prices/v2?key=${apiKey()}&country=${country()}&nondeals=true`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(itadIds) }
    );
    if (!res.ok) throw new Error(`ITAD prices failed: ${res.status}`);
    return res.json();
}

async function fetchHistoricalLows(itadIds, fetchFn = fetch) {
    const res = await fetchFn(
        `${ITAD_BASE}/games/historylow/v1?key=${apiKey()}&country=${country()}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(itadIds) }
    );
    if (!res.ok) throw new Error(`ITAD historylow failed: ${res.status}`);
    return res.json();
}

// ── Shape helpers (exported for testing) ─────────────────────────────────────

export function shapeDeal(raw) {
    return {
        store:   raw.shop.name,
        storeId: raw.shop.id,
        price:   raw.price.amount,
        regular: raw.regular.amount,
        cut:     raw.cut,
        url:     raw.url,
    };
}

export function shapeHistoricalLow(raw) {
    if (!raw) return null;
    return {
        price: raw.price.amount,
        cut:   raw.cut,
        store: raw.shop.name,
        date:  raw.timestamp ? raw.timestamp.slice(0, 10) : null,
    };
}

/**
 * A stable fingerprint of the price information in an ITAD entry.
 *
 * Used to decide whether a sync produced new information. It deliberately
 * ignores `url`, `resolvedAt`, and `fetchedAt`: re-following a store's redirect
 * or re-stamping the fetch time changes the file on disk without changing a
 * single price, and charting that as "updated" would report ~2,000 new records
 * every sync — the exact inflation the new-records chart exists to avoid.
 *
 * Deals are sorted because ITAD's ordering is not stable across responses.
 */
export function priceSignature(entry) {
    const deals = (entry?.deals ?? [])
        .map(d => `${d.storeId}:${d.price}:${d.cut}`)
        .sort()
        .join('|');
    const low = entry?.historicalLow
        ? `${entry.historicalLow.price}@${entry.historicalLow.date}`
        : '';
    return `${deals}#${low}`;
}

export function filterAndSortDeals(rawDeals) {
    return (rawDeals ?? [])
        .filter(d => STORE_IDS.has(d.shop.id))
        .map(shapeDeal)
        .sort((a, b) => a.price - b.price);
}

// ── File I/O ──────────────────────────────────────────────────────────────────

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
    try { files = await fs.readdir(itadDir()); } catch { return []; }

    const eligible = files.filter((f) => f !== 'index.json' && f.endsWith('.json'));
    const raws     = await mapChunked(eligible, f => fs.readFile(path.join(itadDir(), f), 'utf8').catch(() => null));

    const index = [];
    for (const raw of raws) {
        if (!raw) continue;
        try {
            const entry = JSON.parse(raw);
            const best  = entry.deals?.[0] ?? null;
            index.push({
                appid:         entry.appid,
                steamName:     entry.steamName,
                bestPrice:     best ? { price: best.price, cut: best.cut, store: best.store } : null,
                historicalLow: entry.historicalLow,
                dealCount:     entry.deals?.length ?? 0,
            });
        } catch { /* skip malformed */ }
    }

    await fs.writeFile(indexPath(), JSON.stringify(index, null, 2));
    return index;
}

// ── Core sync logic ───────────────────────────────────────────────────────────

async function resolveMissingIds(games, existingEntries, fetchFn) {
    const resolved = [];
    let lookupCount = 0;

    for (const game of games) {
        const existing = existingEntries.get(game.appid);

        // itadId cached (even if null = known not-found) — reuse
        if (existing && 'itadId' in existing) {
            resolved.push({ appid: game.appid, steamName: game.name, itadId: existing.itadId });
            continue;
        }

        if (lookupCount > 0) await sleep(jitter(ID_DELAY_MIN_MS, ID_DELAY_MAX_MS));

        let itadId = null;
        let confirmed = false; // true only when API responded (even if not found); false on network/error
        try {
            itadId = await lookupItadId(game.appid, fetchFn);
            confirmed = true;
            lookupCount++;
        } catch (err) {
            logger.warn('[itad] ID lookup failed', { appid: game.appid, err: err.message });
            lookupCount++;
        }

        resolved.push({ appid: game.appid, steamName: game.name, itadId, confirmed });

        if (lookupCount % 50 === 0) {
            logger.info('[itad] ID resolution progress', { resolved: resolved.length, total: games.length });
        }
    }

    return resolved;
}

async function syncGames(games, { force = false, onProgress, fetchFn = fetch } = {}) {
    await fs.mkdir(itadDir(), { recursive: true });

    const intervalHours = parseInt(process.env.ITAD_SYNC_INTERVAL_HOURS ?? '72', 10);
    const freshCutoff   = Date.now() - intervalHours * 3_600_000;

    // Load existing cache
    const existingEntries = new Map();
    for (const game of games) {
        try {
            const entry = JSON.parse(await fs.readFile(entryPath(game.appid), 'utf8'));
            existingEntries.set(game.appid, entry);
        } catch { /* not cached */ }
    }

    // Phase 1: resolve ITAD IDs for any not yet looked up
    const resolved = await resolveMissingIds(games, existingEntries, fetchFn);

    // Phase 2: determine which games need a price refresh
    const toFetch = resolved.filter(({ appid, itadId }) => {
        if (!itadId) return false;
        if (force) return true;
        const existing = existingEntries.get(appid);
        if (!existing?.fetchedAt) return true;
        return new Date(existing.fetchedAt).getTime() < freshCutoff;
    });

    // Phase 3: batch fetch prices + historical lows
    const priceMap = new Map();
    const lowMap   = new Map();
    const fetchIds = toFetch.map(g => g.itadId);

    for (let i = 0; i < fetchIds.length; i += BATCH_SIZE) {
        const batch = fetchIds.slice(i, i + BATCH_SIZE);
        try {
            const [prices, lows] = await Promise.all([
                fetchPrices(batch, fetchFn),
                fetchHistoricalLows(batch, fetchFn),
            ]);
            for (const p of prices) priceMap.set(p.id, p.deals ?? []);
            for (const l of lows)   lowMap.set(l.id, l.low ?? null);
        } catch (err) {
            logger.warn('[itad] Batch price fetch failed', { offset: i, err: err.message });
        }
        if (i + BATCH_SIZE < fetchIds.length) {
            await sleep(jitter(BATCH_DELAY_MIN_MS, BATCH_DELAY_MAX_MS));
        }
    }

    // Phase 4: write entries
    let fetched = 0, skipped = 0, noData = 0, created = 0, updated = 0;
    const fetchSet = new Set(toFetch.map(g => g.appid));

    // Report a determinate 0% before the loop starts. Without this the caller
    // sees `total: 0` and can only draw an indeterminate spinner — and this
    // loop, which resolves a tracking URL per game with jitter, is the part
    // that takes minutes.
    let done = 0;
    onProgress?.(0, resolved.length);

    for (const { appid, steamName, itadId, confirmed } of resolved) {
        if (!fetchSet.has(appid)) {
            // Game is not on ITAD (API confirmed it) and has no cached file yet — write a sentinel
            // so the backfill doesn't keep re-provisioning on every server start.
            if (confirmed && itadId === null && !existingEntries.has(appid)) {
                await fs.writeFile(entryPath(appid), JSON.stringify({
                    appid, steamName, itadId: null,
                    fetchedAt: new Date().toISOString(),
                    deals: [], historicalLow: null,
                }, null, 2));
            }
            skipped++;
            onProgress?.(++done, resolved.length);
            continue;
        }

        const deals         = filterAndSortDeals(priceMap.get(itadId) ?? []);
        const historicalLow = shapeHistoricalLow(lowMap.get(itadId) ?? null);

        // Carry forward resolved URLs from the existing entry so we don't
        // re-follow every redirect on every sync.  A deal is considered fresh
        // when its resolvedAt is within the 14-day TTL; only stale or brand-new
        // deals will be re-resolved by resolveEntryUrls() below.
        const existing = existingEntries.get(appid);
        if (existing?.deals?.length) {
            const now = Date.now();
            const byStore = new Map(existing.deals.map(d => [d.storeId, d]));
            for (const deal of deals) {
                const prev = byStore.get(deal.storeId);
                if (prev?.resolvedAt && (now - new Date(prev.resolvedAt).getTime()) < URL_RESOLVE_TTL_MS) {
                    deal.url        = prev.url;
                    deal.resolvedAt = prev.resolvedAt;
                }
            }
        }

        const nextEntry = {
            appid,
            steamName,
            itadId,
            fetchedAt: new Date().toISOString(),
            deals,
            historicalLow,
        };

        // Novelty: a game we had never priced, or one whose prices actually moved.
        if (!existing) created++;
        else if (priceSignature(existing) !== priceSignature(nextEntry)) updated++;

        await fs.writeFile(entryPath(appid), JSON.stringify(nextEntry, null, 2));

        // Resolve tracking URLs immediately after writing — jitter built in
        await resolveEntryUrls(appid).catch(err =>
            logger.debug('[itad] URL resolve skipped', { appid, err: err.message })
        );

        deals.length > 0 ? fetched++ : noData++;
        onProgress?.(++done, resolved.length);
    }

    onProgress?.(resolved.length, resolved.length);
    logger.info('[itad] Sync complete', { fetched, created, updated, skipped, noData, total: games.length });
    return { fetched, created, updated, skipped, noData, total: games.length };
}

// ── Public sync functions ─────────────────────────────────────────────────────

export async function syncOne(appid, steamName, { force = false } = {}) {
    const result = await syncGames([{ appid: Number(appid), name: steamName ?? null }], { force });
    await rebuildIndex();
    return result;
}

export async function syncAll({ force = false, onProgress, fetchFn } = {}) {
    logger.info('[itad] Full sync started');
    const games = await getAllGames();
    if (games.length === 0) throw new Error('No games found — run Steam sync first');

    const result = await syncGames(games, { force, onProgress, fetchFn });
    await rebuildIndex();
    logger.info('[itad] Full sync complete', result);
    return result;
}

// Kept for backwards compatibility — syncAll now covers wishlist games too
export async function syncWishlist(opts = {}) {
    return syncAll(opts);
}

// ── Wishlist combined view ────────────────────────────────────────────────────

export async function getWishlistEntries() {
    const wishlistData = await getWishlist();
    const items = wishlistData.items ?? {};
    const gamesData = await getSteamGames();
    const gamesMap = new Map((gamesData.games ?? []).map(g => [g.appid, g]));

    const results = await Promise.all(
        Object.entries(items).map(async ([appidStr, meta]) => {
            const appid = Number(appidStr);
            const steamGame = gamesMap.get(appid);
            const itad = await getEntry(appid);
            return {
                appid,
                name:        steamGame?.name ?? `App ${appid}`,
                priority:    meta.priority,
                dateAdded:   meta.date_added,
                itad:        itad ?? null,
            };
        })
    );

    return results.sort((a, b) => a.priority - b.priority);
}

// ── URL resolution ────────────────────────────────────────────────────────────
// Follows a redirect URL and returns the final destination, stripping tracking.

async function followRedirect(url) {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    // res.url is the final URL after all hops
    return res.url && res.url !== url ? res.url : null;
}

// Resolves all unresolved/stale deal URLs in a single entry file in-place.
// Returns true if the file was modified.
async function resolveEntryUrls(appid) {
    const entry = await getEntry(appid);
    if (!entry?.deals?.length) return false;

    const now     = Date.now();
    let changed   = false;
    let first     = true;

    for (const deal of entry.deals) {
        if (!deal.url) continue;
        // Skip if recently resolved
        if (deal.resolvedAt && (now - new Date(deal.resolvedAt).getTime()) < URL_RESOLVE_TTL_MS) continue;

        if (!first) await sleep(jitter(RESOLVE_DELAY_MIN_MS, RESOLVE_DELAY_MAX_MS));
        first = false;

        try {
            const resolved = await followRedirect(deal.url);
            if (resolved) {
                deal.url        = resolved;
                deal.resolvedAt = new Date().toISOString();
                changed = true;
            }
        } catch (err) {
            logger.debug('[itad] URL resolve failed', { appid, err: err.message });
        }
    }

    if (changed) {
        await fs.writeFile(entryPath(appid), JSON.stringify(entry, null, 2));
    }
    return changed;
}

// One-time / on-demand: resolve URLs across all existing ITAD entries.
export async function resolveAll() {
    let files;
    try { files = await fs.readdir(itadDir()); } catch { return; }

    const eligible = files.filter(f => f !== 'index.json' && f.endsWith('.json'));
    let resolved = 0, skipped = 0;

    const total = eligible.length;
    logger.info('[itad] URL resolution started', { total });

    for (let i = 0; i < eligible.length; i++) {
        const appid   = parseInt(eligible[i]);
        const changed = await resolveEntryUrls(appid).catch(err => {
            logger.warn('[itad] resolveAll entry failed', { appid, err: err.message });
            return false;
        });
        changed ? resolved++ : skipped++;
        logger.info('[itad] URL resolution progress', { appid, done: i + 1, total, resolved, skipped });

        await sleep(jitter(RESOLVE_GAME_DELAY_MS, RESOLVE_GAME_DELAY_MS * 2));
    }

    logger.info('[itad] URL resolution complete', { resolved, skipped, total });
}

// Periodic verification: HEAD each stored resolved URL.
// Clears resolvedAt on broken links so the next sync re-resolves them.
export async function verifyAll() {
    let files;
    try { files = await fs.readdir(itadDir()); } catch { return; }

    const eligible = files.filter(f => f !== 'index.json' && f.endsWith('.json'));
    let verified = 0, broken = 0;
    const total = eligible.length;
    logger.info('[itad] URL verification started', { total });

    for (let i = 0; i < eligible.length; i++) {
        const appid  = parseInt(eligible[i]);
        const entry  = await getEntry(appid).catch(() => null);
        if (!entry?.deals?.length) continue;

        let changed = false;
        let first   = true;

        for (const deal of entry.deals) {
            if (!deal.url || !deal.resolvedAt) continue;

            if (!first) await sleep(jitter(RESOLVE_DELAY_MIN_MS, RESOLVE_DELAY_MAX_MS));
            first = false;

            try {
                const res = await fetch(deal.url, { method: 'HEAD', redirect: 'follow' });
                if (res.ok) {
                    verified++;
                } else {
                    delete deal.resolvedAt; // will re-resolve on next sync
                    broken++;
                    changed = true;
                }
            } catch {
                delete deal.resolvedAt;
                broken++;
                changed = true;
            }
        }

        if (changed) {
            await fs.writeFile(entryPath(appid), JSON.stringify(entry, null, 2)).catch(() => {});
        }

        logger.info('[itad] URL verification progress', { appid, done: i + 1, total, verified, broken });

        await sleep(jitter(RESOLVE_GAME_DELAY_MS, RESOLVE_GAME_DELAY_MS * 2));
    }

    logger.info('[itad] URL verification complete', { verified, broken, total });
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

export function startItadSyncScheduler() {
    const hours = parseInt(process.env.ITAD_SYNC_INTERVAL_HOURS ?? '72', 10);
    const ms    = hours * 3_600_000;
    logger.info('[itad] Sync scheduler started', { intervalHours: hours });

    setInterval(() => {
        tracked('itad', () => syncAll()).catch(err => logger.error('[itad] Scheduled sync failed', err));
    }, ms);

    // Weekly URL verification — check stored links are still live
    const weekMs = 7 * 24 * 60 * 60 * 1_000;
    setInterval(() => {
        verifyAll().catch(err => logger.error('[itad] Scheduled verify failed', err));
    }, weekMs);
}
