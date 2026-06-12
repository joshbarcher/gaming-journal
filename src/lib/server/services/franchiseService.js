import { randomUUID } from 'node:crypto'
import path from 'node:path'
import logger from '../logger.js'
import { ManagedFile } from '../shared/managed-file.js'

function now() {
    return new Date().toISOString()
}

function managedFileLog(level, msg, meta) {
    logger[level]?.(msg, meta)
}

let _instance = null

export function getFranchiseService() {
    if (!_instance) {
        const dataDir = process.env.DATA_DIR
        if (!dataDir) throw new Error('DATA_DIR must be set in .env')
        const filePath = path.join(dataDir, 'gaming-journal', 'franchises.json')
        _instance = new FranchiseService(filePath)
    }
    return _instance
}

export class FranchiseService {
    constructor(filePath) {
        this._mf = new ManagedFile({
            filePath,
            name: 'franchises',
            defaultValue: () => ({ franchises: [] }),
            maxFlushIntervalMs: 30_000,
            log: managedFileLog,
        })
    }

    async load() {
        await this._mf.load()
    }

    async flush() {
        await this._mf.flush()
    }

    async close() {
        await this._mf.close()
    }

    getAll() {
        return [...this._mf.get().franchises]
    }

    getById(id) {
        const f = this._mf.get().franchises.find(f => f.id === id)
        return f ? { ...f, entries: [...(f.entries ?? [])] } : null
    }

    async create(data) {
        const { name, entries = [] } = data
        const franchise = {
            id:        randomUUID(),
            name,
            entries:   entries.map(e => ({ appid: e.appid, name: e.name ?? `App ${e.appid}` })),
            createdAt: now(),
            updatedAt: now(),
        }
        const current = this._mf.get()
        await this._mf.set({ franchises: [...current.franchises, franchise] })
        return franchise
    }

    async update(id, updates) {
        const current = this._mf.get()
        const idx = current.franchises.findIndex(f => f.id === id)
        if (idx === -1) return null

        const { id: _id, createdAt: _created, ...safe } = updates
        const updated = { ...current.franchises[idx], ...safe, updatedAt: now() }
        const franchises = [...current.franchises]
        franchises[idx] = updated
        await this._mf.set({ franchises })
        return updated
    }

    async remove(id) {
        const current = this._mf.get()
        const exists = current.franchises.some(f => f.id === id)
        if (!exists) return false
        await this._mf.set({ franchises: current.franchises.filter(f => f.id !== id) })
        return true
    }

    // ── Entry management ──────────────────────────────────────────────────────

    async addEntry(franchiseId, entry) {
        const current = this._mf.get()
        const idx = current.franchises.findIndex(f => f.id === franchiseId)
        if (idx === -1) return null

        const f = current.franchises[idx]
        // No duplicates
        if (f.entries.some(e => e.appid === entry.appid)) return { ...f }

        const updated = {
            ...f,
            entries:   [...f.entries, { appid: entry.appid, name: entry.name ?? `App ${entry.appid}` }],
            updatedAt: now(),
        }
        const franchises = [...current.franchises]
        franchises[idx] = updated
        await this._mf.set({ franchises })
        return updated
    }

    async removeEntry(franchiseId, appid) {
        const current = this._mf.get()
        const idx = current.franchises.findIndex(f => f.id === franchiseId)
        if (idx === -1) return null

        const f = current.franchises[idx]
        const updated = {
            ...f,
            entries:   f.entries.filter(e => e.appid !== appid),
            updatedAt: now(),
        }
        const franchises = [...current.franchises]
        franchises[idx] = updated
        await this._mf.set({ franchises })
        return updated
    }

    async reorderEntries(franchiseId, orderedAppids) {
        const current = this._mf.get()
        const idx = current.franchises.findIndex(f => f.id === franchiseId)
        if (idx === -1) return null

        const f = current.franchises[idx]
        const map = new Map(f.entries.map(e => [e.appid, e]))
        const reordered = orderedAppids.map(id => map.get(id)).filter(Boolean)
        // Append any entries not in the order list at the end
        const rest = f.entries.filter(e => !orderedAppids.includes(e.appid))

        const updated = { ...f, entries: [...reordered, ...rest], updatedAt: now() }
        const franchises = [...current.franchises]
        franchises[idx] = updated
        await this._mf.set({ franchises })
        return updated
    }
}
