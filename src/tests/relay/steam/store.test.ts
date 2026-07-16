// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/steam/store.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified).
import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-store-test-'));
process.env.DATA_DIR = tmpDir;
delete process.env.RELAY_DATA_ROOT;   // featureDir() must derive from DATA_DIR
// The relay ran its suite with .env.test's DISABLE_RATE_LIMIT=1 — the politeness
// delays protect Steam, and tests stub fetch so there is nothing to protect.
process.env.DISABLE_RATE_LIMIT = '1';

const {
    syncGameDetails,
    getGameDetail,
    getGameDetailIndex,
} = await import('../../../lib/server/relay/steam/store.service.js');

const steamDir = path.join(tmpDir, 'relay', 'steam');
await fs.mkdir(steamDir, { recursive: true });

const FAKE_GAMES = [
    { appid: 10, name: 'Game One', playtime_forever: 120 },
    { appid: 20, name: 'Game Two', playtime_forever: 0 },
];

await fs.writeFile(
    path.join(steamDir, 'games.json'),
    JSON.stringify({ gameCount: 2, games: FAKE_GAMES, fetchedAt: new Date().toISOString() })
);

// These must carry every field in store.service's SKIP_FIELDS — steam_appid, name,
// type, screenshots, detailed_description — since that set is what marks an entry
// "fully cached". Real appdetails responses always include them; a fixture missing
// them looks perpetually incomplete and gets re-fetched on every sync.
const FAKE_DETAIL_10 = {
    steam_appid: 10,
    name: 'Game One',
    type: 'game',
    is_free: false,
    short_description: 'A great game.',
    detailed_description: 'A great game, described at length.',
    screenshots: [{ id: 0, path_full: 'https://cdn.example/10/0.jpg' }],
    developers: ['Dev Studio'],
    publishers: ['Pub Co'],
    price_overview: { currency: 'USD', initial: 2999, final: 2999, discount_percent: 0 },
    platforms: { windows: true, mac: false, linux: false },
    metacritic: { score: 88, url: 'https://www.metacritic.com/game/game-one' },
    categories: [{ id: 2, description: 'Single-player' }],
    genres: [{ id: '1', description: 'Action' }],
    release_date: { coming_soon: false, date: '1 Jan, 2010' },
    recommendations: { total: 50000 },
};

const FAKE_DETAIL_20 = {
    steam_appid: 20,
    name: 'Game Two',
    type: 'game',
    is_free: false,
    short_description: 'Another game.',
    detailed_description: 'Another game, described at length.',
    screenshots: [{ id: 0, path_full: 'https://cdn.example/20/0.jpg' }],
    developers: ['Another Dev'],
    publishers: ['Another Pub'],
    genres: [{ id: '2', description: 'RPG' }],
    release_date: { coming_soon: false, date: '1 Jun, 2015' },
};

describe('steam store service — game details', () => {
    let originalFetch;

    beforeAll(() => {
        originalFetch = global.fetch;
        global.fetch = vi.fn(async (url) => {
            const u = String(url);
            if (u.includes('appids=10')) {
                return { ok: true, json: async () => ({ '10': { success: true, data: FAKE_DETAIL_10 } }) };
            }
            if (u.includes('appids=20')) {
                return { ok: true, json: async () => ({ '20': { success: true, data: FAKE_DETAIL_20 } }) };
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });
    });

    afterAll(() => { global.fetch = originalFetch; });

    it('syncGameDetails fetches and caches details for all games', async () => {
        const result = await syncGameDetails({ force: true });
        assert.equal(result.total,   2);
        assert.equal(result.fetched, 2);
        assert.equal(result.skipped, 0);
        assert.equal(result.noData,  0);
        assert.equal(global.fetch.mock.calls.length, 2);
    });

    it('syncGameDetails skips already-cached games when force=false', async () => {
        global.fetch.mockClear();
        const result = await syncGameDetails({ force: false });
        assert.equal(result.skipped, 2);
        assert.equal(result.fetched, 0);
        assert.equal(global.fetch.mock.calls.length, 0);
    });

    it('syncGameDetails re-fetches everything when force=true', async () => {
        global.fetch.mockClear();
        const result = await syncGameDetails({ force: true });
        assert.equal(result.fetched, 2);
        assert.equal(global.fetch.mock.calls.length, 2);
    });

    it('syncGameDetails records noData when store returns success=false', async () => {
        global.fetch.mockClear();
        global.fetch = vi.fn(async () => ({
            ok: true,
            json: async () => ({ '10': { success: false }, '20': { success: false } }),
        }));
        const result = await syncGameDetails({ force: true });
        assert.equal(result.noData, 2);
        assert.equal(result.fetched, 0);
        global.fetch = originalFetch;
    });
});

describe('steam store service — reads', () => {
    // Seed the cache rather than inheriting whatever the sync suite left on disk:
    // its last test drives a success=false response, which overwrites both entries
    // with `{unavailable: true}` sentinels.
    beforeAll(async () => {
        const storeDir = path.join(steamDir, 'store');
        await fs.mkdir(storeDir, { recursive: true });
        await fs.writeFile(path.join(storeDir, '10.json'), JSON.stringify(FAKE_DETAIL_10, null, 2));
        await fs.writeFile(path.join(storeDir, '20.json'), JSON.stringify(FAKE_DETAIL_20, null, 2));
    });

    afterAll(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('getGameDetail returns the cached file for a known appid', async () => {
        const detail = await getGameDetail(10);
        assert.ok(detail);
        assert.equal(detail.steam_appid, 10);
        assert.equal(detail.metacritic.score, 88);
        assert.deepEqual(detail.developers, ['Dev Studio']);
    });

    it('getGameDetail returns null for an uncached appid', async () => {
        const detail = await getGameDetail(99999);
        assert.equal(detail, null);
    });

    it('getGameDetailIndex returns a summary entry for each cached game', async () => {
        const index = await getGameDetailIndex();
        assert.equal(index.length, 2);
        const g1 = index.find((g) => g.appid === 10);
        assert.ok(g1);
        assert.equal(g1.metacritic, 88);
        assert.deepEqual(g1.genres, ['Action']);
        assert.deepEqual(g1.developers, ['Dev Studio']);
    });
});
