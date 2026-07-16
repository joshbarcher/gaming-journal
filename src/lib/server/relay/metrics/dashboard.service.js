// Ported verbatim from relay-server src/services/metrics/dashboard.service.js
// (docs/relay-fold-in.md §6 — logic byte-identical; all imports already local:
// sources / sync-metrics / disk-usage / job-guard ported in Phase 1).
/**
 * Read-only join of the three metrics stores into the shapes the dashboard
 * renders: per-source status rows, the stacked-bar timeseries, and recent errors.
 *
 * Nothing here scans the NAS or calls a sync — it reads the run history from
 * memory and the disk-usage cache from its file.  Every endpoint served from
 * this module is safe to poll.
 */

import { SOURCES, STALE_FACTOR, chartSeriesOf, topLevelOf, isCharted } from './sources.js';
import { getSourceStatus, getRuns, getErrors, getDailyTotals, novelRecords } from './sync-metrics.service.js';
import { getUsage, isScanning, getScanProgress } from './disk-usage.service.js';
// job-guard imports nothing, so reading in-flight state here does not drag the
// action registry (and Puppeteer, via pcgw) onto the request path.
import { isRunning, runningSince, getProgress } from './job-guard.js';

const DAY_MS = 86_400_000;

/**
 * Classify a source for the status column.
 *
 * 'on-demand' sources are never 'stale'.  A guides fetch you last triggered
 * three weeks ago is not broken, and a dashboard that cries wolf about it
 * trains you to ignore the column that matters.
 */
export function deriveStatus(source, status, now = Date.now()) {
    if (!status?.lastRunAt) return source.kind === 'on-demand' ? 'idle' : 'never';
    if (status.consecutiveFailures > 0) return 'error';

    if (source.kind === 'scheduled' && source.intervalMs) {
        const age = now - Date.parse(status.lastSuccessAt ?? 0);
        if (age > source.intervalMs * STALE_FACTOR) return 'stale';
    }
    return 'ok';
}

/** Sum a counter across runs for one source id since `sinceMs`. */
function sumSince(runs, id, sinceMs, pick) {
    return runs.reduce(
        (acc, r) => (r.id === id && Date.parse(r.at) >= sinceMs ? acc + pick(r) : acc),
        0,
    );
}

/** Durations of the most recent runs, oldest first — the row's activity sparkline. */
const SPARK_RUNS = 20;

function durationsFor(runs, id) {
    return runs.filter(r => r.id === id).slice(-SPARK_RUNS).map(r => r.ms);
}

function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Per-source rows for the table: registry metadata + run health + NAS footprint.
 */
export async function getSummary({ now = Date.now() } = {}) {
    const [usage, runs] = await Promise.all([
        getUsage(),
        getRuns({ sinceMs: now - 7 * DAY_MS, now }),
    ]);

    const statuses = getSourceStatus();

    const sources = SOURCES.map(source => {
        const status    = statuses[source.id] ?? null;
        const disk      = usage.sources?.[source.id] ?? { files: 0, bytes: 0 };
        const durations = durationsFor(runs, source.id);

        return {
            id:       source.id,
            label:    source.label,
            source:   source.source,
            kind:     source.kind,
            status:   deriveStatus(source, status, now),

            syncable:     Boolean(source.syncable),
            running:      isRunning(source.id),
            runningSince: runningSince(source.id),
            progress:     getProgress(source.id),

            cadence: source.cadence ?? 'entity',
            // null, not 0 — "we never measured" must not render as "found nothing".
            novelty: Boolean(source.novelty),
            charted: isCharted(source.id),

            lastRunAt:           status?.lastRunAt     ?? null,
            lastSuccessAt:       status?.lastSuccessAt ?? null,
            lastError:           status?.lastError     ?? null,
            consecutiveFailures: status?.consecutiveFailures ?? 0,

            fetched24h: sumSince(runs, source.id, now - DAY_MS,     r => r.fetched),
            fetched7d:  sumSince(runs, source.id, now - 7 * DAY_MS, r => r.fetched),

            new24h: source.novelty ? sumSince(runs, source.id, now - DAY_MS,     novelRecords) : null,
            new7d:  source.novelty ? sumSince(runs, source.id, now - 7 * DAY_MS, novelRecords) : null,

            // Activity: how long its runs take, and their recent shape.
            durations: durations,
            lastMs:    durations.at(-1) ?? null,
            medianMs:  median(durations),

            files: disk.files,
            bytes: disk.bytes,
        };
    });

    // Bytes the registry did not claim, surfaced rather than silently dropped.
    const unclaimed = Object.entries(usage.sources ?? {})
        .filter(([id]) => id.endsWith(':other'))
        .reduce((acc, [, v]) => ({ files: acc.files + v.files, bytes: acc.bytes + v.bytes }), { files: 0, bytes: 0 });

    return {
        generatedAt: new Date(now).toISOString(),
        disk: {
            scannedAt: usage.scannedAt,
            scanMs:    usage.scanMs,
            scanning:  isScanning(),
            progress:  getScanProgress(),
            unclaimed,
            totalBytes: Object.values(usage.sources ?? {}).reduce((a, b) => a + b.bytes, 0),
            totalFiles: Object.values(usage.sources ?? {}).reduce((a, b) => a + b.files, 0),
        },
        sources,
    };
}

/**
 * Daily stacked-bar data, folded onto the frozen chart series.
 *
 * getDailyTotals() buckets by top-level source; anything outside CHART_SERIES
 * collapses into 'other' here rather than minting a 9th categorical hue.
 */
export async function getTimeseries({ days = 14, now = Date.now() } = {}) {
    const daily = await getDailyTotals({ days, now });

    const series = new Set();
    const points = daily.map(({ day, bySource }) => {
        const folded = {};
        for (const [source, count] of Object.entries(bySource)) {
            const key = chartSeriesOf(source);
            folded[key] = (folded[key] ?? 0) + count;
        }
        for (const key of Object.keys(folded)) series.add(key);
        return { day, bySource: folded, total: Object.values(folded).reduce((a, b) => a + b, 0) };
    });

    return { days, series: [...series], points };
}

/** Recent failures, newest first, annotated with the source's display label. */
export async function getRecentErrors({ limit = 25, now = Date.now() } = {}) {
    const errors = await getErrors({ limit, now });
    const labels = new Map(SOURCES.map(s => [s.id, s.label]));

    return errors.map(run => ({
        id:     run.id,
        label:  labels.get(run.id) ?? run.id,
        source: topLevelOf(run.id),
        at:     run.at,
        ms:     run.ms,
        error:  run.error,
    }));
}
