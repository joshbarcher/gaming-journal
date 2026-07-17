// Ported from relay-server src/services/steam/now-playing.service.js
// (docs/relay-fold-in.md Phase 5) — with ONE deliberate behavioral divergence:
//
//   ABSENCE DEBOUNCING (the restart-flap fix, the Wave-4 gate). The relay
//   closes the open session the moment a single GetPlayerSummaries response
//   carries no gameid. Steam presence is flaky — especially on the first poll
//   after a process restart — so one transient empty response ended a real
//   session ("post-restart poll flap") and split long sessions in two.
//   Here a session only closes after NOW_PLAYING_CLOSE_MISSES consecutive
//   empty polls (default 3 ≈ 3 minutes), and endedAt is backdated to the
//   FIRST miss so recorded durations stay accurate. A positive game switch
//   (Steam reporting a *different* game) still closes immediately — that
//   signal is trustworthy. Poll *errors* never touch session state (as in
//   the relay). Everything else is byte-identical to the relay's logic.

import { steamFetch } from '../shared/steam-fetch.js';
import { readFlags, isSoftware } from '../shared/flags.js';
import { rebuild } from '../shared/cache-manager.js';
import logger from '../../logger.js';
import {
    openSession,
    closeSession,
    clearOpenSession,
    getOpenSession,
    patchOpenSession,
} from './play-log.service.js';
import { fetchPlayerAchievementsNow, refreshPlayerAchievements, syncAchievementsForGame } from './steam.service.js';
import * as pin from '../pin/pin.service.js';

const STEAM_API            = 'https://api.steampowered.com';
const POLL_INTERVAL_MS     = 60_000;
const ACH_POLL_INTERVAL_MS = 5 * 60_000;   // how often to check for new achievements mid-session

function closeMissThreshold() {
    return Math.max(1, Number(process.env.NOW_PLAYING_CLOSE_MISSES ?? 3));
}

let _cache        = null;   // { appid, name } | null
let _sessionStart = null;   // ISO string — when current game was first detected
let _timer        = null;

// Absence debouncing state (the flap fix)
let _missCount   = 0;       // consecutive polls that saw no game while a session is open
let _firstMissAt = null;    // ISO string of the first empty poll — becomes endedAt on close

// Achievement tracking state — reset on each session change
let _achBaseline = null;    // Set<apiname> | null — unlocked before this session started
let _achDuring   = [];      // { apiname, unlocktime }[] — earned during this session
let _lastAchPoll = 0;       // ms timestamp of last mid-session achievement poll

/** Returns only the achievements unlocked since the session started. */
function _diffAchievements(current, baseline) {
    return current
        .filter(a => a.achieved === 1 && !baseline.has(a.apiname))
        .map(a => ({ apiname: a.apiname, unlocktime: a.unlocktime }));
}

async function fetchNowPlaying(apiKey, steamId) {
    const url = new URL(`${STEAM_API}/ISteamUser/GetPlayerSummaries/v2/`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('steamids', steamId);
    const res    = await steamFetch(url.toString());
    const body   = await res.json();
    const player = body.response?.players?.[0];
    if (!player?.gameid) return null;
    return {
        appid: Number(player.gameid),
        name:  player.gameextrainfo ?? `App ${player.gameid}`,
    };
}

/** Close the session for `prevAppid` at `endedAt`, flushing a final achievement diff. */
async function _closeCurrentSession(prevAppid, endedAt) {
    // Do a final achievement snapshot so nothing earned right at the end is missed.
    let finalAchs = _achDuring;
    if (_achBaseline !== null) {
        // fetchPlayerAchievementsNow returns [] on ANY error (never throws), so an
        // empty result here means the fetch FAILED — not that zero achievements
        // are unlocked. Writing that empty diff into the closed session would drop
        // the real per-session unlocks we accumulated in _achDuring (the exact
        // private-profile/403 loss the achievement fix addressed). Only trust a
        // non-empty fetch, and never shrink below what we already tracked.
        const latest = await fetchPlayerAchievementsNow(prevAppid);
        if (latest.length) {
            const diff = _diffAchievements(latest, _achBaseline);
            if (diff.length >= _achDuring.length) finalAchs = diff;
            if (finalAchs.length > _achDuring.length) {
                logger.info('[now-playing] Achievement(s) earned at session end',
                    { appid: prevAppid, total: finalAchs.length });
            }
        } else {
            logger.debug('[now-playing] Final achievement fetch empty/failed — keeping tracked count',
                { appid: prevAppid, kept: _achDuring.length });
        }
    }

    // If achievements were earned this session, refresh the achievement
    // cache now so the achievements page reflects them immediately.
    if (finalAchs.length > 0) {
        refreshPlayerAchievements(prevAppid).catch(() => {});
    }

    // Reset achievement state before closing
    _achBaseline = null;
    _achDuring   = [];
    _lastAchPoll = 0;

    closeSession(prevAppid, endedAt, finalAchs).catch(err =>
        logger.warn('[now-playing] Failed to persist session close', { err: err.message })
    );
    pin.clearIfPlaying().catch(err =>
        logger.warn('[now-playing] Failed to clear pin on session close', { err: err.message })
    );
}

/** Open a session for `detected` at `now`, capturing the achievement baseline async. */
function _openNewSession(detected, now) {
    const curr = detected.appid;
    _sessionStart = now;
    _achBaseline  = null;   // populated async below
    _achDuring    = [];
    _lastAchPoll  = Date.now();

    openSession(curr, detected.name, now).catch(err =>
        logger.warn('[now-playing] Failed to persist session open', { err: err.message })
    );
    pin.set(curr, detected.name, 'playing').catch(err =>
        logger.warn('[now-playing] Failed to pin game on session open', { err: err.message })
    );
    logger.info('[now-playing] Now playing', { appid: curr, name: detected.name });

    // Capture the achievement baseline and (if needed) the full schema
    // in one pass — avoids a duplicate GetPlayerAchievements call.
    const openedAppid = curr;
    fetchPlayerAchievementsNow(curr).then(achs => {
        if (_cache?.appid !== openedAppid) return; // game already changed

        // Empty = the fetch failed (returns [] on any error), NOT a game with zero
        // achievements — a real game returns its full list even at 0 unlocked. A
        // wrong empty baseline would count every already-unlocked achievement as
        // "earned this session". Leave the baseline null so no bogus diff runs; a
        // later mid-session poll re-attempts capture once the API is readable.
        if (achs.length) {
            _achBaseline = new Set(achs.filter(a => a.achieved === 1).map(a => a.apiname));
            patchOpenSession({ achievementsAtStart: [..._achBaseline] }).catch(() => {});
            logger.debug('[now-playing] Achievement baseline captured',
                { appid: openedAppid, count: _achBaseline.size });
        } else {
            logger.debug('[now-playing] Baseline fetch empty/failed — will retry mid-session', { appid: openedAppid });
        }

        // Ensure the achievement schema is cached for this game.
        // For brand-new games (just bought/installed) it won't exist yet,
        // so the achievements card would show "No achievement data".
        syncAchievementsForGame(openedAppid, detected.name).catch(() => {});
    }).catch(() => {
        // fetchPlayerAchievementsNow never actually throws, but keep the schema
        // fetch on the defensive path in case that contract ever changes.
        if (_cache?.appid === openedAppid) {
            syncAchievementsForGame(openedAppid, detected.name).catch(() => {});
        }
    });
}

async function poll() {
    const apiKey  = process.env.STEAM_API_KEY;
    const steamId = process.env.STEAM_ID;
    if (!apiKey || !steamId) return;

    try {
        const flags    = await readFlags();
        const prev     = _cache?.appid ?? null;
        const raw      = await fetchNowPlaying(apiKey, steamId);
        // Treat software-flagged apps (e.g. Wallpaper Engine) as not playing.
        const detected = (raw && isSoftware(flags, raw.appid)) ? null : raw;
        const curr     = detected?.appid ?? null;

        // ── Absence debouncing (flap fix) ────────────────────────────────────
        if (prev !== null && curr === null) {
            _missCount++;
            if (_missCount === 1) _firstMissAt = new Date().toISOString();
            if (_missCount < closeMissThreshold()) {
                logger.debug('[now-playing] Empty presence — holding session open',
                    { appid: prev, miss: _missCount, threshold: closeMissThreshold() });
                return; // keep _cache/_sessionStart intact; session still "playing"
            }
            // Threshold reached: the session really ended around the first miss.
            const endedAt = _firstMissAt;
            _missCount = 0;
            _firstMissAt = null;
            await _closeCurrentSession(prev, endedAt);
            _sessionStart = null;
            _cache        = null;
            logger.info('[now-playing] Session ended', { was: prev, endedAt });
            rebuild('account').catch(err =>
                logger.warn('[now-playing] Account cache rebuild failed', { err: err.message })
            );
            return;
        }

        // Presence is positive (or no session open) — clear any pending misses.
        _missCount   = 0;
        _firstMissAt = null;

        if (curr !== prev) {
            const now = new Date().toISOString();

            // Positive game switch (or first detection): trust it immediately.
            if (prev !== null) await _closeCurrentSession(prev, now);
            if (curr !== null) {
                _cache = detected;      // set before _openNewSession's async baseline guard
                _openNewSession(detected, now);
            } else {
                _sessionStart = null;
            }

            // Rebuild the account cache immediately so the next GET /api/account
            // reflects the session change — not up to 30 min later on the next
            // snapshot tick.  Fire-and-forget; a failure only means the cache
            // stays at the previous snapshot, which is still valid.
            rebuild('account').catch(err =>
                logger.warn('[now-playing] Account cache rebuild failed', { err: err.message })
            );
        } else if (curr !== null && _cache?.appid === curr) {
            // Same game still playing — poll for new achievements every ACH_POLL_INTERVAL_MS.
            const nowMs = Date.now();
            if (nowMs - _lastAchPoll >= ACH_POLL_INTERVAL_MS) {
                _lastAchPoll = nowMs;
                try {
                    const achs = await fetchPlayerAchievementsNow(curr);
                    // Empty = fetch failed (never throws) — skip this tick entirely
                    // rather than resetting tracked progress to []. Session state is
                    // left untouched until a readable response arrives.
                    if (!achs.length) {
                        logger.debug('[now-playing] Mid-session achievement poll empty/failed — skipping', { appid: curr });
                    } else {
                        // Late baseline capture: if the open-time fetch failed, seize
                        // the first good mid-session read as the baseline (nothing was
                        // tracked yet, so there's no progress to lose).
                        if (_achBaseline === null) {
                            _achBaseline = new Set(achs.filter(a => a.achieved === 1).map(a => a.apiname));
                            patchOpenSession({ achievementsAtStart: [..._achBaseline] }).catch(() => {});
                            logger.debug('[now-playing] Baseline captured late (mid-session)', { appid: curr, count: _achBaseline.size });
                        }
                        const newAchs = _diffAchievements(achs, _achBaseline);
                        if (newAchs.length > _achDuring.length) {
                            logger.info('[now-playing] Achievement(s) earned mid-session',
                                { appid: curr, gained: newAchs.length - _achDuring.length, total: newAchs.length });
                            refreshPlayerAchievements(curr).catch(err =>
                                logger.warn('[now-playing] Achievement cache refresh failed', { appid: curr, err: err.message })
                            );
                        }
                        // Never shrink tracked progress on a partial/odd response.
                        if (newAchs.length >= _achDuring.length) {
                            _achDuring = newAchs;
                            patchOpenSession({ achievementsDuring: _achDuring }).catch(() => {});
                        }
                    }
                } catch (err) {
                    logger.debug('[now-playing] Mid-session achievement poll failed',
                        { appid: curr, err: err.message });
                }
            }
        }

        _cache = detected;
    } catch (err) {
        // Poll ERRORS (network, 5xx) never touch session state — only a
        // *successful* empty response counts toward the miss threshold.
        logger.warn('[now-playing] Poll failed', { err: err.message });
    }
}

export function get() {
    return {
        playing: _cache
            ? { ..._cache, sessionStartedAt: _sessionStart, achievementsDuring: _achDuring }
            : null,
    };
}

export async function startPoller() {
    if (_timer) return;

    // On restart, check if there was an active session when the process last
    // stopped. If the same game is still playing the first poll is a no-op
    // (curr === prev). If Steam's presence is transiently empty right after
    // the restart — the old flap — the miss debouncing above holds the session
    // open; only a sustained absence closes it (backdated to the first miss).
    try {
        const open = await getOpenSession();
        if (open) {
            _cache        = { appid: open.appid, name: open.name };
            _sessionStart = open.startedAt;
            // Restore achievement tracking so mid-session diffs stay correct after restart
            _achBaseline  = new Set(open.achievementsAtStart ?? []);
            _achDuring    = open.achievementsDuring ?? [];
            _lastAchPoll  = Date.now(); // reset the interval — don't poll immediately on startup
            logger.info('[now-playing] Recovered open session from play-log', {
                appid:       open.appid,
                name:        open.name,
                startedAt:   open.startedAt,
                achBaseline: _achBaseline.size,
                achDuring:   _achDuring.length,
            });
        }
    } catch (err) {
        logger.warn('[now-playing] Could not recover open session', { err: err.message });
    }

    poll();
    _timer = setInterval(poll, POLL_INTERVAL_MS);
    logger.info('[now-playing] Poller started', { intervalSec: POLL_INTERVAL_MS / 1_000 });
}

export function stopPoller() {
    if (_timer) {
        clearInterval(_timer);
        _timer = null;
        logger.info('[now-playing] Poller stopped');
    }
}

export { clearOpenSession };

// ── Test seams (journal addition) ────────────────────────────────────────────
// poll() is module-internal in the relay; exported here so the flap-fix tests
// can drive exact poll sequences without timers. Not used by production code.
export { poll as _pollOnce };
