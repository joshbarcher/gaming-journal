// Ported verbatim from relay-server src/services/games/poster-pool.service.js
// (docs/relay-fold-in.md §6). Import rewrites only: data paths via
// featureDir('steam').
//
// NOTE: this file belongs to the `games` feature but was ported in Wave 3
// Batch B (steam store/media) because the featured poller and the discover
// routes depend on it (markSynced / hasPoster / refresh). The rest of the
// games feature (games.service.js, /api/games routes) ports separately —
// when it lands, its cache rebuild must call refresh(games) here, exactly
// as the relay's games.service does.
import path from 'node:path';
import fs from 'node:fs/promises';
import logger from '../../logger.js';
import { featureDir } from '../shared/data-root.js';

const QUEUE_MIN   = 20;
const BATCH_SIZE  = 50;
const MISSING_TTL = 24 * 60 * 60 * 1000;

function indexPath()  { return path.join(featureDir('steam'), 'poster-index.json'); }
function imagesRoot() { return path.join(featureDir('steam'), 'images', 'games'); }

async function statRetry(fn, retries = 4, delayMs = 200) {
    for (let i = 0; i <= retries; i++) {
        try { return await fn(); } catch (err) {
            if (err.code !== 'EAGAIN' || i === retries) throw err;
            await new Promise(r => setTimeout(r, delayMs * (i + 1)));
        }
    }
}

let _indexLoaded = false;
let _entries     = {};   // { [appid]: { hasPoster: boolean, checkedAt: number } }
let _withPoster  = new Set();
let _games       = [];
const _pool      = { library: [], wishlist: [] };

// ── Index persistence ─────────────────────────────────────────────────────────

async function loadIndex() {
    try {
        const raw = await fs.readFile(indexPath(), 'utf8');
        _entries = JSON.parse(raw).entries ?? {};
    } catch {
        _entries = {};
    }
    _indexLoaded = true;
}

async function saveIndex() {
    try {
        await fs.writeFile(indexPath(), JSON.stringify({ entries: _entries }, null, 2));
    } catch (err) {
        logger.error('[poster-pool] Failed to save index', { err: err.message });
    }
}

// ── Poster checking ───────────────────────────────────────────────────────────

async function updateIndex(games) {
    const now      = Date.now();
    const toCheck  = games.filter(g => {
        const e = _entries[String(g.appid)];
        if (!e) return true;
        if (e.hasPoster) return false;
        return (now - e.checkedAt) > MISSING_TTL;
    });

    if (toCheck.length === 0) return;

    logger.info('[poster-pool] Checking poster files', { count: toCheck.length });

    const root    = imagesRoot();
    const results = new Array(toCheck.length);
    let idx = 0;
    async function worker() {
        while (idx < toCheck.length) {
            const i = idx++;
            const g = toCheck[i];
            try {
                await statRetry(() => fs.access(path.join(root, String(g.appid), 'poster.jpg')));
                results[i] = { appid: g.appid, hasPoster: true };
            } catch {
                results[i] = { appid: g.appid, hasPoster: false };
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(8, toCheck.length) }, worker));

    for (const { appid, hasPoster } of results) {
        _entries[String(appid)] = { hasPoster, checkedAt: now };
    }

    _withPoster = new Set(
        Object.entries(_entries)
            .filter(([, e]) => e.hasPoster)
            .map(([id]) => Number(id))
    );

    await saveIndex();
    logger.info('[poster-pool] Index updated', { withPoster: _withPoster.size, checked: toCheck.length });
}

// ── Pool management ───────────────────────────────────────────────────────────

function shuffle(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

function buildBatch(source) {
    const candidates = _games.filter(g => {
        const matchesSource = source === 'library'
            ? g.source === 'library'  || g.source === 'both'
            : g.source === 'wishlist' || g.source === 'both';
        return matchesSource && _withPoster.has(g.appid);
    });
    return shuffle(candidates).slice(0, BATCH_SIZE).map(g => ({
        appid:  g.appid,
        poster: g.media?.poster ?? `/relay/images/steam/games/${g.appid}/poster.jpg`,
        header: g.media?.header ?? `/relay/images/steam/games/${g.appid}/header.jpg`,
    }));
}

function fill(source) {
    while (_pool[source].length < QUEUE_MIN) {
        _pool[source].push(buildBatch(source));
    }
}

function refill() {
    _pool.library  = [];
    _pool.wishlist = [];
    fill('library');
    fill('wishlist');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fold-in shim (not in the relay): load poster-index.json on demand so
 * hasPoster()/markSynced() work before the games feature ports. In the relay,
 * server.js's games cache build calls refresh(games) at boot, which loads the
 * index — the journal has no games boot yet, so the discover route awaits this
 * instead. Idempotent; harmless once the games feature wires refresh().
 */
export async function ensureIndexLoaded() {
    if (_indexLoaded) return;
    await loadIndex();
    _withPoster = new Set(
        Object.entries(_entries)
            .filter(([, e]) => e.hasPoster)
            .map(([id]) => Number(id))
    );
}

export function hasPoster(appid) {
    return _withPoster.has(Number(appid));
}

/**
 * Fill the pool from the PERSISTED index only — no filesystem scan.
 *
 * buildBatch() needs both the index (which appids have a poster) and the games list,
 * and only refresh() ever set the games list. So until the games cache refresh ran,
 * /api/games/posters answered with an empty batch and the landing page's library and
 * wishlist mosaics rendered blank — the empty tiles in the cold-start screenshots.
 * Boot calls this instead: the index is already on disk, so the pool is servable in
 * microseconds. The scan + reconcile stays in refresh(), off the boot path.
 */
export async function prime(games) {
    if (games?.length) _games = games;
    if (_games.length === 0) return;
    await ensureIndexLoaded();
    fill('library');
    fill('wishlist');
    logger.info('[poster-pool] Primed from index', { library: _pool.library.length, wishlist: _pool.wishlist.length });
}

export function getPosterBatch(source) {
    const key   = source === 'wishlist' ? 'wishlist' : 'library';
    const batch = _pool[key].shift() ?? buildBatch(key);
    setImmediate(() => fill(key));
    return batch;
}

/**
 * Called after games cache rebuilds (pass games array) or after image sync (no args).
 * On first call ever: loads index from disk. If index is empty, awaits a full scan
 * before filling so the pool is ready immediately. Otherwise fills from cached index
 * then background-checks new/expired-missing entries.
 */
export async function refresh(games) {
    if (games !== undefined) _games = games;
    if (_games.length === 0) return;

    if (!_indexLoaded) await loadIndex();

    _withPoster = new Set(
        Object.entries(_entries)
            .filter(([, e]) => e.hasPoster)
            .map(([id]) => Number(id))
    );

    const hasIndex = Object.keys(_entries).length > 0;

    if (!hasIndex) {
        // First ever startup — scan everything now so the pool is populated.
        await updateIndex(_games);
        fill('library');
        fill('wishlist');
        logger.info('[poster-pool] Ready (first run)', { library: _pool.library.length, wishlist: _pool.wishlist.length });
    } else {
        // Warm start — fill from known index immediately, diff/recheck in background.
        fill('library');
        fill('wishlist');
        logger.info('[poster-pool] Ready', { library: _pool.library.length, wishlist: _pool.wishlist.length });
        updateIndex(_games).then(refill).catch(err =>
            logger.error('[poster-pool] Background index update failed', { err: err.message })
        );
    }
}

/**
 * Mark specific appids as having a poster (called after syncGameImages so newly
 * downloaded posters are reflected immediately without waiting for the TTL).
 */
export async function markSynced(appids) {
    if (!_indexLoaded) return;
    const now = Date.now();
    let changed = false;
    for (const appid of appids) {
        const key = String(appid);
        if (!_entries[key]?.hasPoster) {
            _entries[key] = { hasPoster: true, checkedAt: now };
            _withPoster.add(Number(appid));
            changed = true;
        }
    }
    if (!changed) return;
    await saveIndex();
    refill();
    logger.info('[poster-pool] Marked synced', { count: appids.length });
}
