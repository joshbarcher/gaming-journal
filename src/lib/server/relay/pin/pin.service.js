import path from 'node:path';
import fs   from 'node:fs/promises';
import logger from '../../logger.js';
import { relayDataRoot } from '../shared/data-root.js';
import { refreshForPin } from '../reddit/reddit.service.js';

const PIN_GRACE_MS           = Number(process.env.PIN_GRACE_MS)           || 30 * 60_000;    // 30 min after session ends
const PIN_MAX_DURATION_MS    = Number(process.env.PIN_MAX_DURATION_MS)    || 4 * 3_600_000;  // 4-hour hard cap
const PIN_MAX_POSTS          = Number(process.env.PIN_MAX_POSTS)          || 200;
const PIN_REFRESH_INTERVAL_MS = Number(process.env.PIN_REFRESH_INTERVAL_MS) || 20 * 60_000; // 20 min between refreshes

let _state         = null;   // persisted PinState | null
let _graceTimer    = null;
let _refreshTimer  = null;
let _refreshing    = false;

function _pinPath() { return path.join(relayDataRoot(), 'pin.json'); }

function _computeExpiresAt(state) {
    const walls = [ new Date(state.pinnedAt).getTime() + PIN_MAX_DURATION_MS ];
    if (state.sessionEndedAt) {
        walls.push(new Date(state.sessionEndedAt).getTime() + PIN_GRACE_MS);
    }
    return new Date(Math.min(...walls)).toISOString();
}

function _isExpired(state) {
    const now = Date.now();
    if (now > new Date(state.pinnedAt).getTime() + PIN_MAX_DURATION_MS)    return true;
    if (state.postsAccumulated >= PIN_MAX_POSTS)                            return true;
    if (state.sessionEndedAt) {
        if (now > new Date(state.sessionEndedAt).getTime() + PIN_GRACE_MS) return true;
    }
    return false;
}

async function _persist(state) {
    try {
        await fs.mkdir(path.dirname(_pinPath()), { recursive: true });
        await fs.writeFile(_pinPath(), JSON.stringify(state, null, 2));
    } catch (err) {
        logger.warn('[pin] Failed to persist state', { err: err.message });
    }
}

function _stopGraceTimer() {
    if (_graceTimer) { clearTimeout(_graceTimer); _graceTimer = null; }
}

function _stopRefreshTimer() {
    if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
}

function _clearState() {
    _state = null;
    _stopGraceTimer();
    _stopRefreshTimer();
    fs.unlink(_pinPath()).catch(() => {});
    logger.info('[pin] Pin cleared');
}

// ── Background refresh ────────────────────────────────────────────────────────

async function _tick() {
    logger.info('[pin] _tick fired', { state: _state ? { appid: _state.appid, refreshing: _refreshing } : null });
    const current = get();
    if (!current) { logger.info('[pin] _tick: no active pin, skipping'); return; }
    if (_refreshing) { logger.info('[pin] _tick: already refreshing, skipping'); return; }

    _refreshing = true;
    try {
        logger.info('[pin] Background refresh starting', { appid: current.appid, name: current.name });
        const { newCount } = await refreshForPin(current.appid, current.name);
        logger.info('[pin] Background refresh done', { appid: current.appid, newCount });
        await recordRefresh(newCount);
    } catch (err) {
        logger.warn('[pin] Background refresh failed', { appid: _state?.appid, err: err.message, stack: err.stack });
    } finally {
        _refreshing = false;
    }
}

function _startRefreshTimer() {
    logger.info('[pin] _startRefreshTimer called', { appid: _state?.appid });
    _stopRefreshTimer();
    _tick();
    _refreshTimer = setInterval(_tick, PIN_REFRESH_INTERVAL_MS);
    logger.info('[pin] Refresh timer started', { intervalMs: PIN_REFRESH_INTERVAL_MS });
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Returns the current pin with a computed expiresAt, or null if none / expired. */
export function get() {
    if (!_state) return null;
    if (_isExpired(_state)) { _clearState(); return null; }
    return { ..._state, expiresAt: _computeExpiresAt(_state) };
}

/** Pin a game. Called by now-playing on session open, or by the manual-pin endpoint. */
export async function set(appid, name, reason = 'manual') {
    _stopGraceTimer();
    _state = {
        appid,
        name,
        pinnedAt:         new Date().toISOString(),
        reason,
        sessionEndedAt:   null,
        postsAccumulated: 0,
        lastRefreshedAt:  null,
    };
    await _persist(_state);
    _startRefreshTimer();
    logger.info('[pin] Game pinned', { appid, name, reason });
}

/**
 * Called by now-playing when a session closes.
 * Starts the grace-period countdown; the refresh timer stays active so content
 * keeps updating during the grace window.
 */
export async function clearIfPlaying() {
    if (!_state || _state.reason !== 'playing') return;

    _state.sessionEndedAt = new Date().toISOString();
    await _persist(_state);
    logger.info('[pin] Session ended — grace period started', {
        appid:   _state.appid,
        graceMs: PIN_GRACE_MS,
    });

    _stopGraceTimer();
    _graceTimer = setTimeout(() => {
        logger.info('[pin] Grace period elapsed, clearing pin', { appid: _state?.appid });
        _clearState();
    }, PIN_GRACE_MS);
}

/** Hard unpin — used by the DELETE endpoint. */
export async function clear() {
    _clearState();
}

/** Increments the accumulated-posts counter; expires the pin if limit reached. */
export async function recordRefresh(newPostCount) {
    if (!_state) return;
    _state.postsAccumulated += newPostCount;
    _state.lastRefreshedAt   = new Date().toISOString();
    await _persist(_state);
    logger.info('[pin] Refresh recorded', {
        appid: _state.appid, newPosts: newPostCount, total: _state.postsAccumulated,
    });
    if (_state.postsAccumulated >= PIN_MAX_POSTS) {
        logger.info('[pin] Post accumulation limit reached, clearing pin', {
            appid: _state.appid, total: _state.postsAccumulated,
        });
        _clearState();
    }
}

/** Restores persisted pin state and refresh timer on relay startup. */
export async function startup() {
    let saved;
    try {
        const raw = await fs.readFile(_pinPath(), 'utf8');
        saved = JSON.parse(raw);
    } catch { return; }

    if (_isExpired(saved)) {
        logger.info('[pin] Restored pin already expired, discarding', { appid: saved.appid });
        await fs.unlink(_pinPath()).catch(() => {});
        return;
    }

    _state = saved;
    _startRefreshTimer();

    // If the session had already ended, restart the remaining grace countdown.
    if (_state.sessionEndedAt) {
        const remaining = new Date(_state.sessionEndedAt).getTime() + PIN_GRACE_MS - Date.now();
        if (remaining > 0) {
            _graceTimer = setTimeout(() => {
                logger.info('[pin] Grace period elapsed after restart, clearing pin');
                _clearState();
            }, remaining);
        } else {
            _clearState();
            return;
        }
    }

    logger.info('[pin] Pin state restored', {
        appid:  _state.appid,
        name:   _state.name,
        reason: _state.reason,
    });
}
