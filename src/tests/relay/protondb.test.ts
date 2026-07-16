// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/protondb/protondb.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified).
//
// DATA_DIR must point at a temp dir, never the NAS (.env's DATA_DIR). The
// service reads env at call time via featureDir(), so module-scope assignment
// is safe despite import hoisting.
import { test, describe, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

process.env.DATA_DIR = path.join(os.tmpdir(), `gj-relay-test-protondb-${process.pid}`);
delete process.env.RELAY_DATA_ROOT;   // featureDir() must derive from DATA_DIR

import {
    shapeEntry,
    getEntry,
    getIndex,
    syncOne,
    syncAll,
} from '../../lib/server/relay/protondb/protondb.service.js';

const PROTONDB_DIR = path.join(process.env.DATA_DIR, 'relay', 'protondb');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRawSummary(overrides = {}) {
    return {
        bestReportedTier: 'platinum',
        confidence:       'strong',
        score:            0.92,
        tier:             'gold',
        total:            500,
        trendingTier:     'platinum',
        ...overrides,
    };
}

function mockFetch(raw: unknown) {
    return async () => ({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => raw,
    });
}

function mockFetch404() {
    return async () => ({ ok: false });
}

function mockFetchHtml() {
    return async () => ({
        ok: true,
        headers: { get: () => 'text/html' },
        json: async () => { throw new Error('not JSON'); },
    });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
    await fs.mkdir(PROTONDB_DIR, { recursive: true });
});

afterAll(async () => {
    await fs.rm(process.env.DATA_DIR!, { recursive: true, force: true });
});

beforeEach(async () => {
    // Clear all entry files between tests
    try {
        const files = await fs.readdir(PROTONDB_DIR);
        await Promise.all(files.map(f => fs.unlink(path.join(PROTONDB_DIR, f))));
    } catch { /* empty */ }
});

// ── shapeEntry ────────────────────────────────────────────────────────────────

describe('shapeEntry', () => {
    test('maps all fields from raw API response', () => {
        const raw    = makeRawSummary();
        const result = shapeEntry(1091500, raw);
        assert.equal(result.appid,            1091500);
        assert.equal(result.tier,             'gold');
        assert.equal(result.bestReportedTier, 'platinum');
        assert.equal(result.trendingTier,     'platinum');
        assert.equal(result.confidence,       'strong');
        assert.equal(result.score,            0.92);
        assert.equal(result.total,            500);
        assert.ok(result.fetchedAt);
    });

    test('coerces appid to number', () => {
        const result = shapeEntry('12345', makeRawSummary());
        assert.equal(typeof result.appid, 'number');
        assert.equal(result.appid, 12345);
    });

    test('tolerates missing optional fields with null', () => {
        const result = shapeEntry(1, { tier: 'bronze' });
        assert.equal(result.tier, 'bronze');
        assert.equal(result.score, null);
        assert.equal(result.confidence, null);
    });

    test('returns null when raw is null', () => {
        assert.equal(shapeEntry(1, null), null);
    });
});

// ── getEntry ──────────────────────────────────────────────────────────────────

describe('getEntry', () => {
    test('returns null when no file exists', async () => {
        const result = await getEntry(9999);
        assert.equal(result, null);
    });

    test('returns parsed entry when file exists', async () => {
        const entry = shapeEntry(42, makeRawSummary());
        await fs.writeFile(path.join(PROTONDB_DIR, '42.json'), JSON.stringify(entry));
        const result = await getEntry(42);
        assert.equal(result.appid, 42);
        assert.equal(result.tier, 'gold');
    });
});

// ── getIndex ──────────────────────────────────────────────────────────────────

describe('getIndex', () => {
    test('returns empty array when index does not exist', async () => {
        const result = await getIndex();
        assert.deepEqual(result, []);
    });

    test('returns parsed index when file exists', async () => {
        const idx = [{ appid: 1, tier: 'gold' }];
        await fs.writeFile(path.join(PROTONDB_DIR, 'index.json'), JSON.stringify(idx));
        const result = await getIndex();
        assert.equal(result.length, 1);
        assert.equal(result[0].tier, 'gold');
    });
});

// ── syncOne ───────────────────────────────────────────────────────────────────

describe('syncOne', () => {
    test('fetches and writes entry', async () => {
        const raw    = makeRawSummary({ tier: 'silver' });
        const result = await syncOne(100, { force: true, fetchFn: mockFetch(raw) });
        assert.equal(result.skipped, false);
        assert.equal(result.entry.tier, 'silver');

        const onDisk = await getEntry(100);
        assert.equal(onDisk.tier, 'silver');
    });

    test('writes notFound sentinel when API returns 404', async () => {
        const result = await syncOne(200, { force: true, fetchFn: mockFetch404() });
        assert.equal(result.skipped, false);
        assert.equal(result.entry.tier, null);
        assert.equal(result.entry.notFound, true);
    });

    test('writes notFound sentinel when API returns HTML (CDN 404 page)', async () => {
        const result = await syncOne(201, { force: true, fetchFn: mockFetchHtml() });
        assert.equal(result.entry.notFound, true);
    });

    test('skips fresh non-settled entry', async () => {
        const entry = { ...shapeEntry(300, makeRawSummary({ tier: 'gold' })), fetchedAt: new Date().toISOString() };
        await fs.writeFile(path.join(PROTONDB_DIR, '300.json'), JSON.stringify(entry));

        const result = await syncOne(300, { force: false, fetchFn: mockFetch(makeRawSummary()) });
        assert.equal(result.skipped, true);
    });

    test('skips settled (platinum) entry within settled TTL', async () => {
        const entry = { ...shapeEntry(301, makeRawSummary({ tier: 'platinum' })), fetchedAt: new Date().toISOString() };
        await fs.writeFile(path.join(PROTONDB_DIR, '301.json'), JSON.stringify(entry));

        const result = await syncOne(301, { force: false, fetchFn: mockFetch(makeRawSummary()) });
        assert.equal(result.skipped, true);
    });

    test('re-fetches settled entry past settled TTL', async () => {
        const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000).toISOString();
        const entry   = { ...shapeEntry(302, makeRawSummary({ tier: 'platinum' })), fetchedAt: oldDate };
        await fs.writeFile(path.join(PROTONDB_DIR, '302.json'), JSON.stringify(entry));

        const result = await syncOne(302, { force: false, fetchFn: mockFetch(makeRawSummary({ tier: 'platinum' })) });
        assert.equal(result.skipped, false);
    });

    test('force flag bypasses TTL check', async () => {
        const entry = { ...shapeEntry(303, makeRawSummary({ tier: 'platinum' })), fetchedAt: new Date().toISOString() };
        await fs.writeFile(path.join(PROTONDB_DIR, '303.json'), JSON.stringify(entry));

        const result = await syncOne(303, { force: true, fetchFn: mockFetch(makeRawSummary({ tier: 'gold' })) });
        assert.equal(result.skipped, false);
        assert.equal(result.entry.tier, 'gold');
    });
});

// ── syncAll ───────────────────────────────────────────────────────────────────

describe('syncAll', () => {
    test('throws when no games are available', async () => {
        // getAllGames reads from DATA_DIR — no steam/games.json means it returns []
        await assert.rejects(
            () => syncAll({ fetchFn: mockFetch(makeRawSummary()) }),
            /No games found/
        );
    });

    test('processes multiple games and rebuilds index', async () => {
        // Seed a games.json so getAllGames returns entries
        const steamDir = path.join(process.env.DATA_DIR!, 'relay', 'steam');
        await fs.mkdir(steamDir, { recursive: true });
        await fs.writeFile(
            path.join(steamDir, 'games.json'),
            JSON.stringify({ games: [{ appid: 400, name: 'Game A' }, { appid: 401, name: 'Game B' }] })
        );

        const result = await syncAll({ force: true, fetchFn: mockFetch(makeRawSummary({ tier: 'silver' })) });
        assert.equal(result.total,   2);
        assert.equal(result.fetched, 2);
        assert.equal(result.skipped, 0);

        const index = await getIndex();
        assert.equal(index.length, 2);
        assert.ok(index.every(e => e.tier === 'silver'));

        // Cleanup steam dir
        await fs.rm(steamDir, { recursive: true, force: true });
    });

    // ── Novelty counts feeding the dashboard's new-records chart ─────────────

    test('reports every first-time entry as created', async () => {
        const steamDir = path.join(process.env.DATA_DIR!, 'relay', 'steam');
        await fs.mkdir(steamDir, { recursive: true });
        await fs.writeFile(
            path.join(steamDir, 'games.json'),
            JSON.stringify({ games: [{ appid: 400, name: 'A' }, { appid: 401, name: 'B' }] })
        );

        const result = await syncAll({ force: true, fetchFn: mockFetch(makeRawSummary({ tier: 'gold' })) });
        assert.equal(result.created, 2);
        assert.equal(result.updated, 0);

        await fs.rm(steamDir, { recursive: true, force: true });
    });

    test('a re-sync with an unchanged tier creates and updates nothing', async () => {
        const steamDir = path.join(process.env.DATA_DIR!, 'relay', 'steam');
        await fs.mkdir(steamDir, { recursive: true });
        await fs.writeFile(
            path.join(steamDir, 'games.json'),
            JSON.stringify({ games: [{ appid: 400, name: 'A' }] })
        );

        await syncAll({ force: true, fetchFn: mockFetch(makeRawSummary({ tier: 'gold' })) });
        // Same verdict, drifting report count — must not be charted as new info.
        const again = await syncAll({ force: true, fetchFn: mockFetch(makeRawSummary({ tier: 'gold', total: 999, score: 0.95 })) });

        assert.equal(again.fetched, 1, 'it still pulled the record');
        assert.equal(again.created, 0);
        assert.equal(again.updated, 0, 'score/report drift is not new information');

        await fs.rm(steamDir, { recursive: true, force: true });
    });

    test('a tier promotion is reported as an update', async () => {
        const steamDir = path.join(process.env.DATA_DIR!, 'relay', 'steam');
        await fs.mkdir(steamDir, { recursive: true });
        await fs.writeFile(
            path.join(steamDir, 'games.json'),
            JSON.stringify({ games: [{ appid: 400, name: 'A' }] })
        );

        await syncAll({ force: true, fetchFn: mockFetch(makeRawSummary({ tier: 'gold' })) });
        const again = await syncAll({ force: true, fetchFn: mockFetch(makeRawSummary({ tier: 'platinum' })) });

        assert.equal(again.created, 0);
        assert.equal(again.updated, 1);

        await fs.rm(steamDir, { recursive: true, force: true });
    });
});
