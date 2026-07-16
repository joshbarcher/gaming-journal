/**
 * In-flight registry for manually triggered syncs.
 *
 * Several sources hit rate-limited external APIs with deliberate jitter between
 * requests (itad, protondb, pcgw, hltb).  Letting a manual trigger run
 * concurrently with the scheduled run of the same source would double the
 * request rate against a host that is already being paced on purpose — so an
 * overlapping trigger is rejected rather than queued.
 *
 * This module deliberately imports nothing.  The read-only dashboard service
 * needs to report which jobs are running, and importing the action registry to
 * find out would drag Puppeteer and every sync service into the request path.
 */

/** source id → { startedAt, done, total } */
const _running = new Map();

export function isRunning(id) {
    return _running.has(id);
}

/** Claim the slot for `id`. Returns false if a run is already in flight. */
export function begin(id) {
    if (_running.has(id)) return false;
    _running.set(id, { startedAt: Date.now(), done: 0, total: 0 });
    return true;
}

export function end(id) {
    _running.delete(id);
}

/**
 * Report progress for an in-flight run.  Nine sync functions already take an
 * `onProgress(done, total)` callback; actions.js wires them to this so the row
 * can render a determinate meter instead of an indeterminate pulse.
 *
 * A no-op once the run has ended, so a late callback from a settling sync
 * cannot resurrect a finished job.
 */
export function setProgress(id, done, total) {
    const entry = _running.get(id);
    if (!entry) return;
    entry.done = done;
    entry.total = total;
}

/** { done, total } for an in-flight run, or null. `total` 0 means indeterminate. */
export function getProgress(id) {
    const entry = _running.get(id);
    if (!entry || !entry.total) return null;
    return { done: entry.done, total: entry.total };
}

/** Source ids currently running, for the dashboard's per-row spinner. */
export function listRunning() {
    return [..._running.keys()];
}

/** How long the in-flight run for `id` has been going, or null. */
export function runningSince(id) {
    const entry = _running.get(id);
    return entry ? new Date(entry.startedAt).toISOString() : null;
}

/** Test helper — drop all claims. */
export function _reset() {
    _running.clear();
}
