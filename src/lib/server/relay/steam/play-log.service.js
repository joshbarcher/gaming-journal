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

const _store  = new Map();
let   _loaded = false;

function _sessionsDir() {
    return path.join(featureDir('steam'), 'sessions');
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
}

// ── Startup ───────────────────────────────────────────────────────────────────

/**
 * Load all per-game session files from disk into the in-memory store.
 * Call once at server startup.  Subsequent calls are no-ops.
 */
export async function load() {
    if (_loaded) return;
    _loaded = true;

    const dir = _sessionsDir();
    try {
        await fs.mkdir(dir, { recursive: true });
        const files = await fs.readdir(dir);
        let   count = 0;

        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            const appid = Number(file.replace('.json', ''));
            if (!appid) continue;

            try {
                const raw = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'));
                _store.set(appid, {
                    name:        raw.name        ?? `App ${appid}`,
                    baseline:    raw.baseline    ?? 0,
                    openSession: raw.openSession ?? null,
                    sessions:    raw.sessions    ?? [],
                });
                count++;
            } catch (err) {
                logger.warn('[play-log] Skipping corrupt game file', { file, err: err.message });
            }
        }

        logger.info('[play-log] Loaded session files', { count });
    } catch (err) {
        logger.warn('[play-log] Could not read sessions directory', { err: err.message });
    }
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
