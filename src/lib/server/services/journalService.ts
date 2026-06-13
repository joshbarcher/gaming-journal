import { randomUUID } from 'node:crypto'
import path from 'node:path'
import logger from '../logger.js'
import { ManagedFile } from '../shared/managed-file.js'
import type { Page, PageType } from '../../types.js'

const VALID_TYPES: PageType[] = ['list', 'progress', 'progress-bars', 'notes', 'page', 'counter', 'multi-counter']

function now(): string {
    return new Date().toISOString()
}

function typeDefaults(type: PageType): Record<string, unknown> {
    switch (type) {
        case 'list':          return { ordered: true, items: [] }
        case 'progress':      return { tasks: [], notes: '' }
        case 'progress-bars': return { bars:  [], notes: '' }
        case 'notes':         return { notes: [] }
        case 'page':          return { content: '' }
        case 'counter':       return { current: 0, target: 10 }
        case 'multi-counter': return { counters: [] }
    }
}

function managedFileLog(level: string, msg: string, meta?: unknown): void {
    const fn = (logger as unknown as Record<string, (m: string, x?: unknown) => void>)[level]
    if (typeof fn === 'function') fn.call(logger, msg, meta)
}

export { VALID_TYPES, typeDefaults }

interface JournalStore {
    pages: Page[]
}

let _instance: JournalService | null = null

export function getJournalService(): JournalService {
    if (!_instance) {
        const dataDir = process.env.DATA_DIR
        if (!dataDir) throw new Error('DATA_DIR must be set in .env')
        const filePath = path.join(dataDir, 'gaming-journal', 'pages.json')
        _instance = new JournalService(filePath)
    }
    return _instance
}

export class JournalService {
    private _mf: ManagedFile<JournalStore>

    constructor(filePath: string) {
        this._mf = new ManagedFile<JournalStore>({
            filePath,
            name:               'pages',
            defaultValue:       () => ({ pages: [] }),
            maxFlushIntervalMs: 30_000,
            log:                managedFileLog,
        })
    }

    async load(): Promise<void>  { await this._mf.load() }
    async flush(): Promise<void> { await this._mf.flush() }
    async close(): Promise<void> { await this._mf.close() }

    getAll(): Page[] {
        return [...this._mf.get().pages]
    }

    getById(id: string): Page | null {
        const page = this._mf.get().pages.find(p => p.id === id)
        return page ? { ...page } : null
    }

    async create(data: Partial<Page> & { type: PageType; title: string }): Promise<Page> {
        const { type, title, ...rest } = data
        const page = {
            id: randomUUID(),
            type,
            title,
            ...typeDefaults(type),
            ...rest,
            createdAt: now(),
            updatedAt: now(),
        } as Page
        const current = this._mf.get()
        await this._mf.set({ pages: [...current.pages, page] })
        return page
    }

    async update(id: string, updates: Partial<Page>): Promise<Page | null> {
        const current = this._mf.get()
        const idx = current.pages.findIndex(p => p.id === id)
        if (idx === -1) return null

        const { id: _id, type: _type, createdAt: _created, ...safe } = updates as Record<string, unknown>

        const updated = { ...current.pages[idx], ...safe, updatedAt: now() } as Page
        const pages   = [...current.pages]
        pages[idx]    = updated

        await this._mf.set({ pages })
        return updated
    }

    async remove(id: string): Promise<boolean> {
        const current = this._mf.get()
        const exists  = current.pages.some(p => p.id === id)
        if (!exists) return false
        await this._mf.set({ pages: current.pages.filter(p => p.id !== id) })
        return true
    }

    getByAppid(appid: string | number): Page[] {
        const key = String(appid)
        return this._mf.get().pages
            .filter(p => p.appid === key)
            .map(p => ({ ...p }))
    }

    async reorder(ids: string[]): Promise<void> {
        const current  = this._mf.get()
        const map      = new Map(current.pages.map(p => [p.id, p]))
        const reordered = ids.map(id => map.get(id)).filter((p): p is Page => p !== undefined)
        const rest      = current.pages.filter(p => !ids.includes(p.id))
        await this._mf.set({ pages: [...reordered, ...rest] })
    }
}
