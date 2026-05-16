import { randomUUID } from 'node:crypto'
import path from 'node:path'
import logger from '../../logger.js'
import { ManagedFile } from '../shared/managed-file.js'

const VALID_TYPES = ['list', 'progress', 'progress-bars', 'notes', 'page']

function now() {
    return new Date().toISOString()
}

function typeDefaults(type) {
    switch (type) {
        case 'list':          return { ordered: true, items: [] }
        case 'progress':      return { tasks: [], notes: '' }
        case 'progress-bars': return { bars: [], notes: '' }
        case 'notes':         return { notes: [] }
        case 'page':          return { content: '' }
        default:              return {}
    }
}

function managedFileLog(level, msg, meta) {
    logger[level]?.(msg, meta)
}

export { VALID_TYPES, typeDefaults }

let _instance = null

export function getJournalService() {
    if (!_instance) {
        const dataDir = process.env.DATA_DIR
        if (!dataDir) throw new Error('DATA_DIR must be set in .env')
        const filePath = path.join(dataDir, 'gaming-journal', 'pages.json')
        _instance = new JournalService(filePath)
    }
    return _instance
}

export class JournalService {
    constructor(filePath) {
        this._mf = new ManagedFile({
            filePath,
            name: 'pages',
            defaultValue: () => ({ pages: [] }),
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
        return [...this._mf.get().pages]
    }

    getById(id) {
        const page = this._mf.get().pages.find(p => p.id === id)
        return page ? { ...page } : null
    }

    async create(data) {
        const { type, title, ...rest } = data
        const page = {
            id: randomUUID(),
            type,
            title,
            ...typeDefaults(type),
            ...rest,
            createdAt: now(),
            updatedAt: now(),
        }
        const current = this._mf.get()
        await this._mf.set({ pages: [...current.pages, page] })
        return page
    }

    async update(id, updates) {
        const current = this._mf.get()
        const idx = current.pages.findIndex(p => p.id === id)
        if (idx === -1) return null

        const { id: _id, type: _type, createdAt: _created, ...safe } = updates

        const updated = { ...current.pages[idx], ...safe, updatedAt: now() }
        const pages = [...current.pages]
        pages[idx] = updated

        await this._mf.set({ pages })
        return updated
    }

    async remove(id) {
        const current = this._mf.get()
        const exists = current.pages.some(p => p.id === id)
        if (!exists) return false
        await this._mf.set({ pages: current.pages.filter(p => p.id !== id) })
        return true
    }

    async reorder(ids) {
        const current = this._mf.get()
        const map = new Map(current.pages.map(p => [p.id, p]))
        const reordered = ids.map(id => map.get(id)).filter(Boolean)
        const rest = current.pages.filter(p => !ids.includes(p.id))
        await this._mf.set({ pages: [...reordered, ...rest] })
    }
}
