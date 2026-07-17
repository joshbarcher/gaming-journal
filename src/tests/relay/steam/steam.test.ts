// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/steam/steam.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified). node:test mock.fn → vi.fn (same .mock.calls shape;
// resetCalls() → mockClear(); calls[i].arguments[j] → calls[i][j]).
//
// DATA_DIR must point at a temp dir, never the NAS (.env's DATA_DIR). The relay
// ran this suite with .env.test's STEAM_API_KEY/STEAM_ID/DISABLE_RATE_LIMIT —
// set the same values here (overwriting whatever vite loaded from .env) before
// the top-level dynamic import of the service.
import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gj-relay-steam-test-'));
process.env.DATA_DIR = tmpDir;
delete process.env.RELAY_DATA_ROOT;   // featureDir() must derive from DATA_DIR
process.env.DISABLE_RATE_LIMIT = '1'; // relay .env.test — sleeps protect Steam; fetch is stubbed
process.env.STEAM_API_KEY = 'test-key';           // relay .env.test values
process.env.STEAM_ID      = '76561198000000000';

const {
    syncGames, getGames,
    syncAchievements, getAchievements, loadAchievementsCache,
    syncRecentlyPlayed, getRecentlyPlayed,
    syncWishlist, getWishlist,
    syncReviews, getReviews,
} = await import('../../../lib/server/relay/steam/steam.service.js');

const STEAM_ID = process.env.STEAM_ID;

const FAKE_GAMES = [
    { appid: 10, name: 'Game One',   playtime_forever: 120, rtime_last_played: 1700000000, has_community_visible_stats: true },
    { appid: 20, name: 'Game Two',   playtime_forever: 0,   rtime_last_played: 0,          has_community_visible_stats: true  },
    { appid: 30, name: 'Game Three', playtime_forever: 0,   rtime_last_played: 0,          has_community_visible_stats: false },
];

const FAKE_ACHIEVEMENTS = { gameName: 'Game One', achievements: [{ apiname: 'ACH_1', achieved: 1, unlocktime: 1700000001 }] };

const FAKE_SCHEMA = {
    game: {
        availableGameStats: {
            achievements: [
                { name: 'ACH_1', displayName: 'First Achievement', description: 'Do the thing.', icon: 'https://cdn.example.com/icon.jpg', icongray: 'https://cdn.example.com/icon_gray.jpg', hidden: 0 },
            ],
        },
    },
};

const FAKE_RECENT = [
    { appid: 10, name: 'Game One', playtime_2weeks: 60, playtime_forever: 120 },
];

const FAKE_WISHLIST_ITEMS = [
    { appid: 999, priority: 0, date_added: 1700000000 },
];

const FAKE_REVIEW = {
    recommendationid: '123',
    author: { steamid: STEAM_ID, playtime_forever: 120 },
    review: 'Great game!',
    voted_up: true,
    timestamp_created: 1700000000,
};

// ── Owned games ───────────────────────────────────────────────────────────────

describe('steam service — owned games', () => {
    let originalFetch;

    beforeAll(() => {
        originalFetch = global.fetch;
        global.fetch = vi.fn(async () => ({
            ok: true,
            json: async () => ({ response: { game_count: FAKE_GAMES.length, games: FAKE_GAMES } }),
        }));
    });

    afterAll(() => { global.fetch = originalFetch; });

    it('syncGames fetches from Steam and writes the cache', async () => {
        const data = await syncGames({ force: true });
        assert.equal(data.gameCount, FAKE_GAMES.length);
        assert.equal(data.games.length, FAKE_GAMES.length);
        assert.ok(data.fetchedAt);
        assert.equal(global.fetch.mock.calls.length, 1);
    });

    it('syncGames skips the API call when cache is fresh', async () => {
        global.fetch.mockClear();
        const data = await syncGames();
        assert.equal(data.gameCount, FAKE_GAMES.length);
        assert.equal(global.fetch.mock.calls.length, 0);
    });

    it('syncGames re-fetches when force=true even if cache is fresh', async () => {
        global.fetch.mockClear();
        await syncGames({ force: true });
        assert.equal(global.fetch.mock.calls.length, 1);
    });

    it('getGames returns cached data without calling Steam', async () => {
        global.fetch.mockClear();
        const data = await getGames();
        assert.equal(data.gameCount, FAKE_GAMES.length);
        assert.equal(global.fetch.mock.calls.length, 0);
    });

    it('syncGames throws when STEAM_API_KEY is missing', async () => {
        const saved = process.env.STEAM_API_KEY;
        delete process.env.STEAM_API_KEY;
        await assert.rejects(() => syncGames({ force: true }), /STEAM_API_KEY is not set/);
        process.env.STEAM_API_KEY = saved;
    });
});

// ── Achievements ──────────────────────────────────────────────────────────────

describe('steam service — achievements', () => {
    let originalFetch;

    beforeAll(() => {
        originalFetch = global.fetch;
        global.fetch = vi.fn(async (url) => {
            if (String(url).includes('GetSchemaForGame')) {
                return { ok: true, json: async () => FAKE_SCHEMA };
            }
            return { ok: true, json: async () => ({ playerstats: FAKE_ACHIEVEMENTS }) };
        });
    });

    afterAll(() => { global.fetch = originalFetch; });

    it('syncAchievements queues played games AND zero-playtime games with has_community_visible_stats', async () => {
        global.fetch.mockClear();
        const result = await syncAchievements({ force: true });
        // Game 10 (played) + Game 20 (zero playtime, has_community_visible_stats: true)
        // Game 30 (zero playtime, has_community_visible_stats: false) → excluded
        assert.equal(result.synced, 2);
        // 2 games × (GetPlayerAchievements + GetSchemaForGame) = 4 calls
        assert.equal(global.fetch.mock.calls.length, 4);
    });

    it('syncAchievements stores all schema achievements with player progress overlaid', async () => {
        const data = await getAchievements();
        const entry = data[10];
        const ach   = entry.achievements[0];
        // Schema drives the list
        assert.equal(ach.apiname, 'ACH_1');
        assert.equal(ach.displayName, 'First Achievement');
        assert.equal(ach.description, 'Do the thing.');
        assert.ok(ach.icon);
        assert.ok(ach.icongray);
        // Player progress overlaid
        assert.equal(ach.achieved, 1);
        // hasPlayerData flag stored on the entry
        assert.equal(entry.hasPlayerData, true);
    });

    it('syncedAppids contains the appids that were synced', async () => {
        global.fetch.mockClear();
        const result = await syncAchievements({ force: true });
        assert.ok(Array.isArray(result.syncedAppids));
        assert.ok(result.syncedAppids.includes(10));
        assert.ok(result.syncedAppids.includes(20));
        assert.equal(result.syncedAppids.includes(30), false);
    });

    it('syncAchievements skips games not played since last fetch (delta filter)', async () => {
        global.fetch.mockClear();
        const result = await syncAchievements();
        assert.equal(result.synced, 0);
        assert.equal(global.fetch.mock.calls.length, 0);
    });

    it('syncAchievements re-queues entries with missing displayName (repair)', async () => {
        // Corrupt game 10's per-game file to simulate pre-schema-merge data
        const achPath = path.join(tmpDir, 'relay', 'steam', 'achievements', '10.json');
        const raw = JSON.parse(await fs.readFile(achPath, 'utf8'));
        raw.achievements[0].displayName = null;   // simulate stale entry
        raw.fetchedAt = new Date().toISOString(); // mark as "fresh" so TTL won't trigger
        await fs.writeFile(achPath, JSON.stringify(raw));

        // Reload cache from disk so the service sees the corrupted entry
        await loadAchievementsCache();

        global.fetch.mockClear();
        const result = await syncAchievements(); // no force — repair detection should trigger
        // Game 10 has stale data → re-synced; game 20 is fresh → skipped
        assert.ok(result.syncedAppids.includes(10), 'stale game 10 should be repaired');
        assert.ok(result.synced >= 1);
    });

    it('syncAchievements shows the full list on a 403 AND preserves prior unlocks (data-integrity)', async () => {
        // Prior state: game 10 has a real unlock stored from earlier syncs. A 403
        // (private profile) must NOT zero it — that silent overwrite was the bug
        // behind a week-private profile wiping achievement counts. The schema list
        // and the blocked flag are still written; only achieved/unlocktime are
        // protected by the prior-value fallback in the merge.
        const before = (await getAchievements())[10]?.achievements?.[0]?.achieved
        assert.equal(before, 1, 'precondition: game 10 has a stored unlock')

        global.fetch.mockClear();
        global.fetch = vi.fn(async (url) => {
            const u = String(url);
            if (u.includes('GetPlayerAchievements')) {
                return { ok: false, status: 403, statusText: 'Forbidden' };
            }
            return { ok: true, json: async () => FAKE_SCHEMA };
        });

        const result = await syncAchievements({ force: true });
        assert.equal(result.synced, 2);
        assert.equal(result.failed, 0);

        const data = await getAchievements();
        assert.ok(data[10]);
        assert.equal(data[10].achievements.length, 1);
        assert.equal(data[10].achievements[0].displayName, 'First Achievement');
        assert.equal(data[10].achievements[0].achieved, 1, '403 preserves the prior unlock, never zeroes it');
        assert.equal(data[10].hasPlayerData, false, 'hasPlayerData flag stored for fill pass');
        assert.equal(data[10].playerDataBlocked, true, '403 marks the game as blocked');
    });

    // A 403 means Steam refuses player stats (private profile, or the game has none).
    // Such games are deliberately NOT re-queued by the player-data fill pass, so a
    // permanently-403 game can't be re-fetched on every 30-minute tick.
    it('syncAchievements does not re-queue a game whose player data is blocked', async () => {
        const entryPath = path.join(tmpDir, 'relay', 'steam', 'achievements', '10.json');
        const entry     = JSON.parse(await fs.readFile(entryPath, 'utf8'));
        assert.equal(entry.playerDataBlocked, true);

        // Age it past the TTL so only _needsPlayerData could re-queue it.
        entry.fetchedAt = new Date(Date.now() - 7 * 60 * 60 * 1_000).toISOString();
        await fs.writeFile(entryPath, JSON.stringify(entry));
        await loadAchievementsCache();

        global.fetch = vi.fn(async () => ({ ok: true, json: async () => FAKE_SCHEMA }));
        const result = await syncAchievements();
        assert.ok(!result.syncedAppids.includes(10), 'blocked game stays blocked');
    });

    it('syncAchievements fills player progress without re-fetching schema (player-data-only fast path)', async () => {
        // Game 10 now has hasPlayerData:false — profile was private during schema fetch.
        // Simulate profile becoming public: GetPlayerAchievements now succeeds.
        global.fetch = vi.fn(async (url) => {
            const u = String(url);
            if (u.includes('GetPlayerAchievements')) {
                return { ok: true, json: async () => ({ playerstats: FAKE_ACHIEVEMENTS }) };
            }
            // GetSchemaForGame should NOT be called in player-data-only mode
            if (u.includes('GetSchemaForGame')) {
                throw new Error('GetSchemaForGame should not be called in player-data-only mode');
            }
            return { ok: true, json: async () => ({}) };
        });

        // Set up the state that actually triggers the fill pass: the schema is cached,
        // the player has no recorded progress yet (hasPlayerData:false), Steam did not
        // refuse the request (playerDataBlocked:false), and the entry has aged past
        // ACHIEVEMENTS_TTL_MS (6h) — the TTL gate runs before _needsPlayerData.
        const entryPath = path.join(tmpDir, 'relay', 'steam', 'achievements', '10.json');
        const entry     = JSON.parse(await fs.readFile(entryPath, 'utf8'));
        entry.fetchedAt         = new Date(Date.now() - 7 * 60 * 60 * 1_000).toISOString();
        entry.hasPlayerData     = false;
        entry.playerDataBlocked = false;
        await fs.writeFile(entryPath, JSON.stringify(entry));
        await loadAchievementsCache();

        // Game 10 has playtime + hasPlayerData:false → triggers _needsPlayerData
        const result = await syncAchievements();
        assert.ok(result.syncedAppids.includes(10), 'game 10 should be re-synced');

        const data = await getAchievements();
        assert.equal(data[10].achievements[0].achieved, 1, 'player progress now filled in');
        assert.equal(data[10].hasPlayerData, true, 'hasPlayerData updated to true');
        // Schema fields preserved from previous fetch
        assert.equal(data[10].achievements[0].displayName, 'First Achievement');
    });

    it('syncAchievements uses community-page scraper when schema API returns empty', async () => {
        global.fetch.mockClear();
        global.fetch = vi.fn(async (url) => {
            const u = String(url);
            if (u.includes('GetSchemaForGame')) {
                // Empty schema — triggers the scraper fallback
                return { ok: true, json: async () => ({ game: { availableGameStats: { achievements: [] } } }) };
            }
            // GetPlayerAchievements returns player data (positional join with scraper)
            return { ok: true, json: async () => ({ playerstats: FAKE_ACHIEVEMENTS }) };
        });

        // Inject mock scraper — returns one achievement (schema-order position 0)
        const mockScrapeFn = async () => [
            { displayName: 'Scraped Name', description: 'Scraped description.', icon: 'https://cdn.example.com/icon_scraped.jpg' },
        ];

        const result = await syncAchievements({ force: true, scrapeFn: mockScrapeFn });
        assert.ok(result.synced >= 1);

        const data = await getAchievements();
        const ach = data[10].achievements[0];
        // Schema info from scraper
        assert.equal(ach.displayName, 'Scraped Name');
        assert.equal(ach.description, 'Scraped description.');
        assert.equal(ach.icon, 'https://cdn.example.com/icon_scraped.jpg');
        assert.equal(ach.icongray, null);       // community page has no gray icons
        // Player progress from GetPlayerAchievements
        assert.equal(ach.achieved, 1);
    });

    it('getAchievements returns the cached data', async () => {
        const data = await getAchievements();
        assert.ok(data[10]);
        assert.equal(data[10].gameName, 'Game One');
    });
});

// ── Recently played ───────────────────────────────────────────────────────────

describe('steam service — recently played', () => {
    let originalFetch;

    beforeAll(() => {
        originalFetch = global.fetch;
        global.fetch = vi.fn(async () => ({
            ok: true,
            json: async () => ({ response: { total_count: 1, games: FAKE_RECENT } }),
        }));
    });

    afterAll(() => { global.fetch = originalFetch; });

    it('syncRecentlyPlayed fetches from Steam and caches the result', async () => {
        const data = await syncRecentlyPlayed({ force: true });
        assert.equal(data.totalCount, 1);
        assert.equal(data.games.length, 1);
        assert.ok(data.fetchedAt);
        assert.equal(global.fetch.mock.calls.length, 1);

        const url = global.fetch.mock.calls[0][0];
        assert.ok(url.includes('GetRecentlyPlayedGames'));
    });

    it('syncRecentlyPlayed skips when cache is fresh', async () => {
        global.fetch.mockClear();
        await syncRecentlyPlayed();
        assert.equal(global.fetch.mock.calls.length, 0);
    });

    it('getRecentlyPlayed returns cached data without a network call', async () => {
        global.fetch.mockClear();
        const data = await getRecentlyPlayed();
        assert.equal(data.games.length, 1);
        assert.equal(global.fetch.mock.calls.length, 0);
    });
});

// ── Wishlist ──────────────────────────────────────────────────────────────────

describe('steam service — wishlist', () => {
    let originalFetch;

    beforeAll(() => {
        originalFetch = global.fetch;
        global.fetch = vi.fn(async () => ({
            ok: true,
            json: async () => ({ response: { items: FAKE_WISHLIST_ITEMS } }),
        }));
    });

    afterAll(() => { global.fetch = originalFetch; });

    it('syncWishlist fetches via Web API and caches items keyed by appid', async () => {
        const data = await syncWishlist({ force: true });
        assert.equal(data.itemCount, 1);
        assert.ok(data.items[999]);
        assert.equal(data.items[999].priority, 0);
        assert.equal(data.items[999].date_added, 1700000000);
        assert.equal(global.fetch.mock.calls.length, 1);

        const url = global.fetch.mock.calls[0][0];
        assert.ok(url.includes('IWishlistService'));
    });

    it('syncWishlist skips when cache is fresh', async () => {
        global.fetch.mockClear();
        await syncWishlist();
        assert.equal(global.fetch.mock.calls.length, 0);
    });

    it('getWishlist returns cached data without a network call', async () => {
        global.fetch.mockClear();
        const data = await getWishlist();
        assert.equal(data.itemCount, 1);
        assert.equal(global.fetch.mock.calls.length, 0);
    });
});

// ── Reviews ───────────────────────────────────────────────────────────────────

describe('steam service — reviews', () => {
    let originalFetch;

    afterAll(async () => {
        global.fetch = originalFetch;
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('syncReviews finds the user review and caches it', async () => {
        originalFetch = global.fetch;
        global.fetch = vi.fn(async () => ({
            ok: true,
            json: async () => ({
                success: 1,
                reviews: [FAKE_REVIEW],
                cursor: 'next',
                query_summary: { total_reviews: 1 },
            }),
        }));

        const result = await syncReviews({ force: true });
        assert.equal(result.found, 1);
        assert.equal(result.notFound, 0);
        assert.equal(global.fetch.mock.calls.length, 1);
    });

    it('syncReviews marks games with no matching review as null', async () => {
        global.fetch = vi.fn(async () => ({
            ok: true,
            json: async () => ({
                success: 1,
                reviews: [{ ...FAKE_REVIEW, author: { steamid: '99999' } }],
                cursor: 'done',
                query_summary: { total_reviews: 1 },
            }),
        }));

        const result = await syncReviews({ force: true });
        assert.equal(result.found, 0);
        assert.equal(result.notFound, 1);
    });

    it('syncReviews skips games not played since last check (delta filter)', async () => {
        global.fetch.mockClear();
        const result = await syncReviews();
        assert.equal(result.synced, undefined);
        assert.equal(result.skipped, 1);
        assert.equal(global.fetch.mock.calls.length, 0);
    });

    it('getReviews returns cached data', async () => {
        global.fetch.mockClear();
        const data = await getReviews();
        assert.ok(data[10]);
        assert.equal(global.fetch.mock.calls.length, 0);
    });
});
