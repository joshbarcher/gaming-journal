// Ported verbatim from relay-server src/services/steam/player-counts.service.js
// (docs/relay-fold-in.md §6). Import rewrites only: cache-manager + mapChunked
// from shared/, data paths via featureDir('steam'), and discovery.enqueue now
// imports from the local discovery service (ported in the same batch).
import path from 'node:path';
import fs from 'node:fs/promises';
import logger from '../../logger.js';
import { register } from '../shared/cache-manager.js';
import { enqueue as enqueueDiscovery } from '../discovery/discovery.service.js';
import { mapChunked } from '../shared/map-chunked.js';
import { featureDir } from '../shared/data-root.js';

const STEAM_API   = 'https://api.steampowered.com';
const STORE_API   = 'https://store.steampowered.com';
const YEAR_S      = 365 * 24 * 3600;
const MONTH_S     =  30 * 24 * 3600;
const BUCKET_6H   =   6 * 3600;
const CONCURRENCY = 5;

// ── Paths ─────────────────────────────────────────────────────────────────────

// Consolidated store — single file replacing the old per-appid directory
function storePath()        { return path.join(featureDir('steam'), 'player-counts.json'); }
// Legacy per-file directory (kept as backup after migration, filtered.json still lives here)
function legacyDir()        { return path.join(featureDir('steam'), 'player-counts'); }
function filteredPath()     { return path.join(legacyDir(), 'filtered.json'); }
function gameStorePath(id)  { return path.join(featureDir('steam'), 'store', `${id}.json`); }
function gamesFile()        { return path.join(featureDir('steam'), 'games.json'); }
function wishFile()         { return path.join(featureDir('steam'), 'wishlist.json'); }

async function readJson(p) {
    try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return null; }
}
async function writeJson(p, data) {
    await fs.mkdir(path.dirname(p), { recursive: true });
    // Atomic: tmp + rename, so a crash/torn write can't leave a partial (then
    // unparseable) player-counts.json that a later read would treat as empty.
    const tmp = `${p}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data), 'utf8');
    await fs.rename(tmp, p);
}

// ── In-memory store ───────────────────────────────────────────────────────────

// _data  — full dataset: { [appid]: { name, peakAllTime, samples: [[t, n], ...] } }
// _index — sorted array for the top-100 endpoint (built from _data on each rebuild)
let _data  = null;
let _index = null;

async function _loadAll() {
    // CRITICAL: distinguish "file absent" (ENOENT → fresh {}) from "read failed"
    // (a transient NAS/permissions error or a torn read). Returning {} on a read
    // error and then _saveAll-ing would DESTROY every game's multi-month sample
    // history, leaving one sample each. On a non-ENOENT error, throw so the
    // caller aborts the collect and leaves the good file untouched.
    try {
        return JSON.parse(await fs.readFile(storePath(), 'utf8'));
    } catch (err) {
        if (err.code === 'ENOENT') return {};
        logger.warn('[player-counts] Consolidated store read failed — aborting to protect history', { err: err.message });
        throw err;
    }
}

async function _saveAll(data) {
    await writeJson(storePath(), data);
}

// ── Compaction ────────────────────────────────────────────────────────────────
// Retention tiers:
//   0–30 days  → raw 30-min samples   (up to 1,440 per game)
//   30d–1 year → 6-hour bucket avg    (up to 1,340 per game)
//   > 1 year   → dropped

function _compact(samples) {
    const nowS      = Math.floor(Date.now() / 1000);
    const cutoff1y  = nowS - YEAR_S;
    const cutoff30d = nowS - MONTH_S;

    const inWindow = samples.filter(([t]) => t >= cutoff1y);
    const raw      = inWindow.filter(([t]) => t >= cutoff30d);
    const archive  = inWindow.filter(([t]) => t <  cutoff30d);

    const buckets = new Map();
    for (const [t, n] of archive) {
        const b = Math.floor(t / BUCKET_6H) * BUCKET_6H;
        if (!buckets.has(b)) buckets.set(b, { sum: 0, count: 0 });
        buckets.get(b).sum += n;
        buckets.get(b).count++;
    }
    const compacted = [...buckets.entries()]
        .sort(([a], [b]) => a - b)
        .map(([t, { sum, count }]) => [t, Math.round(sum / count)]);

    return [...compacted, ...raw];
}

// Run compaction on every entry — called once before saving, not per-append.
function _compactAll(data) {
    for (const entry of Object.values(data)) {
        entry.samples = _compact(entry.samples);
    }
}

// ── Sample append (mutates the in-memory data object) ─────────────────────────

function _appendSample(data, appid, name, count, peakHint = null) {
    if (count == null) return;
    const nowS = Math.floor(Date.now() / 1000);
    const id   = Number(appid);

    const entry = data[id] ?? { name: null, peakAllTime: 0, samples: [] };
    if (name && !entry.name) entry.name = name;
    entry.samples.push([nowS, count]);

    const effectivePeak = Math.max(count, peakHint ?? 0);
    if (effectivePeak > (entry.peakAllTime ?? 0)) entry.peakAllTime = effectivePeak;

    data[id] = entry;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function _resolveName(appid, ownedMap) {
    if (ownedMap.has(appid)) return ownedMap.get(appid);
    const store = await readJson(gameStorePath(appid));
    if (store?.name) return store.name;
    try {
        const res  = await fetch(`${STORE_API}/api/appdetails?appids=${appid}&filters=basic_info`);
        const body = await res.json();
        return body[appid]?.data?.name ?? null;
    } catch { return null; }
}

async function _batchFetch(items, fn) {
    for (let i = 0; i < items.length; i += CONCURRENCY) {
        await Promise.allSettled(items.slice(i, i + CONCURRENCY).map(fn));
        if (i + CONCURRENCY < items.length)
            await new Promise(r => setTimeout(r, 150));
    }
}

// ── Owned + wishlisted collection ─────────────────────────────────────────────

export async function collectOwned() {
    const t0 = Date.now();
    const [gamesRaw, wishRaw] = await Promise.all([readJson(gamesFile()), readJson(wishFile())]);
    const games  = Array.isArray(gamesRaw) ? gamesRaw : (gamesRaw?.games ?? []);
    const wish   = Object.keys(wishRaw?.items ?? {}).map(Number);

    const all = new Map(games.map(g => [g.appid, g.name]));
    for (const id of wish) {
        if (!all.has(id)) {
            const store = await readJson(gameStorePath(id));
            all.set(id, store?.name ?? null);
        }
    }

    const data = await _loadAll();
    let failed = 0;

    await _batchFetch([...all.entries()], async ([appid, name]) => {
        try {
            const res  = await fetch(`${STEAM_API}/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appid}`);
            const body = await res.json();
            _appendSample(data, appid, name, body.response?.player_count ?? null);
        } catch { failed++; }
    });

    _compactAll(data);
    await _saveAll(data);
    logger.info('[player-counts] Owned collected', { total: all.size, failed, ms: Date.now() - t0 });
    return { fetched: all.size - failed, failed, total: all.size };
}

// ── Global top collection ─────────────────────────────────────────────────────

export async function collectGlobalTop() {
    const t0     = Date.now();
    const apiKey = process.env.STEAM_API_KEY;
    if (!apiKey) {
        logger.warn('[player-counts] No STEAM_API_KEY — skipping global top');
        return { fetched: 0, failed: 0, total: 0, error: 'no STEAM_API_KEY' };
    }

    let ranks;
    try {
        const res  = await fetch(`${STEAM_API}/ISteamChartsService/GetMostPlayedGames/v1/?key=${apiKey}`);
        const body = await res.json();
        ranks = body.response?.ranks ?? [];
    } catch (err) {
        logger.warn('[player-counts] GetMostPlayedGames failed', { err: err.message });
        return { fetched: 0, failed: 0, total: 0, error: `GetMostPlayedGames failed: ${err.message}` };
    }

    const gamesRaw = await readJson(gamesFile());
    const games    = Array.isArray(gamesRaw) ? gamesRaw : (gamesRaw?.games ?? []);
    const ownedMap = new Map(games.map(g => [g.appid, g.name]));

    const data = await _loadAll();

    // Use GetNumberOfCurrentPlayers for real-time counts — GetMostPlayedGames'
    // concurrent_in_game is a cached snapshot Steam only refreshes every ~24h,
    // producing flat lines for non-owned games.
    let failed = 0;
    await _batchFetch(ranks, async ({ appid, peak_in_game }) => {
        try {
            const res   = await fetch(`${STEAM_API}/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appid}`);
            const body  = await res.json();
            const count = body.response?.player_count ?? null;
            const isNew = !data[appid];
            const name  = data[appid]?.name ?? await _resolveName(appid, ownedMap);
            _appendSample(data, appid, name, count, peak_in_game);
            if (isNew || !name) enqueueDiscovery(appid).catch(() => {});
        } catch (err) {
            failed++;
            logger.debug('[player-counts] Failed to store top game', { appid, err: err.message });
        }
    });

    _compactAll(data);
    await _saveAll(data);
    logger.info('[player-counts] Global top collected', { count: ranks.length, failed, ms: Date.now() - t0 });
    return { fetched: ranks.length - failed, failed, total: ranks.length };
}

// ── Filter (server-side mute list) ───────────────────────────────────────────

async function _readFiltered() {
    const d = await readJson(filteredPath());
    return new Set(Array.isArray(d) ? d : []);
}
async function _writeFiltered(set) {
    await writeJson(filteredPath(), [...set]);
}

export async function getFiltered() {
    return [...(await _readFiltered())];
}

export async function addFiltered(appid) {
    const id  = Number(appid);
    const set = await _readFiltered();
    set.add(id);
    await _writeFiltered(set);
    if (_index) {
        const entry = _index.find(e => e.appid === id);
        if (entry) entry.filtered = true;
    }
}

export async function removeFiltered(appid) {
    const id  = Number(appid);
    const set = await _readFiltered();
    set.delete(id);
    await _writeFiltered(set);
    if (_index) {
        const entry = _index.find(e => e.appid === id);
        if (entry) entry.filtered = false;
    }
}

// ── Data access ───────────────────────────────────────────────────────────────

// Served from the in-memory store — no file read on every request.
// Controller still uses `await` on this, which is fine with a sync return.
export function getHistory(appid) {
    return _data?.[Number(appid)] ?? null;
}

// ── Index helpers ─────────────────────────────────────────────────────────────

function _peak(samples, windowMs) {
    const cutoff = Math.floor((Date.now() - windowMs) / 1000);
    let peak = 0;
    for (const [t, n] of samples) if (t >= cutoff && n > peak) peak = n;
    return peak || null;
}

function _samples24h(samples) {
    const cutoff = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
    return samples.filter(([t]) => t >= cutoff);
}

// ── One-time migration from per-file directory ────────────────────────────────

async function _migrate() {
    logger.info('[player-counts] Migrating from per-file store to consolidated file…');
    const t0 = Date.now();

    let files;
    try {
        files = await fs.readdir(legacyDir());
    } catch {
        await _saveAll({});
        return;
    }

    const data     = {};
    const eligible = files.filter(f => f.endsWith('.json') && f !== 'filtered.json');
    await mapChunked(eligible, async f => {
        const d = await readJson(path.join(legacyDir(), f));
        if (!d?.samples?.length) return;
        const id = Number(d.appid);
        data[id] = {
            name:        d.name ?? null,
            peakAllTime: d.peakAllTime ?? 0,
            samples:     _compact(d.samples),
        };
    });

    await _saveAll(data);
    logger.info('[player-counts] Migration complete', { count: Object.keys(data).length, ms: Date.now() - t0 });
}

// ── Build in-memory index ─────────────────────────────────────────────────────

export async function build() {
    const t0 = Date.now();

    // Auto-migrate from legacy per-file format on first run
    try { await fs.access(storePath()); } catch { await _migrate(); }

    const [raw, gamesRaw, wishRaw, filteredSet] = await Promise.all([
        _loadAll(),
        readJson(gamesFile()),
        readJson(wishFile()),
        _readFiltered(),
    ]);

    _data = raw;

    const games    = Array.isArray(gamesRaw) ? gamesRaw : (gamesRaw?.games ?? []);
    const ownedSet = new Set(games.map(g => g.appid));
    const wishSet  = new Set(Object.keys(wishRaw?.items ?? {}).map(Number));

    _index = Object.entries(_data)
        .filter(([, d]) => d.samples?.length)
        .map(([id, d]) => {
            const appid  = Number(id);
            const latest = d.samples[d.samples.length - 1]?.[1] ?? 0;
            return {
                appid,
                name:        d.name ?? null,
                owned:       ownedSet.has(appid),
                wishlisted:  wishSet.has(appid),
                filtered:    filteredSet.has(appid),
                latest,
                peak24h:     _peak(d.samples, 24 * 60 * 60 * 1_000),
                peak7d:      _peak(d.samples, 7  * 24 * 60 * 60 * 1_000),
                peakAllTime: d.peakAllTime ?? latest,
                samples24h:  _samples24h(d.samples),
            };
        })
        .sort((a, b) => b.latest - a.latest);

    logger.info('[player-counts] Index built', { count: _index.length, ms: Date.now() - t0 });
}

/**
 * Fold-in shim (not in the relay): the relay builds this cache unconditionally
 * in server.js's listen callback. Until boot.js wires build() the same way,
 * routes await this so the first request populates the index. Pure reads when
 * the consolidated player-counts.json exists (it does on the live NAS); the
 * legacy-dir migration write path only fires on a store that never migrated.
 * Idempotent and coalesced; harmless once the boot wiring lands.
 */
let _building = null;
export function ensureBuilt() {
    if (_index !== null) return Promise.resolve();
    _building ??= build().finally(() => { _building = null; });
    return _building;
}

export function getIndex() { return _index ?? []; }

// Patch a game name in-place — avoids a full rebuild just for a name update
export function patchName(appid, name) {
    const id = Number(appid);
    if (!name) return;
    if (_data?.[id] && !_data[id].name) _data[id].name = name;
    if (_index) {
        const entry = _index.find(e => e.appid === id);
        if (entry && !entry.name) entry.name = name;
    }
}

register('player-counts', build);
