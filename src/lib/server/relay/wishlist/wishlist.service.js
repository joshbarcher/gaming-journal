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
import { createPersistedIndex } from '../shared/persisted-index.js';
import { createSourceSignatures, shapeOf, shapeRefKey } from '../shared/source-signatures.js';

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
//
// Fast-boot: the shaped wishlist is persisted to a sidecar so boot() loads it in
// one read instead of re-scanning every entry's itad/store file (~18s).

function wishlistIndexFile() { return path.join(featureDir('steam'), 'wishlist-index.json'); }

// The slow scan — reads each entry's itad + store data and returns the array.
/**
 * The whole-list sources plus the entry universe they imply, with the degraded-read
 * guard. Shared by the full and incremental scans so the guard can never apply to
 * only one of them.
 */
async function _readListSources() {
    const [wishlistData, localData, flagsData] = await Promise.all([
        getWishlist(),
        readJson(localWishlistPath()).then(d => d ?? { items: {} }),
        readJson(flagsPath()).then(d => d ?? {}),
    ]);

    const steamItems = wishlistData.items ?? {};
    const localItems = localData.items ?? {};

    // A transient getWishlist() read can return an empty {} (a partial read, not a throw). If the
    // current index already holds Steam-sourced entries, rebuilding from an empty Steam wishlist +
    // non-empty local items yields a NON-empty (local-only) array that slips past persisted-index's
    // all-empty guard and wipes the whole ~1100-entry Steam wishlist. Abort to keep the good index.
    // (games.service._buildAll guards the library the same way.) A genuine local-only user — no prior
    // Steam entries in the index — is unaffected and still builds.
    if (Object.keys(steamItems).length === 0 && Object.keys(localItems).length > 0
        && _idx.get().some(item => !item.wishlist?.local)) {
        throw new Error('[wishlist] Steam wishlist empty while index holds Steam entries — transient read, aborting rebuild to preserve the good wishlist');
    }

    // Local items that are NOT already in the Steam wishlist
    const localOnly = Object.entries(localItems).filter(([id]) => !(id in steamItems));

    const steamEntries = Object.entries(steamItems);
    const allEntries   = [...steamEntries, ...localOnly.map(([id, meta]) => [id, meta, true])];

    return { allEntries, flagsData };
}

function sortItems(items) {
    return items.sort((a, b) => (a.wishlist.priority ?? 9999) - (b.wishlist.priority ?? 9999));
}

/** Shape one entry from its two per-appid source files. */
async function shapeOneEntry([id, meta, isLocal = false], flagsData) {
    const appid = Number(id);
    const [itad, store] = await Promise.all([readJson(itadPath(appid)), readJson(storePath(appid))]);
    return shapeItem(appid, meta, store, itad, isLocal, flagsData);
}

async function scanCache() {
    const { allEntries, flagsData } = await _readListSources();
    if (allEntries.length === 0) return [];
    return sortItems(await mapChunked(allEntries, (e) => shapeOneEntry(e, flagsData)));
}

// ── Incremental rebuild ───────────────────────────────────────────────────────
// A row is a pure function of the game's store + itad files plus its wishlist meta
// and alert flag. scanCache() re-read ~2200 per-appid files every refresh (17s
// against the NAS) to pick up a handful of price changes. See
// shared/source-signatures.js for why stat-diffing is ~150x cheaper.
const FULL_REBUILD_RATIO = 0.5;

const _sigs = createSourceSignatures({
    name: 'wishlist',
    file: () => path.join(featureDir('steam'), 'wishlist-index-sources.json'),
    dirs: () => ({
        store: path.join(featureDir('steam'), 'store'),
        itad:  featureDir('itad'),
    }),
});

/** Row inputs that come from the wishlist meta / flags rather than the two files —
 *  changing an alert or a priority moves no file mtime at all. */
function rowChanged(entry, appid, meta, isLocal, flagsData) {
    const w = entry.wishlist ?? {};
    if ((isLocal ? null : (meta.priority ?? null)) !== (w.priority ?? null)) return true;
    if ((isLocal ? meta.dateAdded : meta.date_added) !== w.dateAdded) return true;
    if (isLocal !== (w.local === true)) return true;
    if (!!(flagsData[String(appid)]?.alert) !== !!entry.flags?.alert) return true;
    return false;
}

/** Full scan, recording signatures so the NEXT refresh can go incremental.
 *  Signatures BEFORE the scan — see source-signatures.js on the ordering. */
async function scanCacheAndRecord() {
    const sigs  = await _sigs.scan();
    const items = await scanCache();
    const refKey = shapeRefKey(items.map(i => i.appid));
    await _sigs.persist(sigs, shapeOf(items.find(i => i.appid === refKey)));
    return items;
}

async function scanCacheIncremental() {
    const prev = _idx.get();
    if (!prev.length) return scanCacheAndRecord();

    const baseline = await _sigs.load();
    if (!baseline) {
        logger.info('[wishlist] No usable source signatures — full scan to establish them');
        return scanCacheAndRecord();
    }

    const t0 = Date.now();
    const { allEntries, flagsData } = await _readListSources();
    if (allEntries.length === 0) return [];
    const sigs   = await _sigs.scan();
    const statMs = Date.now() - t0;

    const prevById = new Map(prev.map(i => [i.appid, i]));
    const changed  = allEntries.filter(([id, meta, isLocal = false]) => {
        const appid = Number(id);
        const entry = prevById.get(appid);
        if (!entry) return true;                                              // newly wishlisted
        if ((sigs.get(appid) ?? '') !== (baseline.sigs[appid] ?? '')) return true;
        return rowChanged(entry, appid, meta, isLocal, flagsData);
    });

    if (changed.length > allEntries.length * FULL_REBUILD_RATIO) {
        logger.info('[wishlist] Most of the wishlist changed — full scan is cheaper', { changed: changed.length, total: allEntries.length });
        return scanCacheAndRecord();
    }

    const reshaped = await mapChunked(changed, (e) => shapeOneEntry(e, flagsData));
    const byId     = new Map(reshaped.map(i => [i.appid, i]));

    // Same reference entry as the full path, never "whichever one changed".
    const refKey = shapeRefKey(allEntries.map(([id]) => Number(id)));
    const shape  = shapeOf(byId.get(refKey) ?? prevById.get(refKey));
    if (baseline.shape && shape && baseline.shape !== shape) {
        logger.info('[wishlist] Row shape changed — full scan so every row is re-derived');
        return scanCacheAndRecord();
    }

    // Built from the live entry list, so removed items drop out and new ones appear.
    const next = sortItems(allEntries
        .map(([id]) => byId.get(Number(id)) ?? prevById.get(Number(id)))
        .filter(Boolean));

    await _sigs.persist(sigs, shape);
    logger.info('[wishlist] Incremental refresh', {
        changed: changed.length, reused: next.length - reshaped.length, total: next.length,
        statMs, totalMs: Date.now() - t0,
    });
    return next;
}

const _idx = createPersistedIndex({ name: 'wishlist', file: wishlistIndexFile, rebuild: scanCacheIncremental });

/** Fast boot: load the persisted sidecar, then refresh in the background. */
export async function boot() { await _idx.boot(); }

/** Full rebuild + persist. Registered with cache-manager (post-sync refresh). */
export async function build() { await _idx.refresh(); }

/** Lazy guard for request paths that run before boot() (dev, tests). */
export function ensureBuilt() { return _idx.ensureLoaded(); }

register('wishlist', build);

export function get() {
    return _idx.get();
}

// Re-shape exactly one wishlist entry and splice it into the live cache.
// Reads 4 files (steam wishlist, local wishlist, store, itad) instead of the full build.
export async function patchItem(appid) {
    if (!_idx.loaded()) return; // cache not initialised yet — full build will cover it

    const id = Number(appid);

    const [wishlistData, localData, store, itad, flagsData] = await Promise.all([
        getWishlist().catch(() => null),   // null = read FAILED (distinct from a genuinely empty {})
        readJson(localWishlistPath()).then(d => d ?? { items: {} }),
        readJson(storePath(id)),
        readJson(itadPath(id)),
        readJson(flagsPath()).then(d => d ?? {}),
    ]);

    // A transient wishlist read must not drop a Steam-wishlist-only entry from the index — bail on
    // the delta and let the next successful build/patch reconcile it.
    if (wishlistData === null) {
        logger.warn('[wishlist] patchItem: wishlist read failed — skipping delta', { appid: id });
        return;
    }

    const steamMeta = (wishlistData.items ?? {})[String(id)];
    const localMeta = (localData.items ?? {})[String(id)];

    // Targeted delta: drop the stale entry, splice in the fresh one, re-sort,
    // and persist — no full rescan. (The sidecar stays current after a single
    // wishlist add/remove.)
    await _idx.mutate((cache) => {
        const next = cache.filter(item => item.appid !== id);
        if (steamMeta)      next.push(shapeItem(id, steamMeta, store, itad, false, flagsData));
        else if (localMeta) next.push(shapeItem(id, localMeta, store, itad, true, flagsData));
        // If neither, the item was removed — already filtered above.
        next.sort((a, b) => (a.wishlist.priority ?? 9999) - (b.wishlist.priority ?? 9999));
        return next;
    });
}
