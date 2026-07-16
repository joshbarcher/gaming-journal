// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/metrics/sync-metrics.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified).
//
// DATA_DIR must point at a temp dir, never the NAS (.env's DATA_DIR). The
// service reads env at call time via featureDir(), so setting it at module
// scope — even though static imports hoist above this line — is safe.
import { test, describe, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

process.env.DATA_DIR = path.join(os.tmpdir(), `gj-relay-test-metrics-${process.pid}`);
delete process.env.RELAY_DATA_ROOT;   // metricsDir() must derive from DATA_DIR

import {
    load,
    close,
    recordRun,
    getRuns,
    getErrors,
    getSourceStatus,
    getDailyTotals,
    novelRecords,
    pruneOldBuckets,
    monthKey,
    monthRange,
    dayKey,
} from '../../../lib/server/relay/metrics/sync-metrics.service.js';

// Journal-side buckets live in metrics/journal (transitional single-writer split — see sync-metrics.service.js metricsDir()).
const METRICS_DIR = path.join(process.env.DATA_DIR, 'relay', 'metrics', 'journal');

const DAY_MS = 86_400_000;

/** A fixed clock so month/day bucketing is deterministic regardless of run date. */
const NOW = Date.parse('2026-07-09T12:00:00.000Z');

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
    await fs.mkdir(METRICS_DIR, { recursive: true });
});

afterAll(async () => {
    await close();
    await fs.rm(process.env.DATA_DIR!, { recursive: true, force: true });
});

beforeEach(async () => {
    await close();
    await fs.rm(METRICS_DIR, { recursive: true, force: true });
    await fs.mkdir(METRICS_DIR, { recursive: true });
    await load(NOW);
});

// ── Date helpers ──────────────────────────────────────────────────────────────

describe('date helpers', () => {
    test('monthKey and dayKey use UTC', () => {
        assert.equal(monthKey(NOW), '2026-07');
        assert.equal(dayKey(NOW),   '2026-07-09');
    });

    test('monthRange is inclusive on both ends', () => {
        const from = Date.parse('2026-05-14T00:00:00Z');
        assert.deepEqual(monthRange(from, NOW), ['2026-05', '2026-06', '2026-07']);
    });

    test('monthRange does not skip a month when the start is late in a long month', () => {
        // Jan 31 minus one month is not "Feb 31" — naive setUTCMonth arithmetic
        // would overflow into March and silently drop February.
        const from = Date.parse('2026-01-31T00:00:00Z');
        const to   = Date.parse('2026-03-01T00:00:00Z');
        assert.deepEqual(monthRange(from, to), ['2026-01', '2026-02', '2026-03']);
    });

    test('monthRange over a single month returns one key', () => {
        assert.deepEqual(monthRange(NOW, NOW), ['2026-07']);
    });
});

// ── recordRun ─────────────────────────────────────────────────────────────────

describe('recordRun', () => {
    test('stores a successful run with normalised counts', async () => {
        const run = await recordRun({
            id: 'protondb', ok: true, ms: 1234.6,
            counts: { fetched: 10, skipped: 2, notFound: 1, total: 13 },
            at: NOW,
        });

        assert.equal(run.id,      'protondb');
        assert.equal(run.ok,      true);
        assert.equal(run.ms,      1235);
        assert.equal(run.fetched, 10);
        assert.equal(run.skipped, 2);
        assert.equal(run.total,   13);
        assert.equal(run.error,   null);
        assert.equal(run.at,      new Date(NOW).toISOString());
    });

    test('defaults absent counts to 0 rather than null', async () => {
        const run = await recordRun({ id: 'mail', ok: true, at: NOW });
        assert.equal(run.fetched, 0);
        assert.equal(run.skipped, 0);
        assert.equal(run.failed,  0);
        assert.equal(run.total,   0);
    });

    test('captures an Error message on failure', async () => {
        const run = await recordRun({ id: 'itad', ok: false, error: new Error('429 rate limited'), at: NOW });
        assert.equal(run.ok,    false);
        assert.equal(run.error, '429 rate limited');
    });

    test('coerces a non-Error rejection into a string', async () => {
        const run = await recordRun({ id: 'itad', ok: false, error: 'socket hang up', at: NOW });
        assert.equal(run.error, 'socket hang up');
    });

    test('rejects an unknown source id', async () => {
        await assert.rejects(
            () => recordRun({ id: 'not-a-source', ok: true, at: NOW }),
            /unknown source id/,
        );
    });

    test('rejects a bare top-level id for a split source', async () => {
        // 'steam' alone is meaningless — callers must name a subsystem.
        await assert.rejects(() => recordRun({ id: 'steam', ok: true, at: NOW }), /unknown source id/);
        await recordRun({ id: 'steam:images', ok: true, at: NOW });
    });
});

// ── getRuns ───────────────────────────────────────────────────────────────────

describe('getRuns', () => {
    test('returns runs oldest first', async () => {
        await recordRun({ id: 'hltb', ok: true, at: NOW });
        await recordRun({ id: 'hltb', ok: true, at: NOW - 2 * DAY_MS });
        await recordRun({ id: 'hltb', ok: true, at: NOW - 1 * DAY_MS });

        const runs = await getRuns({ sinceMs: NOW - 5 * DAY_MS, now: NOW });
        assert.equal(runs.length, 3);
        const times = runs.map(r => Date.parse(r.at));
        assert.deepEqual(times, [...times].sort((a, b) => a - b));
    });

    test('excludes runs before sinceMs', async () => {
        await recordRun({ id: 'hltb', ok: true, at: NOW - 5 * DAY_MS });
        await recordRun({ id: 'hltb', ok: true, at: NOW });

        const runs = await getRuns({ sinceMs: NOW - DAY_MS, now: NOW });
        assert.equal(runs.length, 1);
    });

    test('filters by source id', async () => {
        await recordRun({ id: 'hltb',        ok: true, at: NOW });
        await recordRun({ id: 'steam:images', ok: true, at: NOW });

        const runs = await getRuns({ sinceMs: NOW - DAY_MS, id: 'hltb', now: NOW });
        assert.equal(runs.length, 1);
        assert.equal(runs[0].id, 'hltb');
    });

    test('reads across a month boundary', async () => {
        const lastMonth = Date.parse('2026-06-28T00:00:00Z');
        await recordRun({ id: 'hltb', ok: true, at: lastMonth });
        await recordRun({ id: 'hltb', ok: true, at: NOW });

        const runs = await getRuns({ sinceMs: lastMonth - DAY_MS, now: NOW });
        assert.equal(runs.length, 2);

        // ...and that really is two separate bucket files on disk.
        await close();
        const files = (await fs.readdir(METRICS_DIR)).filter(f => /^runs-\d{4}-\d{2}\.json$/.test(f));
        assert.deepEqual(files.sort(), ['runs-2026-06.json', 'runs-2026-07.json']);
    });

    test('sinceMs of 0 is clamped to the retention window, not the epoch', async () => {
        await recordRun({ id: 'hltb', ok: true, at: NOW });
        // Would otherwise open ~670 monthly ManagedFiles back to 1970.
        const runs = await getRuns({ sinceMs: 0, now: NOW });
        assert.equal(runs.length, 1);
    });
});

// ── getSourceStatus ───────────────────────────────────────────────────────────

describe('getSourceStatus', () => {
    test('tracks last run, last success, and consecutive failures', async () => {
        await recordRun({ id: 'itad', ok: true,  at: NOW - 3 * DAY_MS });
        await recordRun({ id: 'itad', ok: false, error: new Error('boom'), at: NOW - 2 * DAY_MS });
        await recordRun({ id: 'itad', ok: false, error: new Error('boom again'), at: NOW - DAY_MS });

        const status = getSourceStatus('itad');
        assert.equal(status.ok,                  false);
        assert.equal(status.consecutiveFailures, 2);
        assert.equal(status.lastError,           'boom again');
        assert.equal(status.lastRunAt,     new Date(NOW - DAY_MS).toISOString());
        assert.equal(status.lastSuccessAt, new Date(NOW - 3 * DAY_MS).toISOString());
    });

    test('a success resets the failure streak and clears the error', async () => {
        await recordRun({ id: 'itad', ok: false, error: new Error('boom'), at: NOW - DAY_MS });
        await recordRun({ id: 'itad', ok: true,  at: NOW });

        const status = getSourceStatus('itad');
        assert.equal(status.ok,                  true);
        assert.equal(status.consecutiveFailures, 0);
        assert.equal(status.lastError,           null);
    });

    test('a failure preserves the earlier lastSuccessAt', async () => {
        await recordRun({ id: 'itad', ok: true,  at: NOW - DAY_MS });
        await recordRun({ id: 'itad', ok: false, error: new Error('boom'), at: NOW });
        assert.equal(getSourceStatus('itad').lastSuccessAt, new Date(NOW - DAY_MS).toISOString());
    });

    test('returns null for a source that has never run', () => {
        assert.equal(getSourceStatus('pcgw'), null);
    });

    test('returns every tracked source when called with no id', async () => {
        await recordRun({ id: 'hltb',         ok: true, at: NOW });
        await recordRun({ id: 'steam:images', ok: true, at: NOW });
        assert.deepEqual(Object.keys(getSourceStatus()).sort(), ['hltb', 'steam:images']);
    });

    test('is rebuilt from disk on load', async () => {
        await recordRun({ id: 'hltb', ok: false, error: new Error('down'), at: NOW });
        await close();          // flushes to disk and clears the in-memory index

        assert.equal(getSourceStatus('hltb'), null);
        await load(NOW);

        const status = getSourceStatus('hltb');
        assert.equal(status.ok,        false);
        assert.equal(status.lastError, 'down');
    });
});

// ── getErrors ─────────────────────────────────────────────────────────────────

describe('getErrors', () => {
    test('returns only failures, newest first', async () => {
        await recordRun({ id: 'hltb', ok: true,  at: NOW - 3 * DAY_MS });
        await recordRun({ id: 'hltb', ok: false, error: new Error('first'),  at: NOW - 2 * DAY_MS });
        await recordRun({ id: 'itad', ok: false, error: new Error('second'), at: NOW - DAY_MS });

        const errors = await getErrors({ sinceMs: NOW - 5 * DAY_MS, now: NOW });
        assert.equal(errors.length, 2);
        assert.equal(errors[0].error, 'second');
        assert.equal(errors[1].error, 'first');
    });

    test('honours the limit', async () => {
        for (let i = 1; i <= 5; i++) {
            await recordRun({ id: 'hltb', ok: false, error: new Error(`e${i}`), at: NOW - i * 1000 });
        }
        const errors = await getErrors({ limit: 2, sinceMs: NOW - DAY_MS, now: NOW });
        assert.equal(errors.length, 2);
    });
});

// ── getDailyTotals ────────────────────────────────────────────────────────────

describe('getDailyTotals', () => {
    test('buckets new records by day and top-level source', async () => {
        await recordRun({ id: 'steam:images',  ok: true, counts: { created: 5 }, at: NOW });
        await recordRun({ id: 'steam:library', ok: true, counts: { created: 3 }, at: NOW });
        await recordRun({ id: 'hltb',          ok: true, counts: { created: 7 }, at: NOW });

        const days  = await getDailyTotals({ days: 3, now: NOW });
        const today = days.at(-1);

        assert.equal(today.day, '2026-07-09');
        // steam:images + steam:library collapse into one 'steam' segment
        assert.equal(today.bySource.steam, 8);
        assert.equal(today.bySource.hltb,  7);
        assert.equal(today.total,          15);
    });

    test('sums created and updated as "new information"', async () => {
        await recordRun({ id: 'steam:achievements', ok: true, counts: { created: 2, updated: 3 }, at: NOW });
        const today = (await getDailyTotals({ days: 1, now: NOW })).at(-1);
        assert.equal(today.total, 5);
    });

    // ── The whole point of the redesign ──────────────────────────────────────

    test('ignores fetched — a re-pull of known records is not new information', async () => {
        // steam:library fetches 2,000 games every day and creates none of them.
        await recordRun({ id: 'steam:library', ok: true, counts: { fetched: 2000, created: 0 }, at: NOW });
        const today = (await getDailyTotals({ days: 1, now: NOW })).at(-1);
        assert.equal(today.total, 0, 'fetched volume must not reach the chart');
    });

    test('excludes sampling sources, however much they pull', async () => {
        // player-counts writes ~2,400 samples a day; every one is new by
        // construction, and charting them drowns every other source.
        await recordRun({ id: 'steam:player-counts', ok: true, counts: { fetched: 2400, created: 2400 }, at: NOW });
        await recordRun({ id: 'steam:sessions',      ok: true, counts: { fetched: 1, created: 1 }, at: NOW });
        await recordRun({ id: 'hltb',                ok: true, counts: { created: 7 }, at: NOW });

        const today = (await getDailyTotals({ days: 1, now: NOW })).at(-1);
        assert.equal(today.bySource.steam, undefined, 'sampling sources contribute no segment');
        assert.equal(today.total, 7);
    });

    test('excludes sources that do not report novelty yet', async () => {
        // pcgw has novelty:false — a 0 from it would be a claim we never measured.
        await recordRun({ id: 'pcgw', ok: true, counts: { fetched: 500 }, at: NOW });
        const today = (await getDailyTotals({ days: 1, now: NOW })).at(-1);
        assert.deepEqual(today.bySource, {});
    });

    test('itad and protondb report price and tier changes as new information', async () => {
        await recordRun({ id: 'itad',     ok: true, counts: { fetched: 600, updated: 42 }, at: NOW });
        await recordRun({ id: 'protondb', ok: true, counts: { fetched: 900, updated: 7, created: 1 }, at: NOW });

        const today = (await getDailyTotals({ days: 1, now: NOW })).at(-1);
        assert.equal(today.bySource.itad,     42);
        assert.equal(today.bySource.protondb, 8);
    });

    test('emits empty buckets for days with no runs', async () => {
        await recordRun({ id: 'hltb', ok: true, counts: { created: 1 }, at: NOW });

        const days = await getDailyTotals({ days: 3, now: NOW });
        assert.equal(days.length, 3);
        assert.deepEqual(days.map(d => d.day), ['2026-07-07', '2026-07-08', '2026-07-09']);
        assert.deepEqual(days[0].bySource, {});
        assert.equal(days[0].total, 0);
    });

    test('counts new records only, not skipped ones', async () => {
        await recordRun({ id: 'hltb', ok: true, counts: { created: 2, skipped: 900, total: 902 }, at: NOW });
        const today = (await getDailyTotals({ days: 1, now: NOW })).at(-1);
        assert.equal(today.total, 2);
    });

    test('a failed run contributes nothing to the chart', async () => {
        await recordRun({ id: 'hltb', ok: false, error: new Error('x'), at: NOW });
        const today = (await getDailyTotals({ days: 1, now: NOW })).at(-1);
        assert.equal(today.total, 0);
    });

    test('spans a month boundary without a hole', async () => {
        await recordRun({ id: 'hltb', ok: true, counts: { created: 4 }, at: Date.parse('2026-06-30T10:00:00Z') });
        await recordRun({ id: 'hltb', ok: true, counts: { created: 6 }, at: Date.parse('2026-07-01T10:00:00Z') });

        const days = await getDailyTotals({ days: 14, now: NOW });
        const jun30 = days.find(d => d.day === '2026-06-30');
        const jul01 = days.find(d => d.day === '2026-07-01');
        assert.equal(jun30.total, 4);
        assert.equal(jul01.total, 6);
    });
});

describe('novelRecords', () => {
    test('is created plus updated', () => {
        assert.equal(novelRecords({ created: 2, updated: 3 }), 5);
    });

    test('tolerates a run recorded before the counters existed', () => {
        assert.equal(novelRecords({ fetched: 9 }), 0);
    });
});

// ── Retention ─────────────────────────────────────────────────────────────────

describe('pruneOldBuckets', () => {
    test('deletes buckets older than the retention window and keeps the rest', async () => {
        await fs.writeFile(path.join(METRICS_DIR, 'runs-2025-01.json'), '{"month":"2025-01","runs":[]}');
        await fs.writeFile(path.join(METRICS_DIR, 'runs-2026-02.json'), '{"month":"2026-02","runs":[]}');
        await fs.writeFile(path.join(METRICS_DIR, 'runs-2026-06.json'), '{"month":"2026-06","runs":[]}');

        const pruned = await pruneOldBuckets(NOW);   // cutoff: 2026-04
        assert.equal(pruned, 2);

        // The current month's bucket lives in memory until something flushes it.
        const left = (await fs.readdir(METRICS_DIR)).filter(f => f.startsWith('runs-'));
        assert.deepEqual(left.sort(), ['runs-2026-06.json']);
    });

    test('ignores files that are not run buckets', async () => {
        await fs.writeFile(path.join(METRICS_DIR, 'disk-usage.json'), '{}');
        await pruneOldBuckets(NOW);
        assert.ok((await fs.readdir(METRICS_DIR)).includes('disk-usage.json'));
    });

    test('is a no-op when the metrics directory is absent', async () => {
        await close();
        await fs.rm(METRICS_DIR, { recursive: true, force: true });
        assert.equal(await pruneOldBuckets(NOW), 0);
    });
});
