/**
 * Persisted history of every sync run, so the dashboard can answer:
 *   - is this source still pulling new records?
 *   - when did it last succeed?
 *   - what broke, and how many times in a row?
 *
 * Runs are appended to a monthly bucket via ManagedFile, whose max-interval
 * scheduler batches rapid updates into one atomic write per flush window.  The
 * 30-minute snapshot tick fires six subsystems at once; without batching that
 * would be six separate writes to a network share.  Nothing here writes to the
 * NAS synchronously or per-event.
 */

import path from 'node:path';
import fsp from 'node:fs/promises';
import logger from '../../logger.js';
import { ManagedFile } from '../shared/managed-file.js';
import { featureDir } from '../shared/data-root.js';
import { isKnownSource, topLevelOf, isCharted } from './sources.js';

const FLUSH_INTERVAL_MS = 60_000;
const RETAIN_MONTHS     = 3;

function metricsDir() {
    // TRANSITIONAL (docs/relay-fold-in.md § cutover): the RELAY still owns
    // $RELAY_DATA_ROOT/metrics/runs-<month>.json for its remaining features, and
    // ManagedFile batches whole-file writes — two processes on one bucket file
    // would silently drop each other's runs. Journal-recorded runs therefore
    // live in a sibling dir with identical format. At decommission the two dirs
    // merge and this returns to featureDir('metrics').
    return path.join(featureDir('metrics'), 'journal');
}

/** 'YYYY-MM' for a millisecond timestamp, in UTC. */
export function monthKey(ms) {
    return new Date(ms).toISOString().slice(0, 7);
}

/**
 * Every month key in [fromMs, toMs], inclusive.  Stepping by day-of-month is
 * wrong (Jul 31 minus one month is not June), so step the UTC month field of a
 * date anchored to the 1st.
 */
export function monthRange(fromMs, toMs) {
    const end    = new Date(Date.UTC(new Date(toMs).getUTCFullYear(), new Date(toMs).getUTCMonth(), 1));
    const cursor = new Date(Date.UTC(new Date(fromMs).getUTCFullYear(), new Date(fromMs).getUTCMonth(), 1));
    const out = [];
    while (cursor <= end) {
        out.push(monthKey(cursor.getTime()));
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return out;
}

/** 'YYYY-MM-DD' for a millisecond timestamp, in UTC. */
export function dayKey(ms) {
    return new Date(ms).toISOString().slice(0, 10);
}

/** Start of the oldest month we still keep on disk. */
function retentionFloorMs(now = Date.now()) {
    const d = new Date(now);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - RETAIN_MONTHS, 1);
}

// ── Monthly bucket files ──────────────────────────────────────────────────────

/** month key → ManagedFile.  Kept open so appends stay in memory between flushes. */
const _files = new Map();

function makeFile(month) {
    return new ManagedFile({
        filePath:           path.join(metricsDir(), `runs-${month}.json`),
        name:               `metrics-runs-${month}`,
        defaultValue:       () => ({ month, runs: [] }),
        maxFlushIntervalMs: FLUSH_INTERVAL_MS,
        log:                (level, msg, meta) => logger[level]?.(`[metrics] ${msg}`, meta),
        // Runs are append-only within a month; a shrinking array means data loss.
        // Retention prunes whole month files, never individual runs, so this
        // invariant holds for the life of the bucket.
        auditMetrics: value => ({ count: value.runs.length }),
        audit: (prev, next) => next.runs.length >= prev.count
            ? { ok: true }
            : { ok: false, reason: `run count shrank ${prev.count} → ${next.runs.length}` },
    });
}

async function bucket(month) {
    let file = _files.get(month);
    if (!file) {
        file = makeFile(month);
        _files.set(month, file);
        await file.load();
    }
    return file;
}

// ── Status index ──────────────────────────────────────────────────────────────

/** source id → { lastRunAt, lastSuccessAt, lastError, consecutiveFailures, ok } */
const _status = new Map();

function applyToStatus(run) {
    const prev = _status.get(run.id) ?? {
        lastRunAt: null, lastSuccessAt: null, lastError: null, consecutiveFailures: 0, ok: null,
    };
    _status.set(run.id, {
        lastRunAt:           run.at,
        lastSuccessAt:       run.ok ? run.at    : prev.lastSuccessAt,
        lastError:           run.ok ? null      : run.error,
        consecutiveFailures: run.ok ? 0         : prev.consecutiveFailures + 1,
        ok:                  run.ok,
    });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Load the current month's bucket and rebuild the in-memory status index from
 * the current and previous month.  Call once at startup, before recordRun().
 */
export async function load(now = Date.now()) {
    const months = [monthKey(now - 31 * 86_400_000), monthKey(now)];
    _status.clear();

    for (const month of [...new Set(months)]) {
        const file = await bucket(month);
        for (const run of file.get().runs) applyToStatus(run);
    }

    await pruneOldBuckets(now);
    logger.info('[metrics] Loaded', { sources: _status.size });
}

/**
 * Record one completed sync run.  Returns the stored record.
 *
 * `counts` fields are optional — a source that cannot distinguish fetched from
 * skipped may report only `fetched`.  Missing counts are stored as 0 rather
 * than null so the chart never has to special-case them.
 */
export async function recordRun({ id, ok, ms = 0, counts = {}, error = null, at = Date.now() }) {
    if (!isKnownSource(id)) throw new Error(`[metrics] unknown source id: ${id}`);

    const run = {
        id,
        at:      new Date(at).toISOString(),
        ok:      Boolean(ok),
        ms:      Math.round(ms),
        // `fetched` is what came over the wire; `created` + `updated` is how much
        // of it was actually new information. A library sync fetches 2,000 games
        // and creates none of them.
        fetched: counts.fetched ?? 0,
        created: counts.created ?? 0,
        updated: counts.updated ?? 0,
        skipped: counts.skipped ?? 0,
        failed:  counts.failed  ?? 0,
        total:   counts.total   ?? 0,
        error:   ok ? null : (error?.message ?? String(error ?? 'unknown error')),
    };

    const file = await bucket(monthKey(at));
    const cur  = file.get();
    // ManagedFile audits prev-vs-next, so hand it a new object rather than
    // mutating the array it already holds.
    await file.set({ ...cur, runs: [...cur.runs, run] });

    applyToStatus(run);
    return run;
}

/**
 * All runs at or after `sinceMs`, oldest first, optionally filtered by source id.
 * `sinceMs` is clamped to the retention window — asking for more history than we
 * keep should read the buckets that exist, not open one ManagedFile per month
 * back to the epoch.
 */
export async function getRuns({ sinceMs = 0, id = null, now = Date.now() } = {}) {
    const from = Math.max(sinceMs, retentionFloorMs(now));
    const out  = [];

    for (const month of monthRange(from, now)) {
        const file = await bucket(month);
        for (const run of file.get().runs) {
            if (Date.parse(run.at) < from) continue;
            if (id && run.id !== id) continue;
            out.push(run);
        }
    }
    return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** Derived per-source health.  Synchronous — reads the in-memory index only. */
export function getSourceStatus(id = null) {
    if (id) return _status.get(id) ?? null;
    return Object.fromEntries(_status);
}

/** The most recent failed runs, newest first. */
export async function getErrors({ limit = 50, now = Date.now(), sinceMs = now - 30 * 86_400_000 } = {}) {
    const runs = await getRuns({ sinceMs, now });
    return runs.filter(r => !r.ok).reverse().slice(0, limit);
}

/** New information from one run: records created plus records changed. */
export function novelRecords(run) {
    return (run.created ?? 0) + (run.updated ?? 0);
}

/**
 * Daily new-record counts bucketed by TOP-LEVEL source, for the stacked bar chart.
 *
 * Only charted sources contribute (see isCharted): sampling sources like
 * player-counts are excluded because every observation is new by construction,
 * and sources that do not yet report novelty are excluded because a fabricated
 * 0 would read as "ran but found nothing".
 *
 * Days with no runs are emitted as empty buckets so the x-axis has no holes —
 * a gap in the chart should mean "nothing arrived", which is the signal we want.
 */
export async function getDailyTotals({ days = 14, now = Date.now() } = {}) {
    const startMs = Date.parse(`${dayKey(now - (days - 1) * 86_400_000)}T00:00:00.000Z`);
    const runs    = await getRuns({ sinceMs: startMs, now });

    const byDay = new Map();
    for (let i = 0; i < days; i++) {
        byDay.set(dayKey(startMs + i * 86_400_000), {});
    }

    for (const run of runs) {
        if (!isCharted(run.id)) continue;
        const bucketForDay = byDay.get(dayKey(Date.parse(run.at)));
        if (!bucketForDay) continue;
        const source = topLevelOf(run.id);
        bucketForDay[source] = (bucketForDay[source] ?? 0) + novelRecords(run);
    }

    return [...byDay].map(([day, bySource]) => ({
        day,
        bySource,
        total: Object.values(bySource).reduce((a, b) => a + b, 0),
    }));
}

/** Delete month buckets older than RETAIN_MONTHS.  Whole files only. */
export async function pruneOldBuckets(now = Date.now()) {
    const cutoff = monthKey(retentionFloorMs(now));
    let entries;
    try {
        entries = await fsp.readdir(metricsDir());
    } catch {
        return 0;
    }

    let pruned = 0;
    for (const entry of entries) {
        const match = entry.match(/^runs-(\d{4}-\d{2})\.json$/);
        if (!match || match[1] >= cutoff) continue;
        await fsp.unlink(path.join(metricsDir(), entry)).catch(() => {});
        _files.delete(match[1]);
        pruned++;
    }
    if (pruned) logger.info('[metrics] Pruned old buckets', { pruned, cutoff });
    return pruned;
}

/** Flush all open buckets and drop them.  Call on shutdown, and in tests. */
export async function close() {
    await Promise.all([..._files.values()].map(f => f.close()));
    _files.clear();
    _status.clear();
}
