// Ported verbatim from relay-server src/services/games/games.service.js
// (docs/relay-fold-in.md §6). Import rewrites only: cache-manager + mapChunked
// come from shared/, and the five per-game sources (steam store, hltb, pcgw,
// itad) plus the steam caches import DIRECTLY from the local ported services —
// all Wave-1/Batch-B ports, so no HTTP shim is needed (unlike the relay's
// post-Wave-1 journal-sync.js copy, which was never on this side).
//
// The local-wishlist file is journal-owned and stays at
// $DATA_DIR/gaming-journal/local-wishlist.json (not under RELAY_DATA_ROOT).
//
// Poster-pool wiring: build() calls refresh(_cache) on the already-ported
// poster-pool.service exactly as the relay does — this supersedes the
// ensureIndexLoaded() shim the discover route uses (both stay; idempotent).
import path from 'node:path';
import fs from 'node:fs/promises';
import logger from '../../logger.js';
import { register } from '../shared/cache-manager.js';
import { refresh as refreshPosterPool } from './poster-pool.service.js';
import { mapChunked } from '../shared/map-chunked.js';
import { featureDir } from '../shared/data-root.js';
import { createPersistedIndex } from '../shared/persisted-index.js';
import { createSourceSignatures, shapeOf, shapeRefKey } from '../shared/source-signatures.js';
import { decodeEntities } from '../shared/decode-entities.js';
import { getGames as getSteamGames, getWishlist } from '../steam/steam.service.js';
import { getGameDetail } from '../steam/store.service.js';
import { getEntry as getHltbEntry } from '../hltb/hltb.service.js';
import { getEntry as getPcgwEntry } from '../pcgw/pcgw.service.js';
import { getEntry as getItadEntry } from '../itad/itad.service.js';

async function readLocalWishlist() {
    try {
        return JSON.parse(await fs.readFile(
            path.join(process.env.DATA_DIR, 'gaming-journal', 'local-wishlist.json'), 'utf8'
        ));
    } catch { return { items: {} }; }
}

function mediaUrls(appid, store) {
    const base = `/relay/images/steam/games/${appid}`;
    return {
        header:      `${base}/header.jpg`,
        capsule:     `${base}/capsule.jpg`,
        poster:      `${base}/poster.jpg`,
        hero:        `${base}/hero.jpg`,
        background:  `${base}/background.jpg`,
        logo:        `${base}/logo.png`,
        screenshots: (store?.screenshots ?? []).map((s) => `/relay/images/steam/screenshots/${appid}/${s.id}.jpg`),
    };
}

function mediaUrlsDiscovered(appid, store) {
    return {
        header:      store?.header_image  ?? `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`,
        capsule:     store?.capsule_image ?? null,
        poster:      null,
        hero:        null,
        background:  store?.background_raw ?? store?.background ?? null,
        logo:        null,
        screenshots: (store?.screenshots ?? []).map((s) => s.path_full).filter(Boolean),
    };
}

function mergeStore(store) {
    if (!store) return null;
    if (store.unavailable) return { unavailable: true };
    return {
        type:            store.type ?? null,
        isFree:          store.is_free ?? false,
        // short_description is rendered as plain text (hero blurb), so entities
        // must be decoded here — the store cache keeps it raw. detailedDescription
        // below stays raw because it's real HTML rendered via {@html}/render-html.
        description:     decodeEntities(store.short_description) ?? null,
        developers:      store.developers ?? [],
        publishers:      store.publishers ?? [],
        price:           store.price_overview ?? null,
        platforms:       store.platforms ?? null,
        metacritic:      store.metacritic ?? null,
        categories:      (store.categories ?? []).map((c) => c.description),
        genres:          (store.genres ?? []).map((g) => g.description),
        tags:            store.tags ? Object.entries(store.tags)
                             .sort((a, b) => b[1] - a[1])
                             .map(([name]) => name) : [],
        releaseDate:          store.release_date?.date ?? null,
        recommendations:      store.recommendations?.total ?? null,
        requiredAge:          store.required_age ?? 0,
        detailedDescription:  store.about_the_game ?? store.detailed_description ?? null,
    };
}

function mergeGame(steam, wishlistEntry, store, hltb, pcgw, itad) {
    const appid      = steam?.appid ?? wishlistEntry?.appid ?? store?.steam_appid;
    const inLibrary  = !!steam;
    const inWishlist = !!wishlistEntry;

    return {
        appid,
        name:            steam?.name ?? store?.name ?? `App ${appid}`,
        source:          inLibrary && inWishlist ? 'both' : inLibrary ? 'library' : inWishlist ? 'wishlist' : 'discovered',
        playtimeMinutes: steam?.playtime_forever ?? 0,
        iconUrl:         steam?.img_icon_url ?? null,

        wishlist: wishlistEntry ? {
            priority:  wishlistEntry.priority ?? null,
            dateAdded: wishlistEntry.date_added ?? wishlistEntry.dateAdded,
            local:     wishlistEntry.local === true,
        } : null,

        store: mergeStore(store),
        media: (inLibrary || inWishlist) ? mediaUrls(appid, store) : mediaUrlsDiscovered(appid, store),

        hltb: hltb ? {
            matched:               hltb.matched,
            matchedName:           hltb.matchedName ?? null,
            confidence:            hltb.confidence ?? null,
            hltbId:                hltb.hltbId ?? null,
            gameplayMain:          hltb.gameplayMain ?? null,
            gameplayMainExtra:     hltb.gameplayMainExtra ?? null,
            gameplayCompletionist: hltb.gameplayCompletionist ?? null,
            imageUrl:              hltb.imageUrl ?? null,
        } : null,

        itad: itad ? {
            bestPrice:     itad.deals?.[0]
                ? { price: itad.deals[0].price, cut: itad.deals[0].cut, store: itad.deals[0].store }
                : null,
            historicalLow: itad.historicalLow ?? null,
        } : null,

        pcgw: pcgw?.found ? {
            pageTitle:           pcgw.pageTitle,
            pageUrl:             pcgw.pageUrl,
            drm:                 pcgw.availability?.drm ?? [],
            cloudSaves:          pcgw.cloud?.steam ?? null,
            ultrawide:           pcgw.video?.ultrawide ?? null,
            widescreen:          pcgw.video?.widescreen ?? null,
            hdr:                 pcgw.video?.hdr ?? null,
            highFramerate:       pcgw.video?.fps120 ?? pcgw.video?.fps60 ?? null,
            frameRateCap:        pcgw.video?.frameRateCap ?? null,
            controllerSupport:   pcgw.input?.controller?.support ?? null,
            controllerRemapping: pcgw.input?.controller?.remapping ?? null,
            nativeController:    pcgw.input?.controller?.fullSupport ?? null,
        } : null,
    };
}

/**
 * The three whole-list sources (library, steam wishlist, local wishlist) plus the
 * appid universe they imply. Shared by the full and incremental rebuilds so the
 * degraded-read guards below can never apply to only one of them.
 */
async function _readListSources(caller) {
    // Both getSteamGames() and getWishlist() are real ManagedFile reads that can legitimately fail
    // (e.g. a hiccup on the network-share DATA_DIR) — caught so one bad read doesn't fail the whole
    // cache build, but logged loudly since a silent empty fallback here previously masked a real
    // race-condition bug (see steam.service.js's _load*File loaders) that tagged only a handful of
    // games as wishlisted instead of the real ~1100.
    const [steamData, wishlistData, localData] = await Promise.all([
        getSteamGames().catch((err) => { logger.error(`[games] getSteamGames() failed in ${caller}`, { err: err.message }); return null; }),
        getWishlist().catch((err) => { logger.error(`[games] getWishlist() failed in ${caller}`, { err: err.message }); return { items: {} }; }),
        readLocalWishlist(),
    ]);

    const wishlistItems = wishlistData?.items ?? {};
    const localItems    = localData?.items ?? {};

    // A degraded library read must NOT silently persist over the good sidecar. Building
    // from wishlist/local alone still yields a NON-empty array, which slips past
    // persisted-index's fully-empty glitch guard and overwrites the good index. Two
    // transient-failure signatures, both of which we treat as "abort the rebuild" so
    // createPersistedIndex.refresh() keeps the last good index:
    //   1. getSteamGames() threw (returned null above).
    //   2. the library came back empty while a wishlist/local list is present — you own
    //      games, so an empty library alongside a non-empty wishlist is a read failure,
    //      not a real state.
    if (steamData === null) {
        throw new Error('[games] getSteamGames() read failed — aborting rebuild to preserve the good games index');
    }
    const steamGames = steamData.games ?? [];
    if (steamGames.length === 0 && (Object.keys(wishlistItems).length > 0 || Object.keys(localItems).length > 0)) {
        throw new Error('[games] Steam library empty while wishlist/local is non-empty — treating as a transient read failure, aborting rebuild to preserve the good games index');
    }

    const libraryMap = new Map(steamGames.map((g) => [g.appid, g]));
    const allAppids  = new Set([
        ...libraryMap.keys(),
        ...Object.keys(wishlistItems).map(Number),
        ...Object.keys(localItems).map(Number),
    ]);

    return { libraryMap, wishlistItems, localItems, allAppids };
}

function _wishlistEntryFor(appid, wishlistItems, localItems) {
    const steamWL = wishlistItems[String(appid)];
    const localWL = localItems[String(appid)];
    if (steamWL) return { appid, ...steamWL };
    if (localWL) return { appid, dateAdded: localWL.dateAdded, local: true };
    return null;
}

/** Re-merge one game from its four per-appid source files. */
async function _mergeOne(appid, libraryMap, wishlistItems, localItems) {
    const [store, hltb, pcgw, itad] = await Promise.all([
        getGameDetail(appid),
        getHltbEntry(appid),
        getPcgwEntry(appid),
        getItadEntry(appid),
    ]);
    return mergeGame(libraryMap.get(appid) ?? null, _wishlistEntryFor(appid, wishlistItems, localItems), store, hltb, pcgw, itad);
}

async function _buildAll() {
    const { libraryMap, wishlistItems, localItems, allAppids } = await _readListSources('_buildAll');
    return mapChunked([...allAppids], (appid) => _mergeOne(appid, libraryMap, wishlistItems, localItems));
}

// ── Incremental rebuild ───────────────────────────────────────────────────────
// A merged entry is a pure function of one game's four per-appid source files plus
// its library/wishlist row. Re-reading all of them cost 54.6s against the NAS
// (12,939 files, 50 MB) — every 30 minutes, to pick up a handful of changes.
//
// Measured on prod: readdir + stat over those same 12,939 entries takes 363 ms
// (CIFS returns attributes with the directory listing), and a typical hour changes
// 2 files. So the refresh stats the sources, re-merges only the appids whose
// signature moved, and reuses the existing entry for everything else.
//
// Signatures live in their own sidecar next to the index (shared/source-signatures.js).
// If it is missing, unreadable or foreign, the refresh silently falls back to the full
// rebuild — the delta is an optimisation and must never be the reason data is wrong.

// Above this share of the library changing, the delta stops paying for itself and a
// straight rebuild is simpler (bulk store re-sync, first run after a schema change).
const FULL_REBUILD_RATIO = 0.5;

const _sigs = createSourceSignatures({
    name: 'games',
    file: () => path.join(featureDir('steam'), 'games-index-sources.json'),
    dirs: () => ({
        store: path.join(featureDir('steam'), 'store'),
        hltb:  featureDir('hltb'),
        pcgw:  featureDir('pcgw'),
        itad:  featureDir('itad'),
    }),
});


/**
 * Fields of a merged entry that come from the library/wishlist rows rather than the
 * per-appid files. Playtime moves every time you play, and no file mtime reflects
 * that, so these are diffed directly against the existing entry.
 */
function _rowChanged(entry, appid, libraryMap, wishlistItems, localItems) {
    const steam = libraryMap.get(appid) ?? null;
    const wl    = _wishlistEntryFor(appid, wishlistItems, localItems);

    const inLibrary  = !!steam;
    const inWishlist = !!wl;
    const source = inLibrary && inWishlist ? 'both' : inLibrary ? 'library' : inWishlist ? 'wishlist' : 'discovered';
    if (entry.source !== source) return true;
    if ((steam?.playtime_forever ?? 0) !== (entry.playtimeMinutes ?? 0)) return true;
    if (steam?.name && steam.name !== entry.name) return true;
    if ((steam?.img_icon_url ?? null) !== (entry.iconUrl ?? null)) return true;

    const prevWl = entry.wishlist ?? null;
    if (!wl !== !prevWl) return true;
    if (wl && prevWl) {
        if ((wl.priority ?? null) !== (prevWl.priority ?? null)) return true;
        if ((wl.date_added ?? wl.dateAdded) !== prevWl.dateAdded) return true;
        if ((wl.local === true) !== (prevWl.local === true)) return true;
    }
    return false;
}

/**
 * Rebuild by re-merging only what changed. Returns the full merged array (the
 * persisted index shape is unchanged) — most entries are the previous objects,
 * reused as-is. Falls back to a full rebuild whenever the baseline is unusable.
 */
async function _buildIncremental() {
    const prev = _idx.get();
    // Nothing to diff against — build everything AND record the baseline, or the next
    // refresh would find no signatures and rebuild fully all over again.
    if (!prev.length) return _buildAllAndRecord();

    const baseline = await _sigs.load();
    if (!baseline) {
        logger.info('[games] No usable source signatures — doing a full rebuild to establish them');
        return _buildAllAndRecord();
    }

    const t0 = Date.now();
    const { libraryMap, wishlistItems, localItems, allAppids } = await _readListSources('_buildIncremental');
    const sigs    = await _sigs.scan();
    const statMs  = Date.now() - t0;

    const prevById = new Map(prev.map(g => [g.appid, g]));
    const changed  = [];
    for (const appid of allAppids) {
        const entry = prevById.get(appid);
        if (!entry) { changed.push(appid); continue; }                       // new to the library/wishlist
        if ((sigs.get(appid) ?? '') !== (baseline.sigs[appid] ?? '')) { changed.push(appid); continue; }
        if (_rowChanged(entry, appid, libraryMap, wishlistItems, localItems)) changed.push(appid);
    }

    if (changed.length > allAppids.size * FULL_REBUILD_RATIO) {
        logger.info('[games] Most of the library changed — full rebuild is cheaper', { changed: changed.length, total: allAppids.size });
        return _buildAllAndRecord();
    }

    const remerged = await mapChunked(changed, (appid) => _mergeOne(appid, libraryMap, wishlistItems, localItems));
    const byId     = new Map(remerged.map(g => [g.appid, g]));

    // Shape check against a freshly merged entry: if mergeGame's output changed, the
    // reused entries are stale in a way no mtime reveals, so rebuild everything.
    // Always the reference game, never "whichever one changed" — see shapeRefKey.
    const refAppid = shapeRefKey(allAppids);
    const shape    = shapeOf(byId.get(refAppid) ?? await _mergeOne(refAppid, libraryMap, wishlistItems, localItems));
    if (baseline.shape && baseline.shape !== shape) {
        logger.info('[games] Merged entry shape changed — full rebuild so every entry is re-derived');
        return _buildAllAndRecord();
    }

    // Rebuild in allAppids order so removed games drop out and new ones are included.
    const next = [...allAppids].map(appid => byId.get(appid) ?? prevById.get(appid)).filter(Boolean);

    await _sigs.persist(sigs, shape);
    logger.info('[games] Incremental refresh', {
        changed: changed.length, reused: next.length - changed.length, total: next.length,
        statMs, totalMs: Date.now() - t0,
    });
    return next;
}

/**
 * Full rebuild, recording the signatures so the NEXT refresh can go incremental.
 *
 * Signatures are captured BEFORE the merge, and that order matters. Stat first and a
 * file written mid-rebuild gets a newer mtime than the one recorded, so the next
 * refresh re-reads it — at worst a redundant read of a file we already picked up.
 * Stat afterwards and that same write is recorded as "already accounted for", so a
 * value we merged from the OLD content would look current forever.
 */
async function _buildAllAndRecord() {
    const sigs  = await _sigs.scan();
    const games = await _buildAll();
    // Same reference game the incremental path will sample, so the two are comparable.
    const refAppid = shapeRefKey(games.map(g => g.appid));
    await _sigs.persist(sigs, shapeOf(games.find(g => g.appid === refAppid)));
    return games;
}

// Fast-boot: the merged games list is persisted to a sidecar so boot() loads it
// in one read instead of re-scanning every game's store/hltb/pcgw/itad files
// (~40s). _byId is a cheap derived Map rebuilt on every index change via the
// onIndex hook; the poster-pool refresh runs only on an actual rebuild.
function gamesIndexFile() { return path.join(featureDir('steam'), 'games-index.json'); }

let _byId = new Map();

const _idx = createPersistedIndex({
    name: 'games',
    file: gamesIndexFile,
    rebuild: async () => {
        const games = await _buildIncremental();
        refreshPosterPool(games).catch(err => logger.error('[games] Poster pool refresh failed', { err: err.message }));
        return games;
    },
    onIndex: (games) => { _byId = new Map(games.map((g) => [g.appid, g])); },
});

/** Fast boot: load the persisted sidecar, then refresh in the background. */
export async function boot() { await _idx.boot(); }

/** Full rebuild + persist. Registered with cache-manager (post-sync refresh). */
export async function build() { await _idx.refresh(); }

/** Lazy guard for request paths that run before boot() (dev, tests). */
export function ensureBuilt() { return _idx.ensureLoaded(); }

export function getAll() { return _idx.get(); }
export function getOne(appid) { return _byId.get(Number(appid)) ?? null; }
export function getCacheMeta() { return _idx.meta(); }

// Builds a game object on-demand from disk for games not in the owned/wishlist index
// (i.e. discovered via global top). Returns null if no store data exists yet.
export async function getOneDiscovered(appid) {
    const id    = Number(appid);
    const store = await getGameDetail(id);
    if (!store) return null;

    const [hltb, pcgw, itad] = await Promise.all([
        getHltbEntry(id),
        getPcgwEntry(id),
        getItadEntry(id),
    ]);

    return mergeGame(null, null, store, hltb, pcgw, itad);
}

// Force-rebuild a single game entry from disk and splice it into the live cache.
// Call after store data changes for a known library/wishlist game.
export async function rebuildOne(appid) {
    if (!_idx.loaded()) return null;
    const id = Number(appid);

    const [wishlistData, localData, steamData] = await Promise.all([
        getWishlist().catch(() => ({ items: {} })),
        readLocalWishlist(),
        getSteamGames().catch(() => ({ games: [] })),
    ]);

    const steam       = (steamData.games ?? []).find(g => g.appid === id) ?? null;
    const steamWL     = (wishlistData.items ?? {})[String(id)];
    const localWL     = (localData.items   ?? {})[String(id)];
    const wishlistEntry = steamWL
        ? { appid: id, ...steamWL }
        : localWL
            ? { appid: id, dateAdded: localWL.dateAdded, local: true }
            : null;

    const [store, hltb, pcgw, itad] = await Promise.all([
        getGameDetail(id),
        getHltbEntry(id),
        getPcgwEntry(id),
        getItadEntry(id),
    ]);

    const game = mergeGame(steam, wishlistEntry, store, hltb, pcgw, itad);
    // Targeted delta: replace in place (preserve order) or append. onIndex keeps
    // _byId in sync; mutate persists the sidecar. No full rescan.
    await _idx.mutate((cache) => {
        const next = [...cache];
        const i = next.findIndex(g => g.appid === id);
        if (i >= 0) next[i] = game; else next.push(game);
        return next;
    });
    return game;
}

register('games', build);

// Re-build exactly one game entry and splice it into the live cache.
export async function patchGame(appid) {
    if (!_idx.loaded()) return; // cache not initialised yet — full build will cover it

    const id      = Number(appid);
    const existing = _byId.get(id);

    const [wishlistData, localData] = await Promise.all([
        getWishlist().catch(() => null),   // null = read FAILED (distinct from a genuinely empty {})
        readLocalWishlist(),
    ]);

    // A transient wishlist read must not drop a wishlist-only game from the cache (inWishlist would
    // wrongly compute false and remove it) — skip the delta; the next successful build reconciles.
    if (wishlistData === null) {
        logger.warn('[games] patchGame: wishlist read failed — skipping delta', { appid: id });
        return;
    }

    const steamWL = (wishlistData.items ?? {})[String(id)];
    const localWL = (localData.items  ?? {})[String(id)];

    const wishlistEntry = steamWL
        ? { appid: id, ...steamWL }
        : localWL
            ? { appid: id, dateAdded: localWL.dateAdded, local: true }
            : null;

    if (existing) {
        // Game already cached — only wishlist state changed. Targeted delta.
        const inLibrary  = existing.source === 'library' || existing.source === 'both';
        const inWishlist = !!wishlistEntry;

        if (!inLibrary && !inWishlist) {
            await _idx.mutate(cache => cache.filter(g => g.appid !== id));
            return;
        }

        const nextWishlist = wishlistEntry ? {
            priority:  wishlistEntry.priority ?? null,
            dateAdded: wishlistEntry.date_added ?? wishlistEntry.dateAdded,
            local:     wishlistEntry.local === true,
        } : null;
        const nextSource = inLibrary && inWishlist ? 'both'
            : inLibrary  ? 'library'
            : inWishlist ? 'wishlist'
            : 'discovered';
        await _idx.mutate(cache => cache.map(g =>
            g.appid === id ? { ...g, wishlist: nextWishlist, source: nextSource } : g));
        return;
    }

    // Not in cache — brand new entry (discovery item just wishlisted, provision just ran).
    const [steamData, store, hltb, pcgw, itad] = await Promise.all([
        getSteamGames().catch(() => ({ games: [] })),
        getGameDetail(id),
        getHltbEntry(id),
        getPcgwEntry(id),
        getItadEntry(id),
    ]);

    const steam = (steamData.games ?? []).find(g => g.appid === id) ?? null;

    if (!steam && !wishlistEntry) return; // nothing to add

    const game = mergeGame(steam, wishlistEntry, store, hltb, pcgw, itad);
    await _idx.mutate(cache => [...cache, game]);
}
