import { randomUUID } from 'node:crypto'
import path from 'node:path'
import logger from '../logger.js'
import { ManagedFile } from '../shared/managed-file.js'
import type { Franchise, FranchiseEntry } from '../../types.js'

function now(): string {
    return new Date().toISOString()
}

function managedFileLog(level: string, msg: string, meta?: unknown): void {
    const fn = (logger as unknown as Record<string, (m: string, x?: unknown) => void>)[level]
    if (typeof fn === 'function') fn.call(logger, msg, meta)
}

interface FranchiseStore {
    franchises: Franchise[]
}

let _instance: FranchiseService | null = null

export function getFranchiseService(): FranchiseService {
    if (!_instance) {
        const dataDir = process.env.DATA_DIR
        if (!dataDir) throw new Error('DATA_DIR must be set in .env')
        const filePath = path.join(dataDir, 'gaming-journal', 'franchises.json')
        _instance = new FranchiseService(filePath)
    }
    return _instance
}

export class FranchiseService {
    private _mf: ManagedFile<FranchiseStore>

    constructor(filePath: string) {
        this._mf = new ManagedFile<FranchiseStore>({
            filePath,
            name:               'franchises',
            defaultValue:       () => ({ franchises: [] }),
            maxFlushIntervalMs: 30_000,
            log:                managedFileLog,
        })
    }

    async load(): Promise<void>  { await this._mf.load() }
    async flush(): Promise<void> { await this._mf.flush() }
    async close(): Promise<void> { await this._mf.close() }

    getAll(): Franchise[] {
        return [...this._mf.get().franchises]
    }

    getById(id: string): Franchise | null {
        const f = this._mf.get().franchises.find(f => f.id === id)
        return f ? { ...f, entries: [...(f.entries ?? [])] } : null
    }

    async create(data: { name: string; entries?: Partial<FranchiseEntry>[] }): Promise<Franchise> {
        const { name, entries = [] } = data
        const franchise: Franchise = {
            id:        randomUUID(),
            name,
            entries:   entries.map(e => ({ appid: e.appid!, name: e.name ?? `App ${e.appid}` })),
            createdAt: now(),
            updatedAt: now(),
        }
        const current = this._mf.get()
        await this._mf.set({ franchises: [...current.franchises, franchise] })
        return franchise
    }

    async update(id: string, updates: Partial<Franchise>): Promise<Franchise | null> {
        const current = this._mf.get()
        const idx     = current.franchises.findIndex(f => f.id === id)
        if (idx === -1) return null

        const { id: _id, createdAt: _created, ...safe } = updates as Record<string, unknown>
        const updated    = { ...current.franchises[idx], ...safe, updatedAt: now() } as Franchise
        const franchises = [...current.franchises]
        franchises[idx]  = updated
        await this._mf.set({ franchises })
        return updated
    }

    async remove(id: string): Promise<boolean> {
        const current = this._mf.get()
        const exists  = current.franchises.some(f => f.id === id)
        if (!exists) return false
        await this._mf.set({ franchises: current.franchises.filter(f => f.id !== id) })
        return true
    }

    async addEntry(franchiseId: string, entry: Partial<FranchiseEntry>): Promise<Franchise | null> {
        const current = this._mf.get()
        const idx     = current.franchises.findIndex(f => f.id === franchiseId)
        if (idx === -1) return null

        const f = current.franchises[idx]
        if (f.entries.some(e => e.appid === entry.appid)) return { ...f }

        const updated: Franchise = {
            ...f,
            entries:   [...f.entries, { appid: entry.appid!, name: entry.name ?? `App ${entry.appid}` }],
            updatedAt: now(),
        }
        const franchises = [...current.franchises]
        franchises[idx]  = updated
        await this._mf.set({ franchises })
        return updated
    }

    async removeEntry(franchiseId: string, appid: number): Promise<Franchise | null> {
        const current = this._mf.get()
        const idx     = current.franchises.findIndex(f => f.id === franchiseId)
        if (idx === -1) return null

        const f       = current.franchises[idx]
        const updated: Franchise = {
            ...f,
            entries:   f.entries.filter(e => e.appid !== appid),
            updatedAt: now(),
        }
        const franchises = [...current.franchises]
        franchises[idx]  = updated
        await this._mf.set({ franchises })
        return updated
    }

    async reorderEntries(franchiseId: string, orderedAppids: number[]): Promise<Franchise | null> {
        const current = this._mf.get()
        const idx     = current.franchises.findIndex(f => f.id === franchiseId)
        if (idx === -1) return null

        const f         = current.franchises[idx]
        const map       = new Map(f.entries.map(e => [e.appid, e]))
        const reordered = orderedAppids.map(id => map.get(id)).filter((e): e is FranchiseEntry => e !== undefined)
        const rest      = f.entries.filter(e => !orderedAppids.includes(e.appid))

        const updated: Franchise = { ...f, entries: [...reordered, ...rest], updatedAt: now() }
        const franchises = [...current.franchises]
        franchises[idx]  = updated
        await this._mf.set({ franchises })
        return updated
    }
}
