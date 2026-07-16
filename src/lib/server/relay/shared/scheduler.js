// Scheduler harness for relay-era background jobs (pollers, sync schedulers).
//
// Rules (docs/relay-fold-in.md § Phase 1):
// - Nothing starts unless ENABLE_SCHEDULERS=true — set only in the prod env
//   layer (same precedent as communities' SCRAPE_ENABLED). Dev machines read
//   the NAS but never run background syncs against it.
// - Per-feature kill switch: SCHED_<NAME>=off (e.g. SCHED_ITAD=off) skips one
//   scheduler without touching the rest — used for cutover rollback.
// - Idempotent across vite SSR module reloads: the started-set lives on
//   globalThis, so an HMR re-import can never double-start a poller.
// - Every feature registers a close fn for graceful shutdown (browser close,
//   ManagedFile flush) — drained by closeAll() from hooks.server.ts.

import logger from '../../logger.js'

const REGISTRY_KEY = Symbol.for('gaming-journal.relay.schedulers')

function registry() {
    if (!globalThis[REGISTRY_KEY]) {
        globalThis[REGISTRY_KEY] = { started: new Set(), closers: new Map() }
    }
    return globalThis[REGISTRY_KEY]
}

export function schedulersEnabled() {
    return process.env.ENABLE_SCHEDULERS === 'true'
}

function featureEnabled(name) {
    return process.env[`SCHED_${name.toUpperCase().replace(/-/g, '_')}`] !== 'off'
}

/**
 * Start a named scheduler exactly once per process, if scheduling is enabled.
 * `startFn` may be sync or async; async failures are logged, never thrown —
 * one broken scheduler must not take down the app (relay server.js behavior).
 * Returns true if the scheduler was started by this call.
 */
export function startScheduler(name, startFn) {
    const reg = registry()
    if (reg.started.has(name)) return false
    if (!schedulersEnabled()) { logger.info(`[sched] ${name} skipped — schedulers disabled`); return false }
    if (!featureEnabled(name)) { logger.warn(`[sched] ${name} skipped — SCHED flag off`); return false }
    reg.started.add(name)
    Promise.resolve()
        .then(startFn)
        .catch(err => logger.error(`[sched] ${name} startup failed`, { err: err?.message ?? String(err) }))
    logger.info(`[sched] ${name} started`)
    return true
}

/**
 * Register a graceful-shutdown closer (flush buffers, close browsers).
 * Last registration wins for a given name (HMR re-registration is fine).
 */
export function registerCloser(name, closeFn) {
    registry().closers.set(name, closeFn)
}

/** Run all registered closers; errors logged, never thrown. */
export async function closeAll() {
    const reg = registry()
    await Promise.allSettled(
        [...reg.closers.entries()].map(([name, fn]) =>
            Promise.resolve()
                .then(fn)
                .catch(err => logger.error(`[sched] close ${name} failed`, { err: err?.message ?? String(err) }))
        )
    )
}

/** Introspection for tests and the metrics dashboard. */
export function startedSchedulers() {
    return [...registry().started]
}
