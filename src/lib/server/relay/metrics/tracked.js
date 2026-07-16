/**
 * Instrumentation wrapper for sync entrypoints.
 *
 *   await tracked('protondb', () => syncAll());
 *
 * Times the call, normalises whatever counts the sync function returns, and
 * records one run against the source.  The wrapped function's return value is
 * passed through untouched, and a thrown error is re-thrown after recording, so
 * dropping `tracked()` around an existing call never changes its behaviour.
 *
 * TELEMETRY MUST NEVER BREAK A DATA PULL.  Every failure inside this module —
 * an unknown source id, a NAS write error — is logged and swallowed.  A broken
 * dashboard is an annoyance; a sync that stops running because its bookkeeping
 * threw is a data-loss bug.
 *
 * PARTIAL FAILURE.  Several sync functions catch their own per-item errors and
 * resolve successfully having done nothing (mail's incrementalSync swallows a
 * per-account throw, for example).  Those report failure by returning an
 * `error` field alongside their counts; a run with `error` set is recorded as
 * ok: false without throwing.
 */

import logger from '../../logger.js';
import { recordRun } from './sync-metrics.service.js';

/**
 * Map a sync function's return value onto
 * { fetched, created, updated, skipped, failed, total }.
 *
 * The services predate this module and each named their counters differently.
 * Rather than rewrite eleven call sites to a common vocabulary, the aliases are
 * collected here.
 *
 *   fetched — records that came over the wire, new or not.
 *   created — records that did not exist before.
 *   updated — existing records whose stored content changed.
 *   skipped — we looked and there was nothing to do.
 *
 * The chart plots created + updated ("new information"), not fetched: a library
 * sync fetches 2,000 games every day and creates none of them.  A source that
 * does not report created/updated leaves them at 0 and is excluded from the
 * chart by its registry `novelty` flag, so the zeros never masquerade as data.
 */
const ZERO = { fetched: 0, created: 0, updated: 0, skipped: 0, failed: 0, total: 0 };

export function toCounts(result) {
    if (!result || typeof result !== 'object') return { ...ZERO };

    const fetched = result.fetched    ?? result.downloaded ?? result.synced ?? result.added ?? 0;
    // `downloaded` (a file that was not on disk) and `added` (a review or message
    // we had not seen) already mean "this record is new", so they count as
    // created as well as fetched.
    const created = result.created    ?? result.newCount   ?? result.downloaded ?? result.added ?? 0;
    const updated = result.updated    ?? result.changed    ?? 0;
    const failed  = result.failed     ?? result.broken     ?? 0;
    const skipped = (result.skipped   ?? 0)
                  + (result.notFound  ?? 0)
                  + (result.noMatch   ?? 0)
                  + (result.noData    ?? 0)
                  + (result.noPage    ?? 0)
                  + (result.missing   ?? 0);

    return {
        fetched,
        created,
        updated,
        skipped,
        failed,
        total: result.total ?? (fetched + skipped + failed),
        ...(result.error ? { error: result.error } : {}),
    };
}

/** Record a run without letting a telemetry failure escape into the caller. */
async function safeRecord(entry) {
    try {
        await recordRun(entry);
    } catch (err) {
        logger.error('[metrics] Failed to record run', { id: entry.id, err: err.message });
    }
}

/**
 * Run `fn`, record the outcome against source `id`, and pass through its result.
 *
 * @param {string} id  A source id from sources.js, e.g. 'steam:images'.
 * @param {() => Promise<any>} fn  The sync entrypoint to invoke.
 * @param {(result: any) => object} [mapCounts]
 *        Derives counts from the result when the default aliases can't.  Needed
 *        by the TTL-guarded steam syncs, which return the same cache object
 *        whether they hit the API or short-circuited on a fresh cache — without
 *        a mapper, a 24h-TTL library sync would report its full game count on
 *        all 48 of the day's ticks instead of the one that actually fetched.
 *        Its output is fed through toCounts(), so returning a partial
 *        `{ fetched }` is fine.
 */
export async function tracked(id, fn, mapCounts = null) {
    const t0 = Date.now();
    let result;
    try {
        result = await fn();
    } catch (err) {
        await safeRecord({ id, ok: false, ms: Date.now() - t0, error: err });
        throw err;
    }

    const counts = toCounts(mapCounts ? mapCounts(result) : result);
    await safeRecord({
        id,
        ok:     !counts.error,
        ms:     Date.now() - t0,
        counts,
        error:  counts.error ?? null,
    });
    return result;
}
