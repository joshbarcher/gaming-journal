// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/steam/sessions.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified). node:test mock.fn → vi.fn (same .mock.calls shape;
// resetCalls() → mockClear()).
//
// DATA_DIR must point at a temp dir, never the NAS (.env's DATA_DIR). The relay
// ran this suite with .env.test's STEAM_API_KEY/STEAM_ID — set the same values
// here (overwriting whatever vite loaded from .env) before the top-level
// dynamic import of the service.
import { describe, it, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gj-relay-sessions-test-'));
process.env.DATA_DIR = tmpDir;
delete process.env.RELAY_DATA_ROOT;   // featureDir() must derive from DATA_DIR
process.env.DISABLE_RATE_LIMIT = '1'; // relay .env.test — sleeps protect Steam; fetch is stubbed
process.env.STEAM_API_KEY = 'test-key';           // relay .env.test values
process.env.STEAM_ID      = '76561198000000000';

const {
    takeSnapshot,
    deriveSessions,
    getSessions,
    getSnapshots,
    SNAPSHOT_INTERVAL_MS,
    _resetForTests,
} = await import('../../../lib/server/relay/steam/sessions.service.js');

await fs.mkdir(path.join(tmpDir, 'relay', 'steam'), { recursive: true });

// ── takeSnapshot ──────────────────────────────────────────────────────────────

describe('steam sessions — takeSnapshot', () => {
    let originalFetch;

    beforeAll(() => {
        originalFetch = global.fetch;
        global.fetch = vi.fn(async () => ({
            ok: true,
            json: async () => ({
                response: {
                    total_count: 1,
                    games: [
                        { appid: 10, name: 'Game One', playtime_2weeks: 60, playtime_forever: 120 },
                    ],
                },
            }),
        }));
    });

    afterAll(() => { global.fetch = originalFetch; });

    it('takeSnapshot writes a snapshot with game playtime totals', async () => {
        const result = await takeSnapshot();
        assert.ok(result.takenAt);
        assert.equal(result.gameCount, 1);
        assert.equal(global.fetch.mock.calls.length, 1);

        const data = await getSnapshots();
        assert.equal(data.snapshots.length, 1);
        assert.equal(data.snapshots[0].games[0].playtime_forever, 120);
    });

    it('takeSnapshot appends to existing snapshots', async () => {
        await takeSnapshot();
        const data = await getSnapshots();
        assert.equal(data.snapshots.length, 2);
    });

    it('takeSnapshot prunes snapshots older than 30 days', async () => {
        const snapshotPath = path.join(tmpDir, 'relay', 'steam', 'playtime-snapshots.json');
        const current = JSON.parse(await fs.readFile(snapshotPath, 'utf8'));
        const old = {
            takenAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000).toISOString(),
            games: [{ appid: 10, name: 'Game One', playtime_forever: 50 }],
        };
        current.snapshots.unshift(old);
        await fs.writeFile(snapshotPath, JSON.stringify(current));

        await takeSnapshot();
        const data = await getSnapshots();
        const hasOld = data.snapshots.some((s) => s.takenAt === old.takenAt);
        assert.equal(hasOld, false);
    });
});

// ── deriveSessions ────────────────────────────────────────────────────────────

describe('steam sessions — deriveSessions', () => {
    // These tests seed playtime-snapshots.json on disk. ManagedFile.get() never
    // re-reads after load(), so without dropping the memoized handle the service
    // would keep serving the snapshots the takeSnapshot suite left in memory.
    beforeEach(() => _resetForTests());

    afterAll(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('derives a session when playtime increases between snapshots', async () => {
        const snapshotPath = path.join(tmpDir, 'relay', 'steam', 'playtime-snapshots.json');
        const now = Date.now();

        const snapshots = [
            {
                takenAt: new Date(now - 3 * 60 * 60 * 1_000).toISOString(),
                games: [{ appid: 10, name: 'Game One', playtime_forever: 100 }],
            },
            {
                takenAt: new Date(now - 2 * 60 * 60 * 1_000).toISOString(),
                games: [{ appid: 10, name: 'Game One', playtime_forever: 130 }],
            },
            {
                takenAt: new Date(now - 1 * 60 * 60 * 1_000).toISOString(),
                games: [{ appid: 10, name: 'Game One', playtime_forever: 160 }],
            },
        ];
        await fs.writeFile(snapshotPath, JSON.stringify({ snapshots }));

        const result = await deriveSessions();
        assert.ok(result[10]);
        assert.equal(result[10].sessions.length, 1);
        assert.equal(result[10].sessions[0].durationMin, 60);
    });

    it('splits into two sessions when gap exceeds 90 minutes', async () => {
        const snapshotPath = path.join(tmpDir, 'relay', 'steam', 'playtime-snapshots.json');
        const now = Date.now();
        const gap = 95 * 60 * 1_000;

        const snapshots = [
            {
                takenAt: new Date(now - 6 * 60 * 60 * 1_000).toISOString(),
                games: [{ appid: 10, name: 'Game One', playtime_forever: 100 }],
            },
            {
                takenAt: new Date(now - 5 * 60 * 60 * 1_000).toISOString(),
                games: [{ appid: 10, name: 'Game One', playtime_forever: 130 }],
            },
            {
                takenAt: new Date(now - 5 * 60 * 60 * 1_000 + gap).toISOString(),
                games: [{ appid: 10, name: 'Game One', playtime_forever: 130 }],
            },
            {
                takenAt: new Date(now - 60 * 60 * 1_000).toISOString(),
                games: [{ appid: 10, name: 'Game One', playtime_forever: 160 }],
            },
        ];
        await fs.writeFile(snapshotPath, JSON.stringify({ snapshots }));

        const result = await deriveSessions();
        assert.ok(result[10]);
        assert.equal(result[10].sessions.length, 2);
        assert.equal(result[10].sessions[0].durationMin, 30);
        assert.equal(result[10].sessions[1].durationMin, 30);
    });

    it('getSessions returns the derived session data', async () => {
        const data = await getSessions();
        assert.ok(data[10]);
        assert.ok(Array.isArray(data[10].sessions));
    });

    it('returns empty object when fewer than 2 snapshots exist', async () => {
        const snapshotPath = path.join(tmpDir, 'relay', 'steam', 'playtime-snapshots.json');
        await fs.writeFile(snapshotPath, JSON.stringify({ snapshots: [] }));

        const result = await deriveSessions();
        assert.deepEqual(result, {});
    });

    it('SNAPSHOT_INTERVAL_MS is exported and equals 30 minutes', () => {
        assert.equal(SNAPSHOT_INTERVAL_MS, 30 * 60 * 1_000);
    });
});
