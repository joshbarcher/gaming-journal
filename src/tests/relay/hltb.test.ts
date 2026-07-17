// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/hltb/hltb.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified).
//
// DATA_DIR must point at a temp dir, never the NAS (.env's DATA_DIR). The
// original sets it before a top-level dynamic import of the service; the same
// pattern works under vitest (ESM top-level await).
import { describe, it, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gj-relay-hltb-test-'));
process.env.DATA_DIR = tmpDir;
delete process.env.RELAY_DATA_ROOT;   // featureDir() must derive from DATA_DIR
// The relay ran its suite with .env.test's DISABLE_RATE_LIMIT=1 — the politeness
// sleeps protect HLTB's servers, and the search function here is injected, so
// there is no server to protect. rateLimitSleep() reads this at call time.
process.env.DISABLE_RATE_LIMIT = '1';

const { syncAll, syncGame, getEntry, getIndex } = await import('../../lib/server/relay/hltb/hltb.service.js');

// Pre-populate the Steam games cache
const steamDir = path.join(tmpDir, 'relay', 'steam');
await fs.mkdir(steamDir, { recursive: true });

const FAKE_GAMES = [
    { appid: 70,  name: 'Half-Life',           playtime_forever: 120 },
    { appid: 220, name: 'Half-Life 2',          playtime_forever: 300 },
    { appid: 999, name: 'xyzzy no match game',  playtime_forever: 10  },
];

await fs.writeFile(
    path.join(steamDir, 'games.json'),
    JSON.stringify({ gameCount: FAKE_GAMES.length, games: FAKE_GAMES, fetchedAt: new Date().toISOString() })
);

// Mock returns raw HLTB API response entries (same shape as /api/bleed data array).
// comp_main / comp_plus / comp_100 are in seconds.
//
// syncAll runs the Steam name through cleanSearchName() first, which turns
// punctuation into spaces ("Half-Life" → "Half Life") so HLTB's search finds the
// game. The mock keys on that cleaned name, not the raw Steam name.
function mockSearch(name: string) {
    if (name === 'Half Life') {
        return [
            { game_id: 2350, game_name: 'Half-Life',       comp_main: 43200, comp_plus: 54000, comp_100: 72000, game_image: '2350.jpg' },
            { game_id: 2351, game_name: 'Half-Life: Alyx', comp_main: 50400, comp_plus: 57600, comp_100: 72000, game_image: '2351.jpg' },
        ];
    }
    if (name === 'Half Life 2') {
        return [
            { game_id: 2352, game_name: 'Half-Life 2', comp_main: 46800, comp_plus: 64800, comp_100: 90000, game_image: '2352.jpg' },
        ];
    }
    // Returns a totally unrelated game — similarity will be below threshold
    return [
        { game_id: 9999, game_name: 'Something Totally Different', comp_main: 18000, comp_plus: 25200, comp_100: 36000, game_image: '9999.jpg' },
    ];
}

// ── syncAll ───────────────────────────────────────────────────────────────────

describe('hltb service — syncAll', () => {
    it('fetches HLTB data for all games using the injected search function', async () => {
        const result = await syncAll({ force: true, searchFn: mockSearch });
        assert.equal(result.total,   3);
        assert.equal(result.fetched, 2);
        assert.equal(result.noMatch, 1); // xyzzy game rejected (similarity < 0.4)
        assert.equal(result.skipped, 0);
        assert.equal(result.failed,  0);
    });

    it('picks the best match when multiple results are returned', async () => {
        const entry = await getEntry(70);
        assert.ok(entry);
        assert.equal(entry.steamName,   'Half-Life');
        assert.equal(entry.matchedName, 'Half-Life');
        assert.equal(entry.hltbId,      2350);
        assert.ok(entry.confidence >= 0.9);
        // Times converted from seconds to hours: 43200s = 12h, 54000s = 15h, 72000s = 20h
        assert.equal(entry.gameplayMain,          12);
        assert.equal(entry.gameplayMainExtra,      15);
        assert.equal(entry.gameplayCompletionist,  20);
        assert.ok(entry.imageUrl.includes('2350.jpg'));
        assert.ok(entry.fetchedAt);
    });

    it('stores matched=false and null times for games with no good match', async () => {
        const entry = await getEntry(999);
        assert.ok(entry);
        assert.equal(entry.matched,      false);
        assert.equal(entry.hltbId,       null);
        assert.equal(entry.gameplayMain, null);
    });

    it('skips already-cached games when force=false', async () => {
        let calls = 0;
        const counting = async (name: string) => { calls++; return mockSearch(name); };
        const result = await syncAll({ force: false, searchFn: counting });
        assert.equal(result.skipped, 3);
        assert.equal(result.fetched, 0);
        assert.equal(calls, 0);
    });

    it('re-fetches everything when force=true', async () => {
        const result = await syncAll({ force: true, searchFn: mockSearch });
        assert.equal(result.fetched + result.noMatch, 3);
    });
});

// ── syncGame — data-integrity preserve ────────────────────────────────────────
// A force refresh whose search returns an empty 200 (transient HLTB hiccup) must
// NOT wipe completion times we already have.
describe('hltb service — syncGame preserve', () => {
    it('keeps existing times when a forced search returns zero results', async () => {
        // appid 70 has good times from the syncAll suite above.
        const before = await getEntry(70);
        assert.ok(before?.gameplayMain, 'precondition: appid 70 already has times');

        const emptySearch = async () => [];
        const result = await syncGame(70, { force: true, searchFn: emptySearch, steamName: 'Half-Life' });

        assert.equal(result.skipped, true);
        assert.equal(result.entry.gameplayMain, before.gameplayMain);

        const onDisk = await getEntry(70);
        assert.equal(onDisk.gameplayMain, before.gameplayMain);
        assert.equal(onDisk.matched, true);
        assert.equal(onDisk.fetchedAt, before.fetchedAt); // not re-stamped
    });
});

// ── getIndex ──────────────────────────────────────────────────────────────────

describe('hltb service — getIndex', () => {
    it('returns only matched games in the index', async () => {
        const index = await getIndex();
        assert.equal(index.length, 2); // Half-Life + Half-Life 2; xyzzy excluded
        const hl2 = index.find((e) => e.appid === 220);
        assert.ok(hl2);
        assert.equal(hl2.matchedName, 'Half-Life 2');
        assert.equal(hl2.gameplayMain, 13); // 46800s / 3600 = 13h
    });
});

// ── getEntry ──────────────────────────────────────────────────────────────────

describe('hltb service — getEntry', () => {
    it('returns null for an uncached appid', async () => {
        const entry = await getEntry(99999);
        assert.equal(entry, null);
    });

    it('returns the full entry for a cached appid', async () => {
        const entry = await getEntry(220);
        assert.ok(entry);
        assert.equal(entry.appid,  220);
        assert.equal(entry.hltbId, 2352);
    });

    afterAll(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });
});
