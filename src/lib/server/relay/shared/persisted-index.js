// Fast-boot cache pattern (docs/relay-fold-in.md § boot redesign).
//
// Several features keep a large in-memory index that the relay (and the early
// fold-in) rebuilt on every boot by scanning thousands of per-entry JSON files
// off the NAS — 40-45s each, which saturated the event loop at startup and made
// early requests slow AND serve half-built (inaccurate) data.
//
// This wraps that scan so it persists its result to a single sidecar file. On
// boot the sidecar loads in ONE read (a few ms) and the feature serves
// last-known-good data immediately; a full rebuild then runs in the background
// and atomically swaps the fresh index in. First-ever boot (no sidecar) still
// does the slow scan once, then every boot after is fast.
//
// Safety: sidecar writes are atomic (tmp + rename); a missing or corrupt sidecar
// transparently falls back to a full rebuild, so a bad file can never serve
// garbage or wedge boot.

import fsp from 'node:fs/promises'
import path from 'node:path'
import logger from '../../logger.js'

/**
 * @param {object}   opts
 * @param {string}   opts.name     Feature label for logs.
 * @param {() => string} opts.file Absolute path of the sidecar (read at call time
 *                                 so it honors RELAY_DATA_ROOT). MUST live outside
 *                                 any directory the rebuild scan itself walks.
 * @param {() => Promise<any[]>} opts.rebuild  The slow scan — returns the index array.
 */
export function createPersistedIndex({ name, file, rebuild }) {
    let _index = null          // current in-memory index (array), or null before load
    let _builtAt = null        // ISO time the current index was produced
    let _refreshing = false    // coalesces concurrent refreshes
    let _loading = null        // shared promise for a concurrent sidecar load

    async function _loadSidecar() {
        try {
            const raw = JSON.parse(await fsp.readFile(file(), 'utf8'))
            if (!Array.isArray(raw?.index)) return false
            _index = raw.index
            _builtAt = raw.builtAt ?? null
            logger.info(`[${name}] index: loaded ${_index.length} entries from sidecar`, { builtAt: _builtAt })
            return true
        } catch (err) {
            if (err.code !== 'ENOENT') logger.warn(`[${name}] index: sidecar unreadable — will rebuild`, { err: err.message })
            return false
        }
    }

    async function _persist() {
        const f = file()
        const tmp = `${f}.tmp`
        try {
            await fsp.mkdir(path.dirname(f), { recursive: true })
            await fsp.writeFile(tmp, JSON.stringify({ builtAt: _builtAt, index: _index }))
            await fsp.rename(tmp, f)
        } catch (err) {
            logger.warn(`[${name}] index: persist failed`, { err: err.message })
        }
    }

    /** Full rebuild → swap in → persist. Concurrent calls share the in-flight run. */
    async function refresh() {
        if (_refreshing) return
        _refreshing = true
        const t0 = Date.now()
        try {
            const fresh = await rebuild()
            _index = Array.isArray(fresh) ? fresh : []
            _builtAt = new Date().toISOString()
            await _persist()
            logger.info(`[${name}] index: refreshed ${_index.length} entries`, { ms: Date.now() - t0 })
        } catch (err) {
            logger.error(`[${name}] index: refresh failed`, { err: err?.message ?? String(err) })
        } finally {
            _refreshing = false
        }
    }

    /**
     * Boot: fast sidecar load → serve now; kick the full rebuild off in the
     * background. Awaits only the (fast) sidecar read, so callers can await this
     * without paying the scan cost. First-ever boot (no sidecar) awaits the scan
     * once so reads aren't empty.
     */
    async function boot() {
        const hadSidecar = await _loadSidecar()
        if (hadSidecar) {
            refresh().catch(() => {})            // background — do not block boot
        } else {
            logger.info(`[${name}] index: no sidecar — building once (first boot)`)
            await refresh()
        }
    }

    /** Lazy guard for request paths that might run before boot() (dev, tests). */
    async function ensureLoaded() {
        if (_index !== null) return
        if (_loading) return _loading
        _loading = (async () => {
            if (!(await _loadSidecar())) await refresh()
        })().finally(() => { _loading = null })
        return _loading
    }

    return {
        boot,
        refresh,
        ensureLoaded,
        get: () => _index ?? [],
        meta: () => ({ builtAt: _builtAt, refreshing: _refreshing, count: _index?.length ?? 0 }),
    }
}
