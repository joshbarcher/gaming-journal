// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/metrics/disk-usage.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified). In the port relayDir() = relayDataRoot(), whose
// default is path.join(DATA_DIR, 'relay') — identical to the relay — provided
// RELAY_DATA_ROOT is unset, which we guarantee below.
//
// DATA_DIR must point at a temp dir, never the NAS (.env's DATA_DIR). The
// service reads env at call time, so module-scope assignment is safe despite
// import hoisting.
import { test, describe, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

process.env.DATA_DIR = path.join(os.tmpdir(), `gj-relay-test-disk-usage-${process.pid}`);
delete process.env.RELAY_DATA_ROOT;   // relayDir() must derive from DATA_DIR

import {
    scanSource,
    scanAll,
    getUsage,
    isScanning,
    getScanProgress,
    _sourceWeights,
    close,
} from '../../../lib/server/relay/metrics/disk-usage.service.js';

const DATA_DIR  = process.env.DATA_DIR;
const RELAY_DIR = path.join(DATA_DIR, 'relay');

// ManagedFile's write-retry backoff runs ~2.75s per failed flush cycle; the two
// blocker tests below sit through several cycles by design. node:test had no
// per-test timeout — give vitest enough rope. Harness-only, not a behavior change.
const SLOW = 30_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Write a file of exactly `bytes` length at a relay-relative path. */
async function writeFile(relPath: string, bytes: number) {
    const abs = path.join(RELAY_DIR, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, Buffer.alloc(bytes, 'x'));
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
    await fs.mkdir(RELAY_DIR, { recursive: true });
});

afterAll(async () => {
    process.env.DATA_DIR = DATA_DIR;
    await close();
    await fs.rm(DATA_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
    // If a prior test timed out mid-DATA_DIR swap, its finally never ran —
    // re-pin the env so one timeout cannot cascade through the whole file.
    process.env.DATA_DIR = DATA_DIR;
    await close();
    await fs.rm(RELAY_DIR, { recursive: true, force: true });
    await fs.mkdir(RELAY_DIR, { recursive: true });
});

// ── scanSource ────────────────────────────────────────────────────────────────

describe('scanSource', () => {
    test('sums files and bytes into the right subsystem', async () => {
        await writeFile('steam/images/440/header.jpg', 100);
        await writeFile('steam/images/570/header.jpg', 200);
        await writeFile('steam/games.json',            50);

        const totals = await scanSource('steam');
        assert.deepEqual(totals['steam:images'],  { files: 2, bytes: 300 });
        assert.deepEqual(totals['steam:library'], { files: 1, bytes: 50 });
    });

    test('recurses into nested directories', async () => {
        await writeFile('guides/440/ign/1/content.json',    10);
        await writeFile('guides/440/ign/1/img/shot.png',    20);
        await writeFile('guides/570/game8/2/content.json',  30);

        const totals = await scanSource('guides');
        assert.deepEqual(totals['guides'], { files: 3, bytes: 60 });
    });

    test('attributes unclaimed files to <source>:other so bytes are never dropped', async () => {
        await writeFile('steam/games.json',       10);
        await writeFile('steam/mystery-blob.bin', 90);

        const totals = await scanSource('steam');
        assert.deepEqual(totals['steam:other'], { files: 1, bytes: 90 });

        const summed = Object.values(totals).reduce((a, b) => a + b.bytes, 0);
        assert.equal(summed, 100, 'per-source bytes must reconcile with what is on disk');
    });

    test('always emits an :other bucket, so "nothing unclaimed" differs from "never scanned"', async () => {
        await writeFile('hltb/index.json', 10);
        const totals = await scanSource('hltb');
        assert.deepEqual(totals['hltb:other'], { files: 0, bytes: 0 });
    });

    test('separates sibling subsystems that share a path prefix', async () => {
        await writeFile('steam/news/440.json',                10);
        await writeFile('steam/news-index.json',              20);
        await writeFile('steam/community-reviews/440.json',   30);
        await writeFile('steam/reviews.json',                 40);

        const totals = await scanSource('steam');
        assert.equal(totals['steam:news'].bytes,              30);  // dir + index file
        assert.equal(totals['steam:community-reviews'].bytes, 30);
        assert.equal(totals['steam:reviews'].bytes,           40);
        assert.equal(totals['steam:other'].files,             0);
    });

    test('counts ManagedFile checkpoint sidecars against their owning source', async () => {
        await writeFile('steam/games.json',                 10);
        await writeFile('steam/games.json.checkpoint.json', 10);

        const totals = await scanSource('steam');
        assert.deepEqual(totals['steam:library'], { files: 2, bytes: 20 });
        assert.equal(totals['steam:other'].files, 0);
    });

    test('returns empty totals for a source directory that does not exist', async () => {
        const totals = await scanSource('protondb');
        assert.deepEqual(totals, { 'protondb:other': { files: 0, bytes: 0 } });
    });

    test('ignores an empty directory', async () => {
        await fs.mkdir(path.join(RELAY_DIR, 'itad', 'empty'), { recursive: true });
        const totals = await scanSource('itad');
        assert.equal(totals['itad'], undefined);
    });
});

// ── scanAll ───────────────────────────────────────────────────────────────────

describe('scanAll', () => {
    test('walks every top-level source and caches the result', async () => {
        await writeFile('steam/images/440/header.jpg', 100);
        await writeFile('hltb/index.json',              25);

        const now    = Date.parse('2026-07-09T03:00:00.000Z');
        const result = await scanAll({ now });

        assert.equal(result.scannedAt, new Date(now).toISOString());
        assert.equal(result.sources['steam:images'].bytes, 100);
        assert.equal(result.sources['hltb'].bytes,          25);
        assert.ok(result.scanMs >= 0);
    });

    test('persists the cache so getUsage returns it after a reload', async () => {
        await writeFile('hltb/index.json', 25);
        await scanAll({ now: Date.parse('2026-07-09T03:00:00.000Z') });
        await close();     // flush + drop the in-memory handle

        const usage = await getUsage();
        assert.equal(usage.sources['hltb'].bytes, 25);
        assert.equal(usage.scannedAt, '2026-07-09T03:00:00.000Z');
    });

    test('a later scan replaces the earlier totals rather than accumulating them', async () => {
        await writeFile('hltb/index.json', 25);
        await scanAll({ now: Date.parse('2026-07-08T03:00:00.000Z') });

        await fs.rm(path.join(RELAY_DIR, 'hltb'), { recursive: true, force: true });
        await writeFile('hltb/index.json', 10);
        const second = await scanAll({ now: Date.parse('2026-07-09T03:00:00.000Z') });

        assert.deepEqual(second.sources['hltb'], { files: 1, bytes: 10 });
    });

    test('is not scanning once it has returned', async () => {
        await scanAll({ now: Date.now() });
        assert.equal(isScanning(), false);
    });

    test('reports isScanning() while a scan is in flight', async () => {
        await writeFile('hltb/index.json', 10);
        const inFlight = scanAll({ now: Date.now() });
        assert.equal(isScanning(), true, 'the guard is claimed before the first await yields');
        await inFlight;
        assert.equal(isScanning(), false);
    });

    test('rejects an overlapping scan instead of walking the share twice', async () => {
        await writeFile('hltb/index.json', 10);
        const first = scanAll({ now: Date.now() });

        await assert.rejects(() => scanAll({ now: Date.now() }), /already in progress/);
        await first;

        // The guard releases, so a later scan still works.
        await scanAll({ now: Date.now() });
    });

    test('releases the guard when a scan throws', async () => {
        // A missing directory is not enough — scanSource() swallows an unreadable
        // dir by design. Point DATA_DIR at a *file* so the cache write's mkdir
        // fails with ENOTDIR and scanAll() genuinely rejects.
        const realDir = process.env.DATA_DIR!;
        const blocker = path.join(realDir, 'blocker');
        await fs.writeFile(blocker, 'not a directory');
        await close();

        process.env.DATA_DIR = blocker;
        try {
            await assert.rejects(() => scanAll({ now: Date.now() }));
        } finally {
            process.env.DATA_DIR = realDir;
            // The cache file is left dirty pointing at the bad path; drop it so
            // the next test opens a fresh handle. close() must not rethrow here.
            await close().catch(() => {});
        }

        assert.equal(isScanning(), false, 'a failed scan must not wedge the guard shut');
    }, SLOW);

    test('close() drops the handle even when the final flush fails', async () => {
        const realDir = process.env.DATA_DIR!;
        const blocker = path.join(realDir, 'blocker2');
        await fs.writeFile(blocker, 'not a directory');
        await close();

        process.env.DATA_DIR = blocker;
        await scanAll({ now: Date.now() }).catch(() => {});   // leaves the cache dirty
        await close().catch(() => {});
        process.env.DATA_DIR = realDir;

        // A wedged handle would still point at `blocker` and throw here.
        await writeFile('hltb/index.json', 5);
        const result = await scanAll({ now: Date.now() });
        assert.equal(result.sources['hltb'].bytes, 5);
    }, SLOW);
});

// ── Scan progress ─────────────────────────────────────────────────────────────

describe('scan progress', () => {
    test('scanSource reports file-level progress, starting at 0 of the total', async () => {
        await writeFile('hltb/a.json', 1);
        await writeFile('hltb/b.json', 1);
        await writeFile('hltb/c.json', 1);

        const calls: Array<[number, number]> = [];
        await scanSource('hltb', (done: number, total: number) => calls.push([done, total]));

        // One priming call at 0, then one per file — so a caller can render a
        // bar before the first stat() returns.
        assert.deepEqual(calls[0], [0, 3]);
        assert.equal(calls.length, 4);
        assert.deepEqual(calls.at(-1), [3, 3]);
        assert.deepEqual(calls.map(c => c[0]), [0, 1, 2, 3]);
    });

    test('scanSource reports a zero total for a directory that does not exist', async () => {
        const calls: Array<[number, number]> = [];
        await scanSource('protondb', (done: number, total: number) => calls.push([done, total]));
        assert.deepEqual(calls, [[0, 0]]);
    });

    test('weights are equal before any scan has run', async () => {
        const weights = await _sourceWeights();
        const values = Object.values(weights);
        assert.ok(values.length > 1);
        assert.ok(values.every(v => v === 1), 'a first scan cannot know the shape of the tree');
    });

    test('weights track file counts after a scan, so the bar tracks work', async () => {
        // The bug this fixes: an unweighted 12-step bar sat at 0% for ~80s while
        // `steam` (100k of 246k files) was walked.
        await writeFile('steam/images/1.jpg', 1);
        await writeFile('steam/images/2.jpg', 1);
        await writeFile('steam/images/3.jpg', 1);
        await writeFile('hltb/index.json', 1);
        await scanAll({ now: Date.now() });

        const weights = await _sourceWeights();
        assert.equal(weights.steam, 3);
        assert.equal(weights.hltb,  1);
        assert.equal(weights.itad,  0, 'an empty directory earns no weight');
    });

    test('progress is null when idle and carries the current source while scanning', async () => {
        await writeFile('hltb/index.json', 1);
        assert.equal(getScanProgress(), null);

        const seen: Array<{ source: string; done: number; total: number }> = [];
        const timer = setInterval(() => {
            const p = getScanProgress();
            if (p) seen.push(p);
        }, 1);
        await scanAll({ now: Date.now() });
        clearInterval(timer);

        assert.equal(getScanProgress(), null, 'progress must clear when the scan settles');
        assert.ok(seen.length > 0, 'progress must be observable mid-scan');
        assert.ok(seen.every(p => typeof p.source === 'string'), 'every sample names the directory being walked');
        assert.ok(seen.every(p => p.total > 0), 'total must never be zero, or the UI divides by it');

        const pcts = seen.map(p => p.done / p.total);
        assert.deepEqual(pcts, [...pcts].sort((a, b) => a - b), 'progress must never go backwards');
        assert.ok(pcts.at(-1) <= 1, 'progress must never exceed 100%');
    });
});

// ── getUsage ──────────────────────────────────────────────────────────────────

describe('getUsage', () => {
    test('reports scannedAt as null before any scan has completed', async () => {
        const usage = await getUsage();
        assert.equal(usage.scannedAt, null);
        assert.deepEqual(usage.sources, {});
    });
});
