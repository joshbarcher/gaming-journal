// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/metrics/dashboard.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified).
//
// DATA_DIR must point at a temp dir, never the NAS (.env's DATA_DIR). The
// services read env at call time, so module-scope assignment is safe despite
// import hoisting.
import { test, describe, beforeAll, afterAll, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

process.env.DATA_DIR = path.join(os.tmpdir(), `gj-relay-test-dashboard-${process.pid}`);
delete process.env.RELAY_DATA_ROOT;   // metricsDir()/relayDir() must derive from DATA_DIR

import { getSummary, getTimeseries, getRecentErrors, deriveStatus } from '../../../lib/server/relay/metrics/dashboard.service.js';
import { load, close, recordRun } from '../../../lib/server/relay/metrics/sync-metrics.service.js';
import { scanAll, close as closeDisk } from '../../../lib/server/relay/metrics/disk-usage.service.js';
import { getSource, CHART_SERIES, chartSeriesOf, STALE_FACTOR, isCharted, SOURCES } from '../../../lib/server/relay/metrics/sources.js';

const RELAY_DIR   = path.join(process.env.DATA_DIR, 'relay');
// Journal-side buckets live in metrics/journal (transitional single-writer split — see sync-metrics.service.js metricsDir()).
const METRICS_DIR = path.join(RELAY_DIR, 'metrics', 'journal');

const MIN    = 60_000;
const DAY_MS = 86_400_000;
const NOW    = Date.parse('2026-07-09T12:00:00.000Z');

async function writeFile(relPath, bytes) {
    const abs = path.join(RELAY_DIR, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, Buffer.alloc(bytes, 'x'));
}

const rowFor = (summary, id) => summary.sources.find(s => s.id === id);

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => { await fs.mkdir(METRICS_DIR, { recursive: true }); });

afterAll(async () => {
    await close();
    await closeDisk();
    await fs.rm(process.env.DATA_DIR, { recursive: true, force: true });
});

beforeEach(async () => {
    await close();
    await closeDisk();
    await fs.rm(RELAY_DIR, { recursive: true, force: true });
    await fs.mkdir(METRICS_DIR, { recursive: true });
    await load(NOW);
});

// ── deriveStatus — the logic a dashboard most easily gets wrong ───────────────

describe('deriveStatus', () => {
    const scheduled = getSource('hltb');       // intervalMs 30m
    const onDemand  = getSource('guides');

    test('a scheduled source that ran recently and succeeded is ok', () => {
        const status = { lastRunAt: new Date(NOW).toISOString(), lastSuccessAt: new Date(NOW).toISOString(), consecutiveFailures: 0 };
        assert.equal(deriveStatus(scheduled, status, NOW), 'ok');
    });

    test('any consecutive failure outranks staleness', () => {
        const status = { lastRunAt: new Date(NOW).toISOString(), lastSuccessAt: new Date(NOW - 10 * DAY_MS).toISOString(), consecutiveFailures: 1 };
        assert.equal(deriveStatus(scheduled, status, NOW), 'error');
    });

    test('a scheduled source goes stale after STALE_FACTOR missed intervals', () => {
        const justInside = NOW - scheduled.intervalMs * STALE_FACTOR + MIN;
        const justPast   = NOW - scheduled.intervalMs * STALE_FACTOR - MIN;

        const at = ms => ({ lastRunAt: new Date(ms).toISOString(), lastSuccessAt: new Date(ms).toISOString(), consecutiveFailures: 0 });
        assert.equal(deriveStatus(scheduled, at(justInside), NOW), 'ok');
        assert.equal(deriveStatus(scheduled, at(justPast),   NOW), 'stale');
    });

    test('staleness measures the last SUCCESS, not the last attempt', () => {
        // Succeeded long ago, has been "running" since — but never succeeding.
        // consecutiveFailures is 0 here only because the runs were recorded ok:false
        // then reset; the point is that a fresh lastRunAt must not mask a stale success.
        const status = {
            lastRunAt:     new Date(NOW).toISOString(),
            lastSuccessAt: new Date(NOW - 10 * DAY_MS).toISOString(),
            consecutiveFailures: 0,
        };
        assert.equal(deriveStatus(scheduled, status, NOW), 'stale');
    });

    test('an on-demand source is never stale, however long since it ran', () => {
        const status = { lastRunAt: new Date(NOW - 365 * DAY_MS).toISOString(), lastSuccessAt: new Date(NOW - 365 * DAY_MS).toISOString(), consecutiveFailures: 0 };
        assert.equal(deriveStatus(onDemand, status, NOW), 'ok');
    });

    test('a never-run on-demand source is idle, not a problem', () => {
        assert.equal(deriveStatus(onDemand, null, NOW), 'idle');
    });

    test('a never-run scheduled source is flagged', () => {
        assert.equal(deriveStatus(scheduled, null, NOW), 'never');
    });

    test('an on-demand source still reports its errors', () => {
        const status = { lastRunAt: new Date(NOW).toISOString(), lastSuccessAt: null, consecutiveFailures: 2 };
        assert.equal(deriveStatus(onDemand, status, NOW), 'error');
    });
});

// ── getSummary ────────────────────────────────────────────────────────────────

describe('getSummary', () => {
    test('joins run health and disk usage onto every registry source', async () => {
        await recordRun({ id: 'hltb', ok: true, counts: { fetched: 5, created: 2 }, at: NOW - MIN });
        await writeFile('hltb/index.json', 2048);
        await scanAll({ now: NOW });

        const summary = await getSummary({ now: NOW });
        const hltb = rowFor(summary, 'hltb');

        assert.equal(hltb.label,      'HowLongToBeat');
        assert.equal(hltb.status,     'ok');
        assert.equal(hltb.fetched24h, 5);
        assert.equal(hltb.new24h,     2);
        assert.equal(hltb.new7d,      2);
        assert.equal(hltb.files,      1);
        assert.equal(hltb.bytes,      2048);
    });

    test('separates the 24h and 7d windows', async () => {
        await recordRun({ id: 'itad', ok: true, counts: { fetched: 3 }, at: NOW - 2 * DAY_MS });
        await recordRun({ id: 'itad', ok: true, counts: { fetched: 4 }, at: NOW - 2 * MIN });

        const itad = rowFor(await getSummary({ now: NOW }), 'itad');
        assert.equal(itad.fetched24h, 4);
        assert.equal(itad.fetched7d,  7);
    });

    // ── Novelty reporting ────────────────────────────────────────────────────

    test('a source without novelty reports null, not 0', async () => {
        // 0 would read as "it ran and found nothing new" — a claim we never measured.
        await recordRun({ id: 'pcgw', ok: true, counts: { fetched: 500 }, at: NOW - MIN });

        const pcgw = rowFor(await getSummary({ now: NOW }), 'pcgw');
        assert.equal(pcgw.novelty, false);
        assert.equal(pcgw.new24h,  null);
        assert.equal(pcgw.new7d,   null);
        assert.equal(pcgw.fetched24h, 500, 'pulled volume is still reported');
    });

    test('itad reports price changes as updates, separate from what it pulled', async () => {
        await recordRun({ id: 'itad', ok: true, counts: { fetched: 611, updated: 42 }, at: NOW - MIN });

        const itad = rowFor(await getSummary({ now: NOW }), 'itad');
        assert.equal(itad.novelty,    true);
        assert.equal(itad.new24h,     42);
        assert.equal(itad.fetched24h, 611);
    });

    test('new records sum created and updated', async () => {
        await recordRun({ id: 'steam:achievements', ok: true, counts: { created: 1, updated: 4 }, at: NOW - MIN });
        const row = rowFor(await getSummary({ now: NOW }), 'steam:achievements');
        assert.equal(row.new24h, 5);
    });

    test('a sampling source reports counts but is not charted', async () => {
        await recordRun({ id: 'steam:player-counts', ok: true, counts: { fetched: 2400 }, at: NOW - MIN });
        const row = rowFor(await getSummary({ now: NOW }), 'steam:player-counts');
        assert.equal(row.cadence,     'sampling');
        assert.equal(row.charted,     false);
        assert.equal(row.fetched24h,  2400, 'the table still shows what it pulled');
    });

    // ── Activity ─────────────────────────────────────────────────────────────

    test('reports run durations, newest last, for the activity sparkline', async () => {
        await recordRun({ id: 'hltb', ok: true, ms: 100, at: NOW - 3 * MIN });
        await recordRun({ id: 'hltb', ok: true, ms: 300, at: NOW - 2 * MIN });
        await recordRun({ id: 'hltb', ok: true, ms: 200, at: NOW - MIN });

        const hltb = rowFor(await getSummary({ now: NOW }), 'hltb');
        assert.deepEqual(hltb.durations, [100, 300, 200]);
        assert.equal(hltb.lastMs,   200);
        assert.equal(hltb.medianMs, 200);
    });

    test('caps the sparkline at the most recent runs', async () => {
        for (let i = 0; i < 30; i++) {
            await recordRun({ id: 'hltb', ok: true, ms: i, at: NOW - (30 - i) * MIN });
        }
        const hltb = rowFor(await getSummary({ now: NOW }), 'hltb');
        assert.equal(hltb.durations.length, 20);
        assert.equal(hltb.durations.at(-1), 29, 'keeps the newest, drops the oldest');
    });

    test('a source that has never run has no durations', async () => {
        const pcgw = rowFor(await getSummary({ now: NOW }), 'pcgw');
        assert.deepEqual(pcgw.durations, []);
        assert.equal(pcgw.lastMs,   null);
        assert.equal(pcgw.medianMs, null);
    });

    test('reports every registry source even when it has never run', async () => {
        const summary = await getSummary({ now: NOW });
        const pcgw = rowFor(summary, 'pcgw');
        assert.equal(pcgw.status,     'idle');
        assert.equal(pcgw.lastRunAt,  null);
        assert.equal(pcgw.fetched24h, 0);
    });

    test('surfaces the last error and the failure streak', async () => {
        await recordRun({ id: 'reddit', ok: false, error: new Error('403 blocked'), at: NOW - MIN });
        await recordRun({ id: 'reddit', ok: false, error: new Error('403 again'),   at: NOW });

        const reddit = rowFor(await getSummary({ now: NOW }), 'reddit');
        assert.equal(reddit.status,              'error');
        assert.equal(reddit.lastError,           '403 again');
        assert.equal(reddit.consecutiveFailures, 2);
    });

    test('reports unclaimed bytes rather than dropping them', async () => {
        await writeFile('steam/games.json',       10);
        await writeFile('steam/mystery-blob.bin', 90);
        await scanAll({ now: NOW });

        const summary = await getSummary({ now: NOW });
        assert.equal(summary.disk.unclaimed.files, 1);
        assert.equal(summary.disk.unclaimed.bytes, 90);
        assert.equal(summary.disk.totalBytes,     100);
    });

    test('reports a null scannedAt before the first disk scan', async () => {
        const summary = await getSummary({ now: NOW });
        assert.equal(summary.disk.scannedAt,  null);
        assert.equal(summary.disk.totalBytes, 0);
    });
});

// ── getTimeseries ─────────────────────────────────────────────────────────────

describe('getTimeseries', () => {
    test('collapses steam subsystems into one stacked series', async () => {
        await recordRun({ id: 'steam:images',  ok: true, counts: { created: 5 }, at: NOW });
        await recordRun({ id: 'steam:library', ok: true, counts: { created: 3 }, at: NOW });

        const { points } = await getTimeseries({ days: 1, now: NOW });
        assert.equal(points.at(-1).bySource.steam, 8);
    });

    test('plots new records, not records pulled', async () => {
        await recordRun({ id: 'steam:library', ok: true, counts: { fetched: 2000, created: 1 }, at: NOW });
        const { points } = await getTimeseries({ days: 1, now: NOW });
        assert.equal(points.at(-1).bySource.steam, 1);
    });

    test('sampling sources never reach the chart', async () => {
        await recordRun({ id: 'steam:player-counts', ok: true, counts: { fetched: 2400, created: 2400 }, at: NOW });
        const { series, points } = await getTimeseries({ days: 1, now: NOW });
        assert.deepEqual(series, []);
        assert.equal(points.at(-1).total, 0);
    });

    test('sources without novelty instrumentation never reach the chart', async () => {
        await recordRun({ id: 'pcgw', ok: true, counts: { fetched: 500 }, at: NOW });
        await recordRun({ id: 'sms',  ok: true, counts: { fetched: 4 },   at: NOW });
        const { series } = await getTimeseries({ days: 1, now: NOW });
        assert.deepEqual(series, []);
    });

    test('only reports series that actually have data', async () => {
        await recordRun({ id: 'hltb', ok: true, counts: { created: 1 }, at: NOW });
        const { series } = await getTimeseries({ days: 1, now: NOW });
        assert.deepEqual(series, ['hltb']);
    });

    test('emits an unbroken run of days so a gap means "nothing arrived"', async () => {
        await recordRun({ id: 'hltb', ok: true, counts: { created: 1 }, at: NOW });
        const { points } = await getTimeseries({ days: 5, now: NOW });

        assert.equal(points.length, 5);
        assert.deepEqual(points.map(p => p.day), [
            '2026-07-05', '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09',
        ]);
        assert.equal(points[0].total, 0);
    });

    test('chartSeriesOf keeps the frozen slot order and folds the tail', () => {
        // Order is load-bearing: it is the CVD-safety mechanism for touching
        // stacked segments, not cosmetic. Chosen to maximise the worst adjacent
        // pair (ΔE 26.3 dark / 16.2 light) — see the note in sources.js.
        assert.deepEqual(CHART_SERIES, ['steam', 'itad', 'mail', 'reddit', 'hltb', 'protondb']);

        assert.equal(chartSeriesOf('steam'), 'steam');
        assert.equal(chartSeriesOf('guides'), 'other');
    });
});

// ── Cadence + novelty classification ──────────────────────────────────────────

describe('isCharted', () => {
    test('an entity source that reports novelty is charted', () => {
        assert.equal(isCharted('hltb'), true);
        assert.equal(isCharted('reddit'), true);
        assert.equal(isCharted('mail'), true);
        assert.equal(isCharted('itad'), true);
        assert.equal(isCharted('protondb'), true);
    });

    test('sampling sources are never charted', () => {
        assert.equal(isCharted('steam:player-counts'), false);
        assert.equal(isCharted('steam:sessions'), false);
    });

    test('entity sources without novelty are not charted', () => {
        assert.equal(isCharted('pcgw'), false);
        assert.equal(isCharted('sms'), false);
        assert.equal(isCharted('guides'), false);
    });

    test('every charted top-level source has a reserved colour slot', () => {
        // A charted source outside CHART_SERIES would silently fold into the
        // grey "Other" segment instead of getting its own hue.
        const chartedTops = new Set(
            SOURCES.filter(s => isCharted(s.id)).map(s => s.source),
        );
        for (const top of chartedTops) {
            assert.ok(CHART_SERIES.includes(top), `${top} is charted but has no series slot`);
        }
    });

    test('an unknown id is not charted', () => {
        assert.equal(isCharted('nope'), false);
    });

    test('every sampling source is a scheduled source', () => {
        // A sampling source that no timer drives would be invisible everywhere:
        // excluded from the chart, and never raising a staleness warning.
        for (const s of SOURCES.filter(s => s.cadence === 'sampling')) {
            assert.equal(s.kind, 'scheduled', `${s.id} samples but nothing schedules it`);
        }
    });
});

// ── getRecentErrors ───────────────────────────────────────────────────────────

describe('getRecentErrors', () => {
    test('returns failures newest first with display labels attached', async () => {
        await recordRun({ id: 'itad',         ok: false, error: new Error('older'), at: NOW - 2 * MIN });
        await recordRun({ id: 'steam:images', ok: false, error: new Error('newer'), at: NOW - MIN });

        const errors = await getRecentErrors({ now: NOW });
        assert.equal(errors.length,   2);
        assert.equal(errors[0].error, 'newer');
        assert.equal(errors[0].label, 'Steam Images');
        assert.equal(errors[0].source, 'steam');
    });

    test('excludes successful runs', async () => {
        await recordRun({ id: 'hltb', ok: true, at: NOW });
        assert.deepEqual(await getRecentErrors({ now: NOW }), []);
    });
});
