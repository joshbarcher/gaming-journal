// Ported verbatim from relay-server src/services/wishlist/wishlist.service.js
// (docs/relay-fold-in.md §6). Import rewrites only: cache-manager + mapChunked
// from shared/, getWishlist from the local steam service, and the itad/steam
// data paths go through featureDir() instead of join(DATA_DIR, 'relay', ...).
//
// local-wishlist.json and flags.json are journal-owned files and stay at
// $DATA_DIR/gaming-journal/ (not under RELAY_DATA_ROOT) — same as the relay.
import path from 'node:path';
import fs from 'node:fs/promises';
import logger from '../../logger.js';
import { register } from '../shared/cache-manager.js';
import { getWishlist } from '../steam/steam.service.js';
import { mapChunked } from '../shared/map-chunked.js';
import { featureDir } from '../shared/data-root.js';

function itadPath(appid)       { return path.join(featureDir('itad'),          `${appid}.json`); }
function storePath(appid)      { return path.join(featureDir('steam'), 'store', `${appid}.json`); }
function localWishlistPath()   { return path.join(process.env.DATA_DIR, 'gaming-journal', 'local-wishlist.json'); }
function flagsPath()           { return path.join(process.env.DATA_DIR, 'gaming-journal', 'flags.json'); }

async function readJson(filePath) {
    try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
    catch { return null; }
}

function parseReleaseDateIso(str) {
    if (!str) return null;
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function shapeItem(appid, meta, store, itad, isLocal = false, flagsData = {}) {
    const best = itad?.deals?.[0] ?? null;
    const priceOverview = store?.price_overview ?? null;
    const releaseRaw = store?.release_date ?? null;

    return {
        appid,
        name: store?.name ?? `App ${appid}`,
        media: {
            header: `/images/steam/games/${appid}/header.jpg`,
        },
        wishlist: {
            priority:  isLocal ? null : (meta.priority ?? null),
            dateAdded: isLocal ? meta.dateAdded : meta.date_added,
            local:     isLocal,
        },
        store: {
            unavailable:    store?.unavailable === true,
            isFree:         store?.is_free ?? false,
            comingSoon:     releaseRaw?.coming_soon === true,
            releaseDateIso: parseReleaseDateIso(releaseRaw?.date ?? null),
            price: priceOverview ? {
                amount:    priceOverview.final / 100,
                formatted: priceOverview.final_formatted,
            } : null,
        },
        itad: {
            bestPrice: best ? {
                price: best.price,
                cut:   best.cut,
                store: best.store,
                url:   best.url,
            } : null,
            historicalLow: itad?.historicalLow ?? null,
        },
        flags: {
            alert: !!(flagsData[String(appid)]?.alert),
        },
    };
}

// ── In-memory cache ───────────────────────────────────────────────────────────

let _cache = null;

export async function build() {
    const t0 = Date.now();

    const [wishlistData, localData, flagsData] = await Promise.all([
        getWishlist(),
        readJson(localWishlistPath()).then(d => d ?? { items: {} }),
        readJson(flagsPath()).then(d => d ?? {}),
    ]);

    const steamItems = wishlistData.items ?? {};
    const localItems = localData.items ?? {};

    // Local items that are NOT already in the Steam wishlist
    const localOnly = Object.entries(localItems).filter(([id]) => !(id in steamItems));

    const steamEntries = Object.entries(steamItems);
    const allEntries   = [...steamEntries, ...localOnly.map(([id, meta]) => [id, meta, true])];

    if (allEntries.length === 0) {
        _cache = [];
        logger.info('[wishlist] Cache built (empty wishlist)', { ms: Date.now() - t0 });
        return;
    }

    const [itadResults, storeResults] = await Promise.all([
        mapChunked(allEntries, ([id]) => readJson(itadPath(Number(id)))),
        mapChunked(allEntries, ([id]) => readJson(storePath(Number(id)))),
    ]);

    _cache = allEntries
        .map(([id, meta, isLocal = false], i) =>
            shapeItem(Number(id), meta, storeResults[i], itadResults[i], isLocal, flagsData))
        .sort((a, b) => (a.wishlist.priority ?? 9999) - (b.wishlist.priority ?? 9999));

    logger.info('[wishlist] Cache built', { count: _cache.length, ms: Date.now() - t0 });
}

register('wishlist', build);

/**
 * Fold-in shim (not in the relay): the relay builds this cache unconditionally
 * in server.js's listen callback. Until boot.js wires build() the same way,
 * routes await this so the first request populates the cache (pure reads).
 * Idempotent and coalesced; harmless once the boot wiring lands.
 */
let _building = null;
export function ensureBuilt() {
    if (_cache !== null) return Promise.resolve();
    _building ??= build().finally(() => { _building = null; });
    return _building;
}

export function get() {
    return _cache ?? [];
}

// Re-shape exactly one wishlist entry and splice it into the live cache.
// Reads 4 files (steam wishlist, local wishlist, store, itad) instead of the full build.
export async function patchItem(appid) {
    if (_cache === null) return; // cache not initialised yet — full build will cover it

    const id = Number(appid);

    const [wishlistData, localData, store, itad, flagsData] = await Promise.all([
        getWishlist().catch(() => ({ items: {} })),
        readJson(localWishlistPath()).then(d => d ?? { items: {} }),
        readJson(storePath(id)),
        readJson(itadPath(id)),
        readJson(flagsPath()).then(d => d ?? {}),
    ]);

    const steamMeta = (wishlistData.items ?? {})[String(id)];
    const localMeta = (localData.items ?? {})[String(id)];

    // Remove stale entry for this appid
    _cache = _cache.filter(item => item.appid !== id);

    if (steamMeta) {
        _cache.push(shapeItem(id, steamMeta, store, itad, false, flagsData));
    } else if (localMeta) {
        _cache.push(shapeItem(id, localMeta, store, itad, true, flagsData));
    }
    // If neither, the item was removed — already filtered above

    _cache.sort((a, b) => (a.wishlist.priority ?? 9999) - (b.wishlist.priority ?? 9999));
}
