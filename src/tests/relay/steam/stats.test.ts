// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/steam/stats.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified).
import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-stats-test-'));
process.env.DATA_DIR = tmpDir;
delete process.env.RELAY_DATA_ROOT;   // featureDir() must derive from DATA_DIR
// The relay ran its suite with .env.test — carry over the vars it supplied.
process.env.DISABLE_RATE_LIMIT = '1';
process.env.STEAM_API_KEY = 'test-key';
process.env.STEAM_ID = '76561198000000000';

const {
    syncPlayerStats,
    getPlayerStats,
} = await import('../../../lib/server/relay/steam/stats.service.js');

const steamDir = path.join(tmpDir, 'relay', 'steam');
await fs.mkdir(steamDir, { recursive: true });

const FAKE_GAMES = [
    { appid: 10, name: 'Game One', playtime_forever: 120, rtime_last_played: 1700000000 },
    { appid: 20, name: 'Game Two', playtime_forever: 0,   rtime_last_played: 0 },
];

await fs.writeFile(
    path.join(steamDir, 'games.json'),
    JSON.stringify({ gameCount: 2, games: FAKE_GAMES, fetchedAt: new Date().toISOString() })
);

const FAKE_STATS = [
    { name: 'total_kills', value: 1234 },
    { name: 'total_deaths', value: 567 },
];

describe('steam stats service — player stats', () => {
    let originalFetch;

    beforeAll(() => {
        originalFetch = global.fetch;
        global.fetch = vi.fn(async () => ({
            ok: true,
            json: async () => ({ playerstats: { gameName: 'Game One', stats: FAKE_STATS } }),
        }));
    });

    afterAll(() => { global.fetch = originalFetch; });

    it('syncPlayerStats only fetches games with playtime > 0', async () => {
        const result = await syncPlayerStats({ force: true });
        assert.equal(global.fetch.mock.calls.length, 1);
        assert.equal(result.synced, 1);
        assert.equal(result.noStats, 0);
    });

    it('syncPlayerStats stores named stats array', async () => {
        const data = await getPlayerStats();
        assert.ok(data[10]);
        assert.equal(data[10].gameName, 'Game One');
        assert.equal(data[10].stats.length, 2);
        assert.equal(data[10].stats[0].name, 'total_kills');
        assert.equal(data[10].stats[0].value, 1234);
    });

    it('syncPlayerStats skips games not played since last fetch (delta filter)', async () => {
        global.fetch.mockClear();
        const result = await syncPlayerStats();
        assert.equal(result.synced,  0);
        assert.equal(result.skipped, 1);
        assert.equal(global.fetch.mock.calls.length, 0);
    });

    it('syncPlayerStats records noStats when API returns empty stats array', async () => {
        global.fetch = vi.fn(async () => ({
            ok: true,
            json: async () => ({ playerstats: { gameName: 'Game One', stats: [] } }),
        }));
        const result = await syncPlayerStats({ force: true });
        assert.equal(result.noStats, 1);
        assert.equal(result.synced,  0);
    });

    it('syncPlayerStats counts failed when API throws (e.g. 400 no stats schema)', async () => {
        global.fetch = vi.fn(async () => ({
            ok: false, status: 400, statusText: 'Bad Request',
        }));
        const result = await syncPlayerStats({ force: true });
        assert.equal(result.failed, 1);
        assert.equal(result.synced, 0);
    });

    it('getPlayerStats returns cached data without a network call', async () => {
        global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
        const data = await getPlayerStats();
        assert.ok(data[10]);
        assert.equal(global.fetch.mock.calls.length, 0);
        global.fetch = originalFetch;
    });

    afterAll(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });
});
