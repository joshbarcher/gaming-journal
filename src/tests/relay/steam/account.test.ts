// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/steam/account.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified). node:test mock.fn → vi.fn (same .mock.calls shape;
// resetCalls() → mockClear()).
//
// DATA_DIR must point at a temp dir, never the NAS (.env's DATA_DIR). The relay
// ran this suite with .env.test's STEAM_API_KEY/STEAM_ID — set the same values
// here (overwriting whatever vite loaded from .env) before the top-level
// dynamic import of the service.
import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gj-relay-account-test-'));
process.env.DATA_DIR = tmpDir;
delete process.env.RELAY_DATA_ROOT;   // featureDir() must derive from DATA_DIR
process.env.DISABLE_RATE_LIMIT = '1'; // relay .env.test — sleeps protect Steam; fetch is stubbed
process.env.STEAM_API_KEY = 'test-key';           // relay .env.test values
process.env.STEAM_ID      = '76561198000000000';

const {
    syncAccount, getAccount,
    syncFriends, getFriends,
} = await import('../../../lib/server/relay/steam/account.service.js');

const STEAM_ID = process.env.STEAM_ID;

const FAKE_PROFILE = {
    steamid: STEAM_ID,
    personaname: 'pouncepounce',
    profileurl: 'https://steamcommunity.com/id/pouncepounce/',
    avatar: 'https://avatars.steamstatic.com/abc_small.jpg',
    avatarmedium: 'https://avatars.steamstatic.com/abc_medium.jpg',
    avatarfull: 'https://avatars.steamstatic.com/abc_full.jpg',
    personastate: 1,
    communityvisibilitystate: 3,
    profilestate: 1,
    lastlogoff: 1700000000,
    timecreated: 1200000000,
    loccountrycode: 'US',
};

const FAKE_BANS = {
    SteamId: STEAM_ID,
    CommunityBanned: false,
    VACBanned: false,
    NumberOfVACBans: 0,
    DaysSinceLastBan: 0,
    NumberOfGameBans: 0,
    EconomyBan: 'none',
};

const FAKE_BADGES = {
    player_xp: 12500,
    player_level: 42,
    player_xp_needed_to_level_up: 200,
    player_xp_needed_current_level: 100,
    badges: [
        { badgeid: 1, level: 5, completion_time: 1700000000, xp: 500, scarcity: 12345 },
    ],
};

const FAKE_FRIEND = {
    steamid: '76561198000000001',
    relationship: 'friend',
    friend_since: 1500000000,
};

const FAKE_FRIEND_PROFILE = {
    steamid: '76561198000000001',
    personaname: 'FriendOne',
    avatarfull: 'https://avatars.steamstatic.com/friend_full.jpg',
};

// ── Account ───────────────────────────────────────────────────────────────────

describe('steam account service — account', () => {
    let originalFetch;

    beforeAll(() => {
        originalFetch = global.fetch;
        global.fetch = vi.fn(async (url) => {
            const u = String(url);
            if (u.includes('GetPlayerSummaries')) {
                return { ok: true, json: async () => ({ response: { players: [FAKE_PROFILE] } }) };
            }
            if (u.includes('GetSteamLevel')) {
                return { ok: true, json: async () => ({ response: { player_level: 42 } }) };
            }
            if (u.includes('GetBadges')) {
                return { ok: true, json: async () => ({ response: FAKE_BADGES }) };
            }
            if (u.includes('GetPlayerBans')) {
                return { ok: true, json: async () => ({ players: [FAKE_BANS] }) };
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });
    });

    afterAll(() => { global.fetch = originalFetch; });

    it('syncAccount fetches profile, level, badges, and bans', async () => {
        const data = await syncAccount({ force: true });
        assert.ok(data.fetchedAt);
        assert.equal(data.profile.personaname, 'pouncepounce');
        assert.equal(data.level, 42);
        assert.equal(data.bans.VACBanned, false);
        assert.equal(data.badges.player_level, 42);
        assert.equal(data.badges.badges.length, 1);
        assert.equal(global.fetch.mock.calls.length, 4);
    });

    it('syncAccount skips all API calls when cache is fresh', async () => {
        global.fetch.mockClear();
        await syncAccount();
        assert.equal(global.fetch.mock.calls.length, 0);
    });

    it('syncAccount re-fetches when force=true', async () => {
        global.fetch.mockClear();
        await syncAccount({ force: true });
        assert.equal(global.fetch.mock.calls.length, 4);
    });

    it('getAccount returns cached data without a network call', async () => {
        global.fetch.mockClear();
        const data = await getAccount();
        assert.equal(data.profile.personaname, 'pouncepounce');
        assert.equal(global.fetch.mock.calls.length, 0);
    });

    it('syncAccount throws when STEAM_API_KEY is missing', async () => {
        const saved = process.env.STEAM_API_KEY;
        delete process.env.STEAM_API_KEY;
        await assert.rejects(() => syncAccount({ force: true }), /STEAM_API_KEY is not set/);
        process.env.STEAM_API_KEY = saved;
    });
});

// ── Friends ───────────────────────────────────────────────────────────────────

describe('steam account service — friends', () => {
    let originalFetch;

    beforeAll(() => {
        originalFetch = global.fetch;
        global.fetch = vi.fn(async (url) => {
            const u = String(url);
            if (u.includes('GetFriendList')) {
                return { ok: true, json: async () => ({ friendslist: { friends: [FAKE_FRIEND] } }) };
            }
            if (u.includes('GetPlayerSummaries')) {
                return { ok: true, json: async () => ({ response: { players: [FAKE_FRIEND_PROFILE] } }) };
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });
    });

    afterAll(async () => {
        global.fetch = originalFetch;
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('syncFriends fetches friend list and enriches with profile summaries', async () => {
        const data = await syncFriends({ force: true });
        assert.ok(data.fetchedAt);
        assert.equal(data.friendCount, 1);
        assert.equal(data.friends[0].steamid, FAKE_FRIEND.steamid);
        assert.equal(data.friends[0].profile.personaname, 'FriendOne');
        assert.equal(global.fetch.mock.calls.length, 2);
    });

    it('syncFriends skips API calls when cache is fresh', async () => {
        global.fetch.mockClear();
        await syncFriends();
        assert.equal(global.fetch.mock.calls.length, 0);
    });

    it('getFriends returns cached data without a network call', async () => {
        global.fetch.mockClear();
        const data = await getFriends();
        assert.equal(data.friendCount, 1);
        assert.equal(data.friends[0].profile.personaname, 'FriendOne');
        assert.equal(global.fetch.mock.calls.length, 0);
    });
});
