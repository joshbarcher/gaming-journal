// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/metrics/tracked.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified).
//
// DATA_DIR must point at a temp dir, never the NAS (.env's DATA_DIR). The
// service reads env at call time, so module-scope assignment is safe despite
// import hoisting.
import { test, describe, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

process.env.DATA_DIR = path.join(os.tmpdir(), `gj-relay-test-tracked-${process.pid}`);
delete process.env.RELAY_DATA_ROOT;   // metricsDir() must derive from DATA_DIR

import { tracked, toCounts } from '../../../lib/server/relay/metrics/tracked.js';
import { load, close, getRuns, getSourceStatus } from '../../../lib/server/relay/metrics/sync-metrics.service.js';

// Journal-side buckets live in metrics/journal (transitional single-writer split — see sync-metrics.service.js metricsDir()).
const METRICS_DIR = path.join(process.env.DATA_DIR, 'relay', 'metrics', 'journal');

/** The single run recorded so far. */
async function onlyRun() {
    const runs = await getRuns({ sinceMs: Date.now() - 60_000 });
    assert.equal(runs.length, 1, `expected exactly one run, got ${runs.length}`);
    return runs[0];
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => { await fs.mkdir(METRICS_DIR, { recursive: true }); });

afterAll(async () => {
    await close();
    await fs.rm(process.env.DATA_DIR!, { recursive: true, force: true });
});

beforeEach(async () => {
    await close();
    await fs.rm(METRICS_DIR, { recursive: true, force: true });
    await fs.mkdir(METRICS_DIR, { recursive: true });
    await load();
});

// ── toCounts ──────────────────────────────────────────────────────────────────

describe('toCounts', () => {
    test('passes through the canonical shape', () => {
        assert.deepEqual(
            toCounts({ fetched: 3, created: 1, updated: 1, skipped: 2, failed: 1, total: 6 }),
            { fetched: 3, created: 1, updated: 1, skipped: 2, failed: 1, total: 6 },
        );
    });

    test('created and updated default to 0 when a source does not report them', () => {
        const counts = toCounts({ fetched: 2000 });
        assert.equal(counts.created, 0);
        assert.equal(counts.updated, 0);
    });

    test('downloaded and added imply created — the record was not there before', () => {
        assert.equal(toCounts({ downloaded: 5 }).created, 5);   // images.service
        assert.equal(toCounts({ added: 3 }).created,      3);   // scrape-reviews
        assert.equal(toCounts({ newCount: 7 }).created,   7);   // reddit pin refresh
    });

    test('an explicit created wins over the aliases', () => {
        assert.equal(toCounts({ downloaded: 5, created: 2 }).created, 2);
    });

    test('synced implies fetched but NOT created — it may be a re-fetch', () => {
        const counts = toCounts({ synced: 9 });
        assert.equal(counts.fetched, 9);
        assert.equal(counts.created, 0);
    });

    test('resolves the fetched aliases used across services', () => {
        assert.equal(toCounts({ downloaded: 5 }).fetched, 5);   // images.service
        assert.equal(toCounts({ synced: 5 }).fetched,     5);   // achievements
        assert.equal(toCounts({ added: 5 }).fetched,      5);   // scrape-reviews
    });

    test('folds "looked and found nothing" counters into skipped', () => {
        // notFound (protondb), noMatch (hltb), noData (itad), noPage (pcgw), missing (images)
        assert.equal(toCounts({ notFound: 1, noMatch: 2, noData: 3, noPage: 4, missing: 5 }).skipped, 15);
    });

    test('derives total when the service does not report one', () => {
        assert.equal(toCounts({ fetched: 2, skipped: 3, failed: 1 }).total, 6);
    });

    test('prefers an explicit total over the derived one', () => {
        assert.equal(toCounts({ fetched: 2, total: 99 }).total, 99);
    });

    test('handles undefined and non-object results', () => {
        const zero = { fetched: 0, created: 0, updated: 0, skipped: 0, failed: 0, total: 0 };
        assert.deepEqual(toCounts(undefined), zero);
        assert.deepEqual(toCounts(null),      zero);
        assert.deepEqual(toCounts('nope'),    zero);
    });

    test('the zero object is not shared between calls', () => {
        const a = toCounts(undefined);
        a.fetched = 99;
        assert.equal(toCounts(undefined).fetched, 0);
    });

    test('carries an error field through', () => {
        assert.equal(toCounts({ fetched: 0, error: 'rate limited' }).error, 'rate limited');
    });

    test('omits the error field when absent', () => {
        assert.equal('error' in toCounts({ fetched: 1 }), false);
    });
});

// ── tracked ───────────────────────────────────────────────────────────────────

describe('tracked', () => {
    test('records a successful run and passes the result through', async () => {
        const result = await tracked('protondb', async () => ({ fetched: 7, skipped: 1, total: 8 }));
        assert.deepEqual(result, { fetched: 7, skipped: 1, total: 8 });

        const run = await onlyRun();
        assert.equal(run.id,      'protondb');
        assert.equal(run.ok,      true);
        assert.equal(run.fetched, 7);
        assert.equal(run.error,   null);
        assert.ok(run.ms >= 0);
    });

    test('records a failure and re-throws so caller behaviour is unchanged', async () => {
        await assert.rejects(
            () => tracked('itad', async () => { throw new Error('429 rate limited'); }),
            /429 rate limited/,
        );

        const run = await onlyRun();
        assert.equal(run.ok,    false);
        assert.equal(run.error, '429 rate limited');
        assert.equal(getSourceStatus('itad').consecutiveFailures, 1);
    });

    test('records a partial failure without throwing when the result carries an error', async () => {
        // mail's incrementalSync swallows per-account errors and resolves.
        const result = await tracked('mail', async () => ({ fetched: 0, failed: 1, error: 'a@b.com: 401' }));
        assert.equal(result.error, 'a@b.com: 401');

        const run = await onlyRun();
        assert.equal(run.ok,    false);
        assert.equal(run.error, 'a@b.com: 401');
    });

    test('applies a mapCounts function to the result', async () => {
        const cache = { fetchedAt: '2026-07-09T00:00:00Z', games: [1, 2, 3] };
        await tracked('steam:library', async () => cache, r => ({ fetched: r.games.length }));

        assert.equal((await onlyRun()).fetched, 3);
    });

    test('mapCounts output still flows through toCounts defaults', async () => {
        await tracked('hltb', async () => ({}), () => ({ fetched: 2 }));
        const run = await onlyRun();
        assert.equal(run.fetched, 2);
        assert.equal(run.skipped, 0);
        assert.equal(run.total,   2);
    });

    test('a sync returning nothing records a zero-count success, not a crash', async () => {
        await tracked('sms', async () => undefined);
        const run = await onlyRun();
        assert.equal(run.ok,      true);
        assert.equal(run.fetched, 0);
    });

    // ── The load-bearing guarantee ────────────────────────────────────────────

    test('a telemetry failure never breaks the wrapped sync', async () => {
        // 'not-a-source' makes recordRun throw. The sync must still succeed.
        const result = await tracked('not-a-source', async () => ({ fetched: 42 }));
        assert.deepEqual(result, { fetched: 42 });
    });

    test('a telemetry failure never masks the wrapped sync\'s own error', async () => {
        await assert.rejects(
            () => tracked('not-a-source', async () => { throw new Error('the real problem'); }),
            /the real problem/,
        );
    });
});
