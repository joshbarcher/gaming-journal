/**
 * Per-source NAS footprint, computed by a nightly background scan.
 *
 * A full walk of $DATA_DIR/relay is ~246k files and ~550 GB across SMB.  Sizes
 * require a stat() per file (readdir's Dirent carries no size), which measures
 * at roughly 0.8 ms/file over the share — so a full scan runs about 3 minutes.
 * It must never run on a request path.  The API serves the cached result and
 * reports `scannedAt` so a stale number is visible as stale rather than passed
 * off as current.
 *
 * Top-level directories are walked one at a time.  Eleven concurrent recursive
 * walks over a network share is slower than doing them in sequence, not faster.
 */

import path from 'node:path';
import fsp from 'node:fs/promises';
import logger from '../../logger.js';
import { ManagedFile } from '../shared/managed-file.js';
import { mapChunked } from '../shared/map-chunked.js';
import { relayDataRoot } from '../shared/data-root.js';
import { TOP_LEVEL_SOURCES, attribute, otherId } from './sources.js';

const TICK_MS      = 30 * 60 * 1_000;   // how often we check whether it's time
const MIN_AGE_MS   = 20 * 60 * 60 * 1_000;  // never rescan twice in one night
// Guards against EMFILE on the share.  Benchmarked 20/64/128/256 in flight
// against the live NAS: once the SMB cache is warm the differences are inside
// the noise, so this stays at the shared default rather than growing a
// bespoke worker pool for no measured gain.
const STAT_CONCURRENCY = 20;

function scanHour() {
    return Number(process.env.DISK_SCAN_HOUR ?? 3);
}

function relayDir() {
    return relayDataRoot();
}

let _file = null;

/** True while a scan is walking the share — guards scanAll() against overlap. */
let _running = false;

/** { done, total } top-level directories walked, for the UI's progress meter. */
let _progress = null;

async function cacheFile() {
    if (!_file) {
        _file = new ManagedFile({
            filePath:     path.join(relayDir(), 'metrics', 'disk-usage.json'),
            name:         'metrics-disk-usage',
            defaultValue: () => ({ scannedAt: null, scanMs: 0, sources: {} }),
            maxFlushIntervalMs: 5_000,
            log: (level, msg, meta) => logger[level]?.(`[disk-usage] ${msg}`, meta),
        });
        await _file.load();
    }
    return _file;
}

// ── Walking ───────────────────────────────────────────────────────────────────

/**
 * Recursively collect every file under `dir` as a path relative to relay/.
 * Uses POSIX separators so prefix matching in sources.js is platform-agnostic —
 * DATA_DIR is a UNC share on Windows and a mount elsewhere.
 */
async function collectFiles(absDir, relDir, out) {
    let entries;
    try {
        entries = await fsp.readdir(absDir, { withFileTypes: true });
    } catch (err) {
        // A source directory that does not exist yet is normal, not a problem —
        // warning about it once per source per night is pure noise. Anything
        // else (permissions, an unreachable share) is worth surfacing.
        if (err.code === 'ENOENT') return out;
        logger.warn('[disk-usage] Unreadable directory', { dir: relDir, err: err.message });
        return out;
    }

    for (const entry of entries) {
        const abs = path.join(absDir, entry.name);
        const rel = `${relDir}/${entry.name}`;
        if (entry.isDirectory())   await collectFiles(abs, rel, out);
        else if (entry.isFile())   out.push({ abs, rel });
    }
    return out;
}

/**
 * Scan one top-level source directory.
 * Returns { [sourceId]: { files, bytes } }, including a `<source>:other` bucket
 * for anything the registry does not claim, so the totals reconcile with reality.
 *
 * @param {(done: number, total: number) => void} [onFiles]
 *        Called as files are stat'ed. `steam` alone is 100k of the 246k files,
 *        so a caller that only learns about whole directories cannot draw an
 *        honest progress bar.
 */
export async function scanSource(source, onFiles) {
    const absDir = path.join(relayDir(), source);
    const files  = await collectFiles(absDir, source, []);

    let done = 0;
    onFiles?.(0, files.length);

    const sizes = await mapChunked(
        files,
        async ({ abs, rel }) => {
            try {
                const stat = await fsp.stat(abs);
                return { rel, bytes: stat.size };
            } catch {
                return null;   // vanished mid-scan; not worth failing the run
            } finally {
                onFiles?.(++done, files.length);
            }
        },
        STAT_CONCURRENCY,
    );

    const totals = {};
    for (const entry of sizes) {
        if (!entry) continue;
        const id = attribute(entry.rel);
        const bucket = totals[id] ??= { files: 0, bytes: 0 };
        bucket.files += 1;
        bucket.bytes += entry.bytes;
    }

    // Emit an empty `other` bucket so callers can tell "nothing unclaimed" from
    // "never scanned".
    totals[otherId(source)] ??= { files: 0, bytes: 0 };
    return totals;
}

/**
 * Walk every top-level source in sequence and replace the cache.
 *
 * The in-flight guard lives here rather than in the scheduler so a manual
 * rescan cannot overlap the nightly one — two concurrent walks of 246k files
 * over SMB would take longer than running them back to back, and the second to
 * finish would clobber the first's cache write.  Throws on overlap; callers
 * that want a soft answer check isScanning() first.
 */
export async function scanAll({ now = Date.now() } = {}) {
    if (_running) throw new Error('Disk usage scan already in progress');
    _running = true;

    // Weight each directory by how many files it held last time, so the bar
    // tracks work rather than directory count: steam and guides are ~70% of the
    // 246k files, and an unweighted 12-step bar sits at 0% for over a minute.
    // With no previous scan, weight every directory equally.
    const weights = await _sourceWeights();
    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);

    let doneWeight = 0;
    _progress = { done: 0, total: totalWeight, source: TOP_LEVEL_SOURCES[0], files: 0, fileTotal: 0 };

    const startedAt = Date.now();
    const sources   = {};

    try {
        for (const source of TOP_LEVEL_SOURCES) {
            const sourceStart = Date.now();
            const weight = weights[source] ?? 0;

            // Mutate rather than reallocate — this fires once per file, 246k times.
            const totals = await scanSource(source, (files, fileTotal) => {
                const fraction = fileTotal > 0 ? files / fileTotal : 1;
                _progress.done      = doneWeight + weight * fraction;
                _progress.source    = source;
                _progress.files     = files;
                _progress.fileTotal = fileTotal;
            });

            Object.assign(sources, totals);
            doneWeight += weight;
            logger.info('[disk-usage] Scanned source', { source, ms: Date.now() - sourceStart });
        }

        const scanMs = Date.now() - startedAt;
        const result = { scannedAt: new Date(now).toISOString(), scanMs, sources };

        const file = await cacheFile();
        await file.set(result);
        await file.flush();

        const totalBytes = Object.values(sources).reduce((a, b) => a + b.bytes, 0);
        const totalFiles = Object.values(sources).reduce((a, b) => a + b.files, 0);
        logger.info('[disk-usage] Scan complete', { scanMs, totalFiles, totalBytes });
        return result;
    } finally {
        _running  = false;
        _progress = null;
    }
}

/**
 * Per-top-level-directory file counts from the last scan, used to weight the
 * progress bar. Falls back to equal weights when nothing has been scanned yet.
 */
export async function _sourceWeights() {
    const { sources } = await getUsage();
    const weights = Object.fromEntries(TOP_LEVEL_SOURCES.map(s => [s, 0]));

    for (const [id, { files }] of Object.entries(sources ?? {})) {
        const top = id.split(':')[0];
        if (top in weights) weights[top] += files;
    }

    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    if (total > 0) return weights;

    // Never scanned: every directory counts the same. The bar will be lumpy on
    // the first run and accurate on every run after it.
    return Object.fromEntries(TOP_LEVEL_SOURCES.map(s => [s, 1]));
}

/**
 * Live scan progress, or null when idle.
 * `done`/`total` are file-weighted; `source`, `files`, `fileTotal` describe the
 * directory currently being walked.
 */
export function getScanProgress() {
    return _progress ? { ..._progress } : null;
}

// ── Read ──────────────────────────────────────────────────────────────────────

/** The cached scan.  `scannedAt` is null if a scan has never completed. */
export async function getUsage() {
    const file = await cacheFile();
    return file.get();
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let _timer = null;

/**
 * Fire a scan when the local hour matches DISK_SCAN_HOUR and the last scan is
 * older than MIN_AGE_MS.  A wall-clock check on a 30-minute tick beats a plain
 * setInterval-from-boot: it survives restarts without rescanning, and it keeps
 * the walk off-peak instead of drifting into the middle of the day.
 */
async function _tick() {
    if (_running) return;   // a manual rescan is already walking the share
    if (new Date().getHours() !== scanHour()) return;

    const { scannedAt } = await getUsage();
    if (scannedAt && Date.now() - Date.parse(scannedAt) < MIN_AGE_MS) return;

    try {
        await scanAll();    // claims and releases the guard itself
    } catch (err) {
        logger.error('[disk-usage] Scheduled scan failed', err);
    }
}

export function startDiskUsageScheduler() {
    logger.info('[disk-usage] Scheduler started', { scanHour: scanHour(), tickMs: TICK_MS });
    _timer = setInterval(() => { _tick().catch(err => logger.error('[disk-usage] Tick failed', err)); }, TICK_MS);
    _timer.unref?.();
}

export function stopDiskUsageScheduler() {
    if (_timer) clearInterval(_timer);
    _timer = null;
}

/** True while a scan is in flight — Phase 4 uses this to reject overlapping triggers. */
export function isScanning() {
    return _running;
}

/**
 * Flush and release the cache file.  Call on shutdown, and in tests.
 *
 * The handle is dropped even when the final flush fails — otherwise a cache
 * file left dirty by a failed write (an unreachable NAS, say) would make every
 * later close() throw again on the same doomed flush, and the handle could
 * never be replaced.
 */
export async function close() {
    stopDiskUsageScheduler();
    const file = _file;
    _file = null;
    if (file) await file.close();
}
