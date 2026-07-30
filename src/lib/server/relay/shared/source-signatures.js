// Delta-rebuild support for the persisted indexes (shared/persisted-index.js).
//
// Those indexes are derived from thousands of per-entry JSON files on the NAS, and
// each refresh re-read every one of them to pick up a handful of changes. Measured
// against the NAS for the games index: 12,939 files / 50 MB / 54.6s. readdir + stat
// over the same entries takes 363ms, because CIFS returns file attributes with the
// directory listing. So a refresh can stat the sources, compare each entry's mtime
// signature against a persisted baseline, and re-derive only what moved.
//
// This module owns the reusable half of that: scanning signatures, and persisting /
// loading the baseline. Deciding what "changed" means for a given feature — and what
// else besides file mtimes can change an entry — stays with the feature, because it
// differs (a game's playtime lives in a list file, not in any per-appid file).
//
// SAFETY: the delta is an optimisation and must never be the reason data is wrong.
// A caller that cannot get a usable baseline is expected to fall back to its full
// rebuild, and every helper here returns null/empty rather than guessing.

import fs from 'node:fs/promises'
import path from 'node:path'
import logger from '../../logger.js'
import { mapChunked } from './map-chunked.js'

const VERSION = 1

/**
 * @param {object} opts
 * @param {string} opts.name            Feature label for logs.
 * @param {() => string} opts.file      Sidecar path for the baseline (read at call
 *                                      time so it honors RELAY_DATA_ROOT).
 * @param {() => Record<string,string>} opts.dirs  label → directory holding
 *                                      `<key>.json` per entry. Read at call time.
 */
export function createSourceSignatures({ name, file, dirs }) {

    /**
     * key → "label:mtime|label:mtime|…" for every per-entry file on disk.
     * One readdir per directory, then a stat per entry — those stats are served from
     * the attribute cache the readdir just populated, which is what makes this
     * ~150x cheaper than reading the files.
     */
    async function scan() {
        const sigs = new Map()
        for (const [label, dir] of Object.entries(dirs())) {
            let files
            try { files = await fs.readdir(dir) } catch { continue }   // never synced
            await mapChunked(files.filter(f => /^\d+\.json$/.test(f)), async (entry) => {
                const key = Number(entry.slice(0, -5))
                if (!key) return
                try {
                    const { mtimeMs } = await fs.stat(path.join(dir, entry))
                    sigs.set(key, `${sigs.get(key) ?? ''}${label}:${Math.round(mtimeMs)}|`)
                } catch { /* vanished mid-scan — reads as changed next time */ }
            })
        }
        return sigs
    }

    /** The persisted baseline, or null when it is absent/corrupt/foreign. */
    async function load() {
        try {
            const raw = JSON.parse(await fs.readFile(file(), 'utf8'))
            if (raw?.v !== VERSION || !raw.sigs) return null
            return raw
        } catch { return null }
    }

    /**
     * @param {Map} sigs   signatures to record
     * @param {string} [shape]  optional fingerprint of the derived entry's structure —
     *        see shapeOf(). Lets a caller notice its own mapping changed.
     */
    async function persist(sigs, shape) {
        const f   = file()
        const tmp = `${f}.tmp`
        try {
            await fs.mkdir(path.dirname(f), { recursive: true })
            await fs.writeFile(tmp, JSON.stringify({
                v: VERSION, builtAt: new Date().toISOString(), shape, sigs: Object.fromEntries(sigs),
            }))
            await fs.rename(tmp, f)
        } catch (err) {
            logger.warn(`[${name}] Source signature persist failed — next refresh will be a full rebuild`, { err: err.message })
        }
    }

    return { scan, load, persist }
}

/**
 * Key structure of a derived entry, one level into nested objects.
 *
 * Guards the delta's core assumption: that an entry whose sources haven't changed is
 * still correctly shaped. Change the mapping and untouched entries would otherwise
 * keep the old shape indefinitely, relying on someone remembering to bump a version.
 *
 * TWO RULES FOR CALLERS, both learned the hard way:
 *  - Compare shapes computed from the SAME reference entry every time. This renders a
 *    nested block differently when it is null than when it is populated, so sampling
 *    "whichever entry changed" makes the shape look different on every refresh that
 *    had real work to do — which silently turns the delta off.
 *  - It catches structural drift only, never a change in how a VALUE is derived.
 */
export function shapeOf(entry) {
    if (!entry) return ''
    return Object.keys(entry).sort().map(k => {
        const v = entry[k]
        return v && typeof v === 'object' && !Array.isArray(v)
            ? `${k}{${Object.keys(v).sort().join(',')}}`
            : k
    }).join(',')
}

/** Lowest key present — a stable reference entry for shapeOf(). */
export function shapeRefKey(keys) {
    let min = Infinity
    for (const k of keys) if (k < min) min = k
    return Number.isFinite(min) ? min : null
}
