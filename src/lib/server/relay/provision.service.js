// Ported verbatim from relay-server src/services/provision.service.js
// (docs/relay-fold-in.md §6). Import rewrites only — and one structural
// difference from the RELAY's current copy: after the Wave-1 cutover the relay
// routes the five feature syncs (itad/protondb/hltb/pcgw + store recheck)
// through an HTTP shim (journal-sync.js) because those services now live HERE.
// The JOURNAL's copy imports them DIRECTLY from the local ported services —
// this matches the relay's pre-shrink (pre-Wave-1) provision.service exactly.
//
// Data paths go through featureDir() instead of join(DATA_DIR, 'relay', ...);
// library-firstseen.json stays under featureDir('steam'); local-wishlist.json
// is journal-owned and stays at $DATA_DIR/gaming-journal/.
import path from 'node:path';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import logger from '../logger.js';
import { syncOne as syncStoreOne, recheckAppDetail } from './steam/store.service.js';
import { syncOneGame, syncOneScreenshots } from './steam/images.service.js';
import { syncOne as syncItadOne } from './itad/itad.service.js';
import { syncOne as syncProtondbOne } from './protondb/protondb.service.js';
import { syncGame as syncHltbGame } from './hltb/hltb.service.js';
import { syncGame as syncPcgwGame } from './pcgw/pcgw.service.js';
import { getAllGames } from './shared/getAllGames.js';
import { rebuild } from './shared/cache-manager.js';
import { featureDir } from './shared/data-root.js';

function steamDir()         { return featureDir('steam'); }
function firstSeenPath()    { return path.join(steamDir(), 'library-firstseen.json'); }
function itadDir()          { return featureDir('itad'); }
function hltbDir()          { return featureDir('hltb'); }
function pcgwDir()          { return featureDir('pcgw'); }
function protondbDir()      { return featureDir('protondb'); }
function localWishlistPath(){ return path.join(process.env.DATA_DIR, 'gaming-journal', 'local-wishlist.json'); }

async function fileExists(p) {
    try { await fs.access(p); return true; } catch { return false; }
}

async function readJson(p) {
    try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return null; }
}

// ── Library "first seen" tracking ──────────────────────────────────────────────
// Steam's owned-games API carries no purchase/acquire date, so we approximate it:
// the first time provisionNewGames() detects an appid it isn't already tracking,
// we stamp "now". This powers the home page's "Just Bought" card. The in-memory
// cache is loaded lazily (sync) so the synchronous home.service can read it per
// request without an await.

let _firstSeen = null;

function loadFirstSeen() {
    if (_firstSeen) return _firstSeen;
    try {
        _firstSeen = JSON.parse(readFileSync(firstSeenPath(), 'utf8'));
        return _firstSeen;
    } catch (err) {
        if (err.code === 'ENOENT') {
            _firstSeen = {};   // no file yet — an empty map is the correct starting point
            return _firstSeen;
        }
        // Transient read/parse error (NAS blip, a half-written file). Do NOT memoize {}:
        // a cached-empty map makes recordFirstSeen() treat every owned game as brand new
        // and rewrite the file with only-today dates, wiping real acquire history. Return
        // null (unmemoized) so the next call retries the load.
        logger.warn('[provision] library-firstseen read failed — not caching empty', { err: err.message });
        return null;
    }
}

/** Sync snapshot of { [appid]: firstSeenIso } for library games. */
export function getLibraryFirstSeen() {
    return loadFirstSeen() ?? {};
}

/** Stamp "now" for any of these library appids not already tracked; flush once. */
async function recordFirstSeen(appids) {
    const map = loadFirstSeen();
    if (map === null) {
        // Read failed transiently; the on-disk file may hold real dates. Writing now would
        // clobber them with only-today stamps, so skip — a later call retries once the
        // read succeeds.
        logger.warn('[provision] Skipping firstSeen record — firstseen unreadable this cycle');
        return;
    }
    const now = new Date().toISOString();
    let changed = false;
    for (const appid of appids) {
        if (map[appid] == null) { map[appid] = now; changed = true; }
    }
    if (!changed) return;
    try {
        await fs.mkdir(steamDir(), { recursive: true });
        await fs.writeFile(firstSeenPath(), JSON.stringify(map, null, 2));
    } catch (err) {
        logger.warn('[provision] Failed to flush library-firstseen', { err: err.message });
    }
}

// ── Core pipeline ─────────────────────────────────────────────────────────────

// Run the full data pipeline for a single game.
// Steps are ordered by dependency (store → images → everything else).
// Each step is individually guarded — one failure does not abort the rest.
export async function provisionGame(appid, name) {
    logger.info('[provision] Provisioning', { appid, name: name ?? `App ${appid}` });

    // 1. Store details — must run first; images need it to resolve hash-based URLs
    let resolvedName = name;
    try {
        const detail = await syncStoreOne(appid);
        if (detail?.name) resolvedName = detail.name;
    } catch (err) {
        logger.warn('[provision] Store sync failed', { appid, err: err.message });
    }

    // 2. Images (game art) + screenshots — screenshots reference store data for IDs
    try { await syncOneGame(appid); }
    catch (err) { logger.warn('[provision] Images sync failed', { appid, err: err.message }); }

    try { await syncOneScreenshots(appid); }
    catch (err) { logger.warn('[provision] Screenshots sync failed', { appid, err: err.message }); }

    // 3. ITAD pricing
    try { await syncItadOne(appid, resolvedName); }
    catch (err) { logger.warn('[provision] ITAD sync failed', { appid, err: err.message }); }

    // 4. HLTB completion times
    try { await syncHltbGame(appid, { steamName: resolvedName }); }
    catch (err) { logger.warn('[provision] HLTB sync failed', { appid, err: err.message }); }

    // 5. PCGamingWiki (manages its own Puppeteer browser lifecycle)
    try { await syncPcgwGame(appid, { steamName: resolvedName }); }
    catch (err) { logger.warn('[provision] PCGW sync failed', { appid, err: err.message }); }

    // 6. ProtonDB Linux compatibility rating
    try { await syncProtondbOne(appid, { force: true }); }
    catch (err) { logger.warn('[provision] ProtonDB sync failed', { appid, err: err.message }); }

    logger.info('[provision] Done', { appid, name: resolvedName });
}

// ── New game detection ────────────────────────────────────────────────────────

// Snapshot the current set of known appids from disk.
// Call before syncGames + syncWishlist, then pass the result to provisionNewGames.
export async function getKnownAppids() {
    const [gamesData, wishlistData] = await Promise.all([
        readJson(path.join(steamDir(), 'games.json')),
        readJson(path.join(steamDir(), 'wishlist.json')),
    ]);
    const ids = new Set();
    for (const g of (gamesData?.games ?? [])) ids.add(g.appid);
    for (const id of Object.keys(wishlistData?.items ?? {})) ids.add(Number(id));
    return ids;
}

// After syncGames + syncWishlist, provision any appids not present in prevIds.
export async function provisionNewGames(prevIds) {
    const [gamesData, wishlistData] = await Promise.all([
        readJson(path.join(steamDir(), 'games.json')),
        readJson(path.join(steamDir(), 'wishlist.json')),
    ]);

    const newGames = [];
    const newLibraryIds = [];

    for (const g of (gamesData?.games ?? [])) {
        if (!prevIds.has(g.appid)) { newGames.push({ appid: g.appid, name: g.name }); newLibraryIds.push(g.appid); }
    }
    for (const id of Object.keys(wishlistData?.items ?? {})) {
        const appid = Number(id);
        if (!prevIds.has(appid)) newGames.push({ appid, name: null });
    }

    // Stamp acquire dates for newly-owned games so the home "Just Bought" card can
    // surface them. Wishlist-only additions are excluded — they carry their own
    // date_added and aren't purchases.
    if (newLibraryIds.length > 0) await recordFirstSeen(newLibraryIds);

    if (newGames.length === 0) return;

    logger.info('[provision] New games detected', {
        count: newGames.length,
        appids: newGames.map(g => g.appid),
    });

    for (const { appid, name } of newGames) {
        await provisionGame(appid, name);
    }

    await rebuild('games');
}

// ── Unavailable recheck ───────────────────────────────────────────────────────

const UNAVAILABLE_TTL_MS = 24 * 60 * 60 * 1_000; // 24 h

// For each wishlisted game whose store sentinel is older than TTL, re-ask Steam.
// Respects the 1 req/s store API limit. Runs inside the 30-min tick.
export async function recheckUnavailableWishlistItems() {
    const wishlistData = await readJson(path.join(steamDir(), 'wishlist.json'));
    const wishlistIds  = Object.keys(wishlistData?.items ?? {}).map(Number);

    const toRecheck = [];
    for (const appid of wishlistIds) {
        const stored = await readJson(path.join(steamDir(), 'store', `${appid}.json`));
        if (!stored?.unavailable) continue;
        const age = Date.now() - new Date(stored.fetchedAt ?? 0).getTime();
        if (age < UNAVAILABLE_TTL_MS) continue;
        toRecheck.push(appid);
    }

    if (toRecheck.length === 0) {
        logger.info('[provision] Recheck unavailable: nothing due');
        return;
    }

    logger.info('[provision] Rechecking unavailable wishlist items', { count: toRecheck.length });

    let recovered = 0;
    for (const appid of toRecheck) {
        const detail = await recheckAppDetail(appid);
        if (detail) {
            recovered++;
            await provisionGame(appid, detail.name);
        }
        // 1 req/s — matches store API rate limit
        await new Promise(r => setTimeout(r, 1_000));
    }

    if (recovered > 0) await rebuild('wishlist', 'games');

    logger.info('[provision] Recheck unavailable complete', { rechecked: toRecheck.length, recovered });
}

// ── Local wishlist cleanup ────────────────────────────────────────────────────

// Remove local wishlist items that have since appeared in the Steam library.
// Called in the 30-min tick after syncGames so the file stays current.
export async function cleanupLocalWishlist() {
    const [gamesData, localData] = await Promise.all([
        readJson(path.join(steamDir(), 'games.json')),
        readJson(localWishlistPath()),
    ]);

    const items = localData?.items ?? {};
    if (Object.keys(items).length === 0) return;

    const libraryIds = new Set((gamesData?.games ?? []).map(g => String(g.appid)));
    let removed = 0;
    for (const id of Object.keys(items)) {
        if (libraryIds.has(id)) { delete items[id]; removed++; }
    }
    if (removed === 0) return;

    await fs.mkdir(path.dirname(localWishlistPath()), { recursive: true });
    await fs.writeFile(localWishlistPath(), JSON.stringify({ items }, null, 2));
    logger.info('[provision] Removed local wishlist items now in library', { removed });
}

// ── Backfill ──────────────────────────────────────────────────────────────────

// Scan all known games and provision any that are missing one or more data files.
// Safe to run on startup and on demand — provisionGame is fully idempotent.
export async function backfill() {
    const games = await getAllGames();
    if (games.length === 0) return;

    const storeDir       = path.join(steamDir(), 'store');
    const gameImagesDir  = path.join(steamDir(), 'images', 'games');
    const screenshotsDir = path.join(steamDir(), 'images', 'screenshots');
    const missing        = [];

    for (const { appid, name } of games) {
        const [hasStore, hasItad, hasHltb, hasPcgw, hasProtondb, hasGameImages, hasScreenshots] = await Promise.all([
            fileExists(path.join(storeDir,       `${appid}.json`)),
            fileExists(path.join(itadDir(),      `${appid}.json`)),
            fileExists(path.join(hltbDir(),      `${appid}.json`)),
            fileExists(path.join(pcgwDir(),      `${appid}.json`)),
            fileExists(path.join(protondbDir(),  `${appid}.json`)),
            fileExists(path.join(gameImagesDir,  `${appid}`)),
            fileExists(path.join(screenshotsDir, `${appid}`)),
        ]);
        if (!hasStore || !hasItad || !hasHltb || !hasPcgw || !hasProtondb || !hasGameImages || !hasScreenshots) {
            missing.push({ appid, name });
        }
    }

    if (missing.length === 0) {
        logger.info('[provision] Backfill: nothing to do');
        return;
    }

    logger.info('[provision] Backfill started', { total: missing.length });
    for (const { appid, name } of missing) {
        await provisionGame(appid, name);
    }
    await rebuild('games');
    logger.info('[provision] Backfill complete', { total: missing.length });
}
