// Ported verbatim from relay-server src/services/steam/play-log.service.js
// (docs/relay-fold-in.md §6 — logic byte-identical; only imports + data-dir
// helpers rewritten). Data stays under $RELAY_DATA_ROOT/steam/sessions.
//
// WAVE-4 FILE PORTED EARLY AS A READ DEPENDENCY. steam.service's achievement
// sync reads getOpenSession() and the GET /relay/api/steam/games route reads
// getLastPlayedMap() — both are pure reads over the in-memory store loaded
// from disk by load(). The WRITE half (openSession/closeSession/patchOpenSession/
// setBaseline/clearOpenSession) is only ever called by the now-playing poller,
// which stays in the relay until Wave 4 — the journal must not call those
// functions outside tests while the relay still owns the session files.
//
// Until Wave 4 boot-wires load(), consumers load lazily (load() is idempotent);
// note the store is a boot-time snapshot — sessions the relay records after the
// journal process loads are not visible until restart (Wave-3→4 window, see the
// fold-in report for this port).
import path from 'node:path';
import fs   from 'node:fs/promises';
import logger from '../../logger.js';
import { featureDir } from '../shared/data-root.js';

const RETENTION_MS        = 30 * 24 * 60 * 60 * 1_000;   // 30 days
const BASELINE_BUFFER_MIN = 10;   // absorbs Steam rounding + poll drift

// ── In-memory store ───────────────────────────────────────────────────────────
// Map<appid (number), { name, baseline, openSession, sessions }>
//
// All reads come from this map.  Writes mutate the map then flush the
// affected game's individual file under DATA_DIR/relay/steam/sessions/.
//
// load() must be called once at server startup (before the now-playing
// poller or any other consumer runs).  After that, everything is in-memory.

let   _store  = new Map();
let   _loaded = false;

function _sessionsDir() {
    return path.join(featureDir('steam'), 'sessions');
}

// ── Boot snapshot ─────────────────────────────────────────────────────────────
// load() used to read all ~750 per-game session files individually. That is the
// slowest thing in startup: 3s on local disk, ~51s on the NAS while the index
// refreshes compete for it — and it gates the session card, the history/last-played
// backdrops and the 30-day hours, so the landing page renders visibly incomplete
// until it finishes (measured: last boot line to appear, +51.2s).
//
// So the store is also written to ONE snapshot file, read in a single call at boot.
// The per-game files remain the source of truth: the snapshot is only an
// accelerator, and a missing/corrupt/stale one falls back to (or is repaired by) the
// full scan. Same shape of guarantee as shared/persisted-index.js, but that helper
// models a read-only array index — this store is mutated by the now-playing poller,
// so it needs its own write-aware handling below.
const SNAPSHOT_VERSION      = 1;
const SNAPSHOT_DEBOUNCE_MS  = 3_000;

let _snapshotTimer     = null;
let _scanning          = false;
let _closed            = false;
const _writtenDuringScan = new Set();

function _snapshotPath() {
    return path.join(featureDir('steam'), 'sessions-index.json');
}

function _entry(appid, raw) {
    return {
        name:        raw.name        ?? `App ${appid}`,
        baseline:    raw.baseline    ?? 0,
        openSession: raw.openSession ?? null,
        sessions:    raw.sessions    ?? [],
    };
}

async function _persistSnapshot() {
    if (_closed) return;
    const games = [];
    for (const [appid, g] of _store) games.push({ appid, ...g });
    const file = _snapshotPath();
    const tmp  = `${file}.tmp`;
    try {
        // Deliberately no mkdir: every path that reaches here has already created the
        // steam dir (the scan and _flush both mkdir the sessions dir beneath it), and
        // re-creating it would let a late debounced write resurrect a tree that was
        // deliberately removed. The snapshot is only an accelerator, so a skipped
        // write costs nothing — the next flush or boot scan rewrites it.
        //
        // tmp + rename so a torn write can never be read back as a valid snapshot.
        await fs.writeFile(tmp, JSON.stringify({ v: SNAPSHOT_VERSION, builtAt: new Date().toISOString(), games }));
        await fs.rename(tmp, file);
    } catch (err) {
        if (err.code === 'ENOENT') return;   // data dir went away — nothing to accelerate
        logger.warn('[play-log] Snapshot persist failed', { err: err.message });
    }
}

/** Debounced: a poller tick can flush several games in a row; one rewrite covers them. */
function _scheduleSnapshot() {
    if (_snapshotTimer) return;
    _snapshotTimer = setTimeout(() => {
        _snapshotTimer = null;
        _persistSnapshot().catch(() => { /* logged in _persistSnapshot */ });
    }, SNAPSHOT_DEBOUNCE_MS);
    _snapshotTimer.unref?.();   // never hold the process open on shutdown
}

async function _loadSnapshot() {
    try {
        const raw = JSON.parse(await fs.readFile(_snapshotPath(), 'utf8'));
        if (raw?.v !== SNAPSHOT_VERSION || !Array.isArray(raw.games)) return false;
        const next = new Map();
        for (const g of raw.games) {
            const appid = Number(g.appid);
            if (appid) next.set(appid, _entry(appid, g));
        }
        if (next.size === 0) return false;    // nothing useful — scan instead
        _store = next;
        logger.info('[play-log] Loaded from snapshot', { count: _store.size, builtAt: raw.builtAt ?? null });
        return true;
    } catch (err) {
        if (err.code !== 'ENOENT') logger.warn('[play-log] Snapshot unreadable — falling back to scan', { err: err.message });
        return false;
    }
}

/** The original per-file scan, into a fresh Map. Read-only — the caller creates the
 *  directory when that's warranted, so a background reconcile can't resurrect one
 *  that was removed. A missing directory simply scans as empty. */
async function _scanIntoMap() {
    const dir  = _sessionsDir();
    const next = new Map();
    let files;
    try {
        files = await fs.readdir(dir);
    } catch (err) {
        if (err.code === 'ENOENT') return next;
        throw err;
    }
    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const appid = Number(file.replace('.json', ''));
        if (!appid) continue;
        try {
            next.set(appid, _entry(appid, JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'))));
        } catch (err) {
            logger.warn('[play-log] Skipping corrupt game file', { file, err: err.message });
        }
    }
    return next;
}

/**
 * Background reconcile after a snapshot boot: re-read the authoritative per-game
 * files and re-persist. Repairs a snapshot that missed a write (crash between flush
 * and debounce) or was written by an older build.
 */
async function _reconcile() {
    if (_closed) return;
    _scanning = true;
    _writtenDuringScan.clear();
    try {
        const scanned = await _scanIntoMap();
        // Never dump empty over good data — an empty scan against a populated store is
        // a transient read failure, not every session disappearing.
        if (scanned.size === 0 && _store.size > 0) {
            logger.warn('[play-log] Reconcile scan came back empty — keeping snapshot', { kept: _store.size });
            return;
        }
        // A game written while the scan was in flight may have been read before the
        // write landed; the in-memory entry is newer, so it wins.
        for (const appid of _writtenDuringScan) {
            const live = _store.get(appid);
            if (live) scanned.set(appid, live);
        }
        _store = scanned;
        await _persistSnapshot();
        logger.info('[play-log] Reconciled against session files', { count: _store.size });
    } catch (err) {
        logger.warn('[play-log] Reconcile failed — keeping snapshot', { err: err.message });
    } finally {
        _scanning = false;
        _writtenDuringScan.clear();
    }
}

function _filePath(appid) {
    return path.join(_sessionsDir(), `${appid}.json`);
}

function _getOrCreate(appid, name) {
    if (!_store.has(appid)) {
        _store.set(appid, {
            name:        name ?? `App ${appid}`,
            baseline:    0,
            openSession: null,
            sessions:    [],
        });
    }
    return _store.get(appid);
}

async function _flush(appid) {
    const data = _store.get(appid);
    if (!data) return;
    try {
        await fs.mkdir(_sessionsDir(), { recursive: true });
        await fs.writeFile(_filePath(appid), JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
        logger.warn('[play-log] Failed to flush game file', { appid, err: err.message });
    }
    // Keep the boot snapshot current, so the next restart doesn't have to re-scan to
    // learn about this session. Flagged when a reconcile is mid-scan — see _reconcile.
    if (_scanning) _writtenDuringScan.add(appid);
    _scheduleSnapshot();
}

// ── Startup ───────────────────────────────────────────────────────────────────

/**
 * Populate the in-memory store. Call once at server startup; subsequent calls are
 * no-ops.
 *
 * Fast path: one snapshot read, then reconcile against the per-game files in the
 * background. Only a first-ever boot (or an unusable snapshot) pays the full scan,
 * and that scan writes the snapshot so the next boot is fast.
 */
export async function load() {
    if (_loaded) return;
    _loaded = true;

    if (await _loadSnapshot()) {
        _reconcile().catch(() => { /* logged in _reconcile */ });
        return;
    }

    try {
        // First-ever boot legitimately creates the tree; the background reconcile
        // deliberately does not (see _scanIntoMap).
        await fs.mkdir(_sessionsDir(), { recursive: true });
        _store = await _scanIntoMap();
        logger.info('[play-log] Loaded session files', { count: _store.size });
        await _persistSnapshot();
    } catch (err) {
        logger.warn('[play-log] Could not read sessions directory', { err: err.message });
    }
}

/**
 * Flush any pending snapshot write, then stop writing — the shutdown path.
 * Ordered so the final flush still lands, but a background reconcile that finishes
 * afterwards cannot write behind us.
 */
export async function close() {
    if (_snapshotTimer) {
        clearTimeout(_snapshotTimer);
        _snapshotTimer = null;
        await _persistSnapshot();
    }
    _closed = true;
}

/** Test hook: module-level store/flags would otherwise leak between tests. */
export function _resetForTests() {
    _store = new Map();
    _loaded = false;
    _scanning = false;
    _closed = false;
    _writtenDuringScan.clear();
    if (_snapshotTimer) { clearTimeout(_snapshotTimer); _snapshotTimer = null; }
}

// ── Session lifecycle ─────────────────────────────────────────────────────────

export async function openSession(appid, name, startedAt) {
    const game = _getOrCreate(appid, name);
    game.openSession = { startedAt, achievementsAtStart: [], achievementsDuring: [] };
    await _flush(appid);
    logger.debug('[play-log] Session opened', { appid, name });
}

/** Patch fields on the current open session (achievement tracking). */
export async function patchOpenSession(patch) {
    for (const [appid, game] of _store) {
        if (game.openSession) {
            Object.assign(game.openSession, patch);
            await _flush(appid);
            return;
        }
    }
}

export async function closeSession(appid, endedAt, achievements = []) {
    const game = _store.get(appid);
    if (!game?.openSession) return;

    const { startedAt } = game.openSession;
    const durationMin   = Math.max(1, Math.round(
        (new Date(endedAt) - new Date(startedAt)) / 60_000
    ));

    // Prune sessions older than retention window, then append the closed one
    const cutoff    = Date.now() - RETENTION_MS;
    game.sessions   = (game.sessions ?? []).filter(s => new Date(s.startedAt).getTime() > cutoff);
    game.sessions.push({ startedAt, endedAt, durationMin, achievements });
    game.openSession = null;

    await _flush(appid);
    logger.debug('[play-log] Session closed', { appid, durationMin });
}

/**
 * Clear any open session that was left behind on a previous server run.
 * Called at startup when the poller detects the game is no longer playing.
 */
export async function clearOpenSession() {
    for (const [appid, game] of _store) {
        if (game.openSession) {
            game.openSession = null;
            await _flush(appid);
            logger.debug('[play-log] Stale open session cleared on startup');
            return;
        }
    }
}

/**
 * Returns the currently open session, or null.
 * Shape: { appid, name, startedAt, achievementsAtStart, achievementsDuring }
 */
export async function getOpenSession() {
    for (const [appid, game] of _store) {
        if (game.openSession) {
            return { appid, name: game.name, ...game.openSession };
        }
    }
    return null;
}

// ── Playtime ──────────────────────────────────────────────────────────────────

/**
 * Effective total playtime for a game in minutes:
 *   baseline (pre-relay history) + sum of all closed sessions + elapsed
 *   time of the currently-open session (if any).
 *
 * Returns 0 if the relay has never seen this game — callers should then
 * fall back to Steam's playtime_forever.
 */
export function getEffectivePlaytimeMin(appid) {
    const game = _store.get(Number(appid));
    if (!game) return 0;
    const sessionTotal = (game.sessions ?? []).reduce((sum, s) => sum + (s.durationMin ?? 0), 0);
    const openMin = game.openSession
        ? Math.floor((Date.now() - new Date(game.openSession.startedAt).getTime()) / 60_000)
        : 0;
    return (game.baseline ?? 0) + sessionTotal + openMin;
}

/**
 * Set the pre-relay playtime baseline for a game.
 *
 * baseline = max(0, steamTotal − relayTotal)
 *          … zeroed if the difference is within BASELINE_BUFFER_MIN
 *
 * This prevents double-counting: Steam's number already includes sessions
 * the relay has tracked, so we subtract those out.  When the difference
 * is negligibly small (rounding / poll drift), we store 0 rather than
 * a meaningless few-minute artifact.
 */
export async function setBaseline(appid, name, steamTotal, relayTotal = 0) {
    const game = _getOrCreate(Number(appid), name);
    const diff  = steamTotal - relayTotal;
    game.baseline = diff > BASELINE_BUFFER_MIN ? Math.round(diff) : 0;
    await _flush(Number(appid));
    logger.debug('[play-log] Baseline set', { appid, baseline: game.baseline });
}

// ── Display sessions ──────────────────────────────────────────────────────────

/**
 * Returns a map of appid → { lastPlayedAt, effectiveMin } for every game
 * the relay has seen.  Includes the currently-open session so that a game
 * being played right now appears in the map with up-to-date playtime.
 *
 * Used by the home page and library to patch Steam's lagging playtime data.
 */
export function getLastPlayedMap() {
    const result = {};
    for (const [appid, game] of _store) {
        const sessions    = game.sessions ?? [];
        const sessionTotal = sessions.reduce((sum, s) => sum + (s.durationMin ?? 0), 0);

        if (game.openSession) {
            // Game is currently being played — use live elapsed time.
            const openMin = Math.floor(
                (Date.now() - new Date(game.openSession.startedAt).getTime()) / 60_000
            );
            result[appid] = {
                lastPlayedAt: game.openSession.startedAt,
                effectiveMin: (game.baseline ?? 0) + sessionTotal + openMin,
            };
            continue;
        }

        if (!sessions.length) continue;
        // Sessions are appended chronologically; use reduce in case ever out of order.
        const latest = sessions.reduce(
            (best, s) => (!best || s.startedAt > best ? s.startedAt : best),
            null
        );
        if (!latest) continue;
        result[appid] = {
            lastPlayedAt: latest,
            effectiveMin: (game.baseline ?? 0) + sessionTotal,
        };
    }
    return result;
}

/**
 * All sessions shaped for display.  Closed sessions are returned as-is.
 * If a game has an open (active) session it is appended last with
 * endedAt: null and a live durationMin so callers can render it correctly.
 *
 * Shape: { [appid]: { name, sessions: [{ startedAt, endedAt, durationMin, achievements }] } }
 */
export function getSessions() {
    const result = {};
    for (const [appid, game] of _store) {
        const sessions = game.sessions ?? [];
        const hasOpen  = !!game.openSession;
        if (!sessions.length && !hasOpen) continue;

        const shaped = sessions.map(s => ({
            startedAt:    s.startedAt,
            endedAt:      s.endedAt,
            durationMin:  s.durationMin,
            achievements: s.achievements ?? [],
        }));

        if (hasOpen) {
            const openMin = Math.max(1, Math.floor(
                (Date.now() - new Date(game.openSession.startedAt).getTime()) / 60_000
            ));
            shaped.push({
                startedAt:    game.openSession.startedAt,
                endedAt:      null,
                durationMin:  openMin,
                achievements: game.openSession.achievementsDuring ?? [],
            });
        }

        result[appid] = { name: game.name, sessions: shaped };
    }
    return result;
}
