import path from 'node:path'
import { ManagedFile } from './managed-file.js'

/**
 * Process-lifetime ManagedFile cache for the simple key→value store services
 * (flags, settings, reviews, notes, subreddits, community prefs).
 *
 * The old shape — a fresh ManagedFile per call — meant every mutator did
 * read-modify-write against its own private copy of the store, so two
 * concurrent mutations silently lost one (last flush wins). Sharing one
 * instance per path serializes all mutations through the same in-memory
 * object. Keyed by resolved path so tests (or a DATA_DIR change) get the
 * right file.
 *
 * Instances are intentionally never closed: ManagedFile only holds a flush
 * timer while dirty, and these services flush after every mutation.
 */
const _files = new Map<string, unknown>()

export async function getStoreFile<T extends object>(
    fileName: string,
    name: string,
    defaultValue: () => T,
): Promise<ManagedFile<T>> {
    const dataDir = process.env.DATA_DIR
    if (!dataDir) throw new Error('DATA_DIR must be set')
    const filePath = path.join(dataDir, 'gaming-journal', fileName)
    let file = _files.get(filePath) as ManagedFile<T> | undefined
    if (!file) {
        file = new ManagedFile<T>({ filePath, name, defaultValue })
        _files.set(filePath, file)
    }
    await file.load()
    return file
}

/**
 * Own-property helpers for stores keyed by user/route-supplied strings.
 * Plain `data[key]` reads walk the prototype chain — `data["__proto__"]`
 * resolves to Object.prototype — and plain assignment to "__proto__" swaps
 * the prototype instead of storing (global prototype pollution in the worst
 * case). These treat every key as inert data.
 */
export function getOwn<V>(data: Record<string, V>, key: string): V | undefined {
    return Object.hasOwn(data, key) ? data[key] : undefined
}

export function setOwn<V>(data: Record<string, V>, key: string, value: V): void {
    Object.defineProperty(data, key, { value, writable: true, enumerable: true, configurable: true })
}
