// Ported verbatim from relay-server src/services/steam/account.service.js
// (docs/relay-fold-in.md §6 — logic byte-identical; only imports + data-dir
// helpers rewritten). Data stays under $RELAY_DATA_ROOT/steam — same on-disk
// paths as the relay (account.json, friends.json).
//
// This is the STEAM account service (profile/level/badges/bans + friends,
// straight off the Steam Web API). The journal-facing aggregate lives in
// ../account/account.service.js — different feature, different files.
import path from 'node:path';
import logger from '../../logger.js';
import { ManagedFile } from '../shared/managed-file.js';
import { steamFetch } from '../shared/steam-fetch.js';
import { featureDir } from '../shared/data-root.js';

const STEAM_API = 'https://api.steampowered.com';

const ACCOUNT_TTL_MS = 6  * 60 * 60 * 1_000;
const FRIENDS_TTL_MS = 24 * 60 * 60 * 1_000;

const FRIEND_SUMMARY_BATCH = 100;

function dataDir() {
    return featureDir('steam');
}

function makeFile(name, defaultValue) {
    return new ManagedFile({
        filePath: path.join(dataDir(), `${name}.json`),
        name: `steam-${name}`,
        defaultValue,
    });
}

function cacheIsFresh(fetchedAt, ttlMs) {
    if (!fetchedAt) return false;
    return Date.now() - new Date(fetchedAt).getTime() < ttlMs;
}

let _friendsFile = null;
let _accountFile = null;

async function _loadFriendsFile() {
    if (!_friendsFile) {
        _friendsFile = makeFile('friends', () => ({ fetchedAt: null, friendCount: 0, friends: [] }));
        await _friendsFile.load();
    }
    return _friendsFile;
}

async function _loadAccountFile() {
    if (!_accountFile) {
        _accountFile = makeFile('account', () => ({ fetchedAt: null, profile: null, level: null, bans: null, badges: {} }));
        await _accountFile.load();
    }
    return _accountFile;
}

async function fetchProfile(apiKey, steamId) {
    const url = new URL(`${STEAM_API}/ISteamUser/GetPlayerSummaries/v2/`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('steamids', steamId);
    const res  = await steamFetch(url.toString());
    const body = await res.json();
    return body.response?.players?.[0] ?? null;
}

async function fetchLevel(apiKey, steamId) {
    const url = new URL(`${STEAM_API}/IPlayerService/GetSteamLevel/v1/`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('steamid', steamId);
    const res  = await steamFetch(url.toString());
    const body = await res.json();
    return body.response?.player_level ?? null;
}

async function fetchBadges(apiKey, steamId) {
    const url = new URL(`${STEAM_API}/IPlayerService/GetBadges/v1/`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('steamid', steamId);
    const res  = await steamFetch(url.toString());
    const body = await res.json();
    return body.response ?? {};
}

async function fetchBans(apiKey, steamId) {
    const url = new URL(`${STEAM_API}/ISteamUser/GetPlayerBans/v1/`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('steamids', steamId);
    const res  = await steamFetch(url.toString());
    const body = await res.json();
    return body.players?.[0] ?? null;
}

async function fetchFriendList(apiKey, steamId) {
    const url = new URL(`${STEAM_API}/ISteamUser/GetFriendList/v1/`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('steamid', steamId);
    url.searchParams.set('relationship', 'friend');
    const res  = await steamFetch(url.toString());
    const body = await res.json();
    return body.friendslist?.friends ?? [];
}

async function fetchPlayerSummaries(apiKey, steamIds) {
    const url = new URL(`${STEAM_API}/ISteamUser/GetPlayerSummaries/v2/`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('steamids', steamIds.join(','));
    const res  = await steamFetch(url.toString());
    const body = await res.json();
    return body.response?.players ?? [];
}

export async function syncAccount({ force = false } = {}) {
    const apiKey  = process.env.STEAM_API_KEY;
    const steamId = process.env.STEAM_ID;
    if (!apiKey)  throw new Error('STEAM_API_KEY is not set');
    if (!steamId) throw new Error('STEAM_ID is not set');

    const file = await _loadAccountFile();
    const cached = file.get();

    if (!force && cacheIsFresh(cached.fetchedAt, ACCOUNT_TTL_MS)) {
        const ageMin = Math.round((Date.now() - new Date(cached.fetchedAt).getTime()) / 60_000);
        logger.info('[steam] Account cache is fresh — skipping sync', { ageMin });
        return cached;
    }

    logger.info('[steam] Syncing account data from Steam API');

    const profile = await fetchProfile(apiKey, steamId);
    const level   = await fetchLevel(apiKey, steamId);
    const badges  = await fetchBadges(apiKey, steamId);
    const bans    = await fetchBans(apiKey, steamId);

    // steamFetch throws on hard errors (400/401/403) so those never reach here.
    // But Steam intermittently returns HTTP 200 with an empty/partial body under
    // load — fetchProfile → null, fetchLevel → null, fetchBadges → {}. Writing
    // those over a good cache blanks the account (name "Unknown", null avatar/
    // level) until the next good sync. Prefer fresh → prior cached → default,
    // per field, and don't re-stamp fetchedAt when nothing usable came back.
    const gotAnything = profile != null || level != null || bans != null ||
        (badges && Object.keys(badges).length > 0);
    if (!gotAnything) {
        logger.warn('[steam] Account sync got an empty response — keeping cached account');
        return cached;
    }

    const next = {
        fetchedAt: new Date().toISOString(),
        profile: profile ?? cached.profile ?? null,
        level:   level   ?? cached.level   ?? null,
        bans:    bans    ?? cached.bans    ?? null,
        badges:  (badges && Object.keys(badges).length > 0) ? badges : (cached.badges ?? {}),
    };

    await file.set(next);
    await file.flush();

    logger.info('[steam] Account sync complete', { personaname: next.profile?.personaname, level: next.level });
    return next;
}

export async function getAccount() {
    return (await _loadAccountFile()).get();
}

export async function syncFriends({ force = false } = {}) {
    const apiKey  = process.env.STEAM_API_KEY;
    const steamId = process.env.STEAM_ID;
    if (!apiKey)  throw new Error('STEAM_API_KEY is not set');
    if (!steamId) throw new Error('STEAM_ID is not set');

    const file = await _loadFriendsFile();
    const cached = file.get();

    if (!force && cacheIsFresh(cached.fetchedAt, FRIENDS_TTL_MS)) {
        const ageMin = Math.round((Date.now() - new Date(cached.fetchedAt).getTime()) / 60_000);
        logger.info('[steam] Friends cache is fresh — skipping sync', { ageMin });
        return cached;
    }

    logger.info('[steam] Syncing friends list from Steam API');

    const friendList = await fetchFriendList(apiKey, steamId);

    // A 200 with an empty friends list (temporarily private friends / transient body) must not wipe
    // the whole cached list — mirror syncAccount's gotAnything guard and keep the good data.
    if (friendList.length === 0 && (cached.friends?.length ?? 0) > 0) {
        logger.warn('[steam] Friend list came back empty — keeping cached friends');
        return cached;
    }

    const profileMap = {};
    for (let i = 0; i < friendList.length; i += FRIEND_SUMMARY_BATCH) {
        const chunk    = friendList.slice(i, i + FRIEND_SUMMARY_BATCH);
        const profiles = await fetchPlayerSummaries(apiKey, chunk.map((f) => f.steamid));
        for (const p of profiles) profileMap[p.steamid] = p;

        if (i + FRIEND_SUMMARY_BATCH < friendList.length) {
            await new Promise((r) => setTimeout(r, 1_000));
        }
    }

    const friends = friendList.map((f) => ({
        steamid:      f.steamid,
        relationship: f.relationship,
        friend_since: f.friend_since,
        profile:      profileMap[f.steamid] ?? null,
    }));

    const next = {
        fetchedAt:   new Date().toISOString(),
        friendCount: friends.length,
        friends,
    };

    await file.set(next);
    await file.flush();

    logger.info('[steam] Friends sync complete', { count: friends.length });
    return next;
}

export async function getFriends() {
    return (await _loadFriendsFile()).get();
}
