// Ported verbatim from relay-server src/services/account/account.service.js
// (docs/relay-fold-in.md §6 — logic byte-identical; only imports + data-dir
// helpers rewritten). Reads other features' files under $RELAY_DATA_ROOT/steam
// (plain-fs, read-only) plus the in-memory play-log store; writes nothing.
//
// Boot ordering (relay server.js): loadPlayLog() must resolve before build() —
// the sessions overlay reads the play-log store. Routes here enforce that by
// awaiting loadPlayLog() (idempotent) before ensureBuilt().
import path from 'node:path';
import fs from 'node:fs/promises';
import logger from '../../logger.js';
import { register } from '../shared/cache-manager.js';
import { readFlags, isSoftware } from '../shared/flags.js';
import { featureDir } from '../shared/data-root.js';
import { getSessions as getPlayLogSessions, getEffectivePlaytimeMin } from '../steam/play-log.service.js';

function steamDir() { return featureDir('steam'); }

async function readJson(p) {
    try { return JSON.parse(await fs.readFile(p, 'utf8')); }
    catch { return null; }
}

let _cache = null;

export async function build() {
    const t0 = Date.now();

    const [accountData, gamesData, recentData, achievementsData, reviewsData, wishlistData, flags] = await Promise.all([
        readJson(path.join(steamDir(), 'account.json')),
        readJson(path.join(steamDir(), 'games.json')),
        readJson(path.join(steamDir(), 'recently-played.json')),
        readJson(path.join(steamDir(), 'achievements.json')),
        readJson(path.join(steamDir(), 'reviews.json')),
        readJson(path.join(steamDir(), 'wishlist.json')),
        readFlags(),
    ]);
    // Sessions come from the in-memory play-log store (already loaded at startup).
    const sessions = getPlayLogSessions();

    const profile  = accountData?.profile ?? {};
    const badges   = accountData?.badges  ?? {};
    const games    = gamesData?.games     ?? [];

    // ── Profile ───────────────────────────────────────────────────────────────
    const profileShaped = {
        name:        profile.personaname ?? 'Unknown',
        realName:    profile.realname    ?? null,
        avatar:      profile.avatarfull  ?? profile.avatarmedium ?? profile.avatar ?? null,
        profileUrl:  profile.profileurl  ?? null,
        memberSince: profile.timecreated ? new Date(profile.timecreated * 1000).getFullYear() : null,
        lastLogoff:  profile.lastlogoff  ? new Date(profile.lastlogoff  * 1000).toISOString() : null,
    };

    // ── Steam gamification ────────────────────────────────────────────────────
    const steam = {
        level:      accountData?.level ?? badges.player_level ?? null,
        xp:         badges.player_xp                          ?? null,
        xpToNext:   badges.player_xp_needed_to_level_up       ?? null,
        badgeCount: badges.badges?.length                     ?? 0,
    };

    // ── Library stats ─────────────────────────────────────────────────────────
    // Relay is the single source of truth: baseline captures pre-relay history,
    // sessions track every play since. Never fall back to Steam's playtime_forever.
    const _effMin = g => getEffectivePlaytimeMin(g.appid);
    const gamesPlayed  = games.filter(g => _effMin(g) > 0).length;
    const totalMinutes = games.reduce((sum, g) => sum + _effMin(g), 0);

    // ── Achievements ──────────────────────────────────────────────────────────
    let achievementsUnlocked = 0;
    if (achievementsData) {
        for (const entry of Object.values(achievementsData)) {
            achievementsUnlocked += (entry.achievements ?? []).filter(a => a.achieved === 1).length;
        }
    }

    // ── Reviews ───────────────────────────────────────────────────────────────
    let reviewsWritten = 0;
    if (reviewsData) {
        const withReview = Object.values(reviewsData).find(e => e.review !== null);
        reviewsWritten = withReview?.review?.author?.num_reviews
            ?? Object.values(reviewsData).filter(e => e.review !== null).length;
    }

    const stats = {
        totalGames:           games.length,
        gamesPlayed,
        totalHoursPlayed:     Math.round(totalMinutes / 60),
        wishlistCount:        wishlistData?.itemCount ?? Object.keys(wishlistData?.items ?? {}).length,
        achievementsUnlocked,
        reviewsWritten,
    };

    // ── Merge recently played: sessions + Steam 2-week + games.json ──────────
    // Build a map keyed by appid; latest timestamp wins for sort order.
    const gamesMap = new Map(games.map(g => [g.appid, g]));
    const recent   = new Map(); // appid → { appid, name, playtimeMin, lastPlayedAt, playtime2weeks }

    // Seed from games.json rtime_last_played (all-time history)
    for (const g of games) {
        if (!g.rtime_last_played) continue;
        recent.set(g.appid, {
            appid:          g.appid,
            name:           g.name,
            playtimeMin:    _effMin(g),
            lastPlayedAt:   new Date(g.rtime_last_played * 1000).toISOString(),
            playtime2weeks: null,
        });
    }

    // Overlay Steam 2-week recently-played (adds playtime2weeks)
    for (const g of (recentData?.games ?? [])) {
        const existing = recent.get(g.appid);
        if (existing) {
            existing.playtime2weeks = g.playtime_2weeks ?? null;
        } else {
            recent.set(g.appid, {
                appid:          g.appid,
                name:           g.name,
                playtimeMin:    getEffectivePlaytimeMin(g.appid),
                lastPlayedAt:   null,
                playtime2weeks: g.playtime_2weeks ?? null,
            });
        }
    }

    // Overlay play-log sessions — most recent session startedAt is the most
    // accurate recency signal for ordering.
    for (const [appidStr, game] of Object.entries(sessions)) {
        const appid  = Number(appidStr);
        const sorted = [...(game.sessions ?? [])].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
        const latest = sorted[0];
        if (!latest) continue;

        const existing  = recent.get(appid);
        const latestTs  = latest.startedAt;
        const relayMins = getEffectivePlaytimeMin(appid);

        if (existing) {
            // Update recency if session is newer than rtime_last_played
            if (!existing.lastPlayedAt || latestTs > existing.lastPlayedAt) {
                existing.lastPlayedAt = latestTs;
            }
            // Upgrade playtime to relay-derived total if it's more accurate
            if (relayMins > existing.playtimeMin) existing.playtimeMin = relayMins;
        } else {
            recent.set(appid, {
                appid,
                name:           game.name,
                playtimeMin:    relayMins,
                lastPlayedAt:   latestTs,
                playtime2weeks: null,
            });
        }
    }

    const recentlyPlayed = [...recent.values()]
        .filter(g => g.lastPlayedAt && !isSoftware(flags, g.appid))
        .sort((a, b) => new Date(b.lastPlayedAt) - new Date(a.lastPlayedAt))
        .slice(0, 10);

    // ── Most played (top 10) ──────────────────────────────────────────────────
    const mostPlayed = [...games]
        .filter(g => _effMin(g) > 0)
        .sort((a, b) => _effMin(b) - _effMin(a))
        .slice(0, 10)
        .map(g => ({
            appid:       g.appid,
            name:        g.name,
            playtimeMin: _effMin(g),
        }));

    _cache = { profile: profileShaped, steam, stats, recentlyPlayed, mostPlayed, sessions };
    logger.info('[account] Cache built', { ms: Date.now() - t0 });
}

export function get() { return _cache ?? {}; }

/**
 * Fold-in shim (not in the relay): the relay builds this cache unconditionally
 * in server.js's listen callback (after loadPlayLog resolves). Until boot.js
 * wires build() the same way, routes await this so the first request populates
 * the cache (read-only NAS scan). Idempotent and coalesced; harmless once the
 * boot wiring lands. Callers must await loadPlayLog() first — see header.
 */
let _building = null;
export function ensureBuilt() {
    if (_cache !== null) return Promise.resolve();
    _building ??= build().finally(() => { _building = null; });
    return _building;
}

register('account', build);
