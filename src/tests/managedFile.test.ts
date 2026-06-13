import { describe, it, beforeEach, afterEach, expect } from 'vitest'
import os  from 'node:os'
import path from 'node:path'
import fsp  from 'node:fs/promises'
import { ManagedFile } from '../lib/server/shared/managed-file.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir() {
    return path.join(os.tmpdir(), `mf-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

function wait(ms: number) { return new Promise(r => setTimeout(r, ms)) }

function makeFile(tmpDir: string, overrides: Record<string, any> = {}) {
    return new ManagedFile({
        filePath:     path.join(tmpDir, 'data.json'),
        name:         'test',
        defaultValue: () => ({ items: [] }),
        log:          () => {},
        ...overrides,
    })
}

// ── Constructor validation ────────────────────────────────────────────────────

describe('ManagedFile — constructor', () => {
    it('throws when filePath is missing', () => {
        expect(() => new ManagedFile({ name: 'x', defaultValue: () => ({}) })).toThrow(/filePath/)
    })

    it('throws when name is missing', () => {
        expect(() => new ManagedFile({ filePath: '/tmp/x.json', defaultValue: () => ({}) })).toThrow(/name/)
    })

    it('throws when defaultValue is not a function', () => {
        expect(() => new ManagedFile({ filePath: '/tmp/x.json', name: 'x', defaultValue: {} })).toThrow(/defaultValue/)
    })
})

// ── Load — main file ──────────────────────────────────────────────────────────

describe('ManagedFile — load from file', () => {
    let tmpDir: string
    beforeEach(async () => { tmpDir = makeTmpDir(); await fsp.mkdir(tmpDir, { recursive: true }) })
    afterEach(() => fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {}))

    it('loads value from an existing file', async () => {
        await fsp.writeFile(path.join(tmpDir, 'data.json'), JSON.stringify({ items: [1, 2, 3] }))
        const mf = makeFile(tmpDir)
        await mf.load()
        expect(mf.get()).toEqual({ items: [1, 2, 3] })
    })

    it('uses default value when file does not exist (checkpoint enabled)', async () => {
        const mf = makeFile(tmpDir)
        await mf.load()
        expect(mf.get()).toEqual({ items: [] })
        expect(mf.getStats().loadSource).toBe('default')
    })

    it('uses default value when file does not exist (checkpoint disabled)', async () => {
        const mf = makeFile(tmpDir, { enableCheckpoint: false })
        await mf.load()
        expect(mf.get()).toEqual({ items: [] })
    })

    it('load() is idempotent — second call is a no-op', async () => {
        const mf = makeFile(tmpDir)
        await mf.load()
        await mf.load()
        expect(mf.get()).toEqual({ items: [] })
    })
})

// ── Load — checkpoint fallback ────────────────────────────────────────────────

describe('ManagedFile — checkpoint fallback', () => {
    let tmpDir: string
    beforeEach(async () => { tmpDir = makeTmpDir(); await fsp.mkdir(tmpDir, { recursive: true }) })
    afterEach(() => fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {}))

    it('falls back to checkpoint when main file is missing', async () => {
        const filePath       = path.join(tmpDir, 'data.json')
        const checkpointPath = filePath + '.checkpoint.json'
        await fsp.writeFile(checkpointPath, JSON.stringify({ items: ['checkpoint-value'] }))
        const mf = makeFile(tmpDir)
        await mf.load()
        expect(mf.get().items).toEqual(['checkpoint-value'])
        expect(mf.getStats().recoveryUsedOnLoad).toBe(true)
        expect(mf.getStats().loadSource).toBe('checkpoint')
    })

    it('falls back to checkpoint when main file is corrupt', async () => {
        const filePath       = path.join(tmpDir, 'data.json')
        const checkpointPath = filePath + '.checkpoint.json'
        await fsp.writeFile(filePath,       'INVALID JSON }{')
        await fsp.writeFile(checkpointPath, JSON.stringify({ items: ['from-checkpoint'] }))
        const mf = makeFile(tmpDir)
        await mf.load()
        expect(mf.get().items).toEqual(['from-checkpoint'])
        expect(mf.getStats().recoveryUsedOnLoad).toBe(true)
    })

    it('uses default when main is missing and checkpoint is missing', async () => {
        const mf = makeFile(tmpDir)
        await mf.load()
        expect(mf.get()).toEqual({ items: [] })
        expect(mf.getStats().loadSource).toBe('default')
    })

    it('uses default when main is missing and checkpoint is corrupt', async () => {
        const checkpointPath = path.join(tmpDir, 'data.json.checkpoint.json')
        await fsp.writeFile(checkpointPath, 'BAD JSON')
        const mf = makeFile(tmpDir)
        await mf.load()
        expect(mf.get()).toEqual({ items: [] })
        expect(mf.getStats().loadSource).toBe('default')
    })

    it('throws when main is corrupt and checkpoint is disabled', async () => {
        await fsp.writeFile(path.join(tmpDir, 'data.json'), 'INVALID')
        const mf = makeFile(tmpDir, { enableCheckpoint: false })
        await expect(mf.load()).rejects.toThrow()
    })
})

// ── get / set / flush ─────────────────────────────────────────────────────────

describe('ManagedFile — get/set/flush', () => {
    let tmpDir: string
    beforeEach(async () => { tmpDir = makeTmpDir(); await fsp.mkdir(tmpDir, { recursive: true }) })
    afterEach(() => fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {}))

    it('get() throws before load', () => {
        const mf = makeFile(tmpDir)
        expect(() => mf.get()).toThrow(/not loaded/)
    })

    it('set() throws before load', async () => {
        const mf = makeFile(tmpDir)
        await expect(mf.set({ items: [] })).rejects.toThrow(/not loaded/)
    })

    it('set() + flush() persists value to disk', async () => {
        const mf = makeFile(tmpDir)
        await mf.load()
        await mf.set({ items: [42] })
        await mf.flush()

        const disk = JSON.parse(await fsp.readFile(path.join(tmpDir, 'data.json'), 'utf8'))
        expect(disk).toEqual({ items: [42] })
    })

    it('flush() is a no-op when not dirty', async () => {
        const mf = makeFile(tmpDir)
        await mf.load()
        await expect(mf.flush()).resolves.not.toThrow()
    })

    it('two set() calls followed by one flush() writes the latest value', async () => {
        const mf = makeFile(tmpDir)
        await mf.load()
        await mf.set({ items: [1] })
        await mf.set({ items: [1, 2] })
        await mf.flush()

        const disk = JSON.parse(await fsp.readFile(path.join(tmpDir, 'data.json'), 'utf8'))
        expect(disk).toEqual({ items: [1, 2] })
    })

    it('flush() after flush() + set() writes the new value (post-flush dirty cycle)', async () => {
        const mf = makeFile(tmpDir)
        await mf.load()
        await mf.set({ items: ['first'] })
        await mf.flush()
        await mf.set({ items: ['second'] })
        await mf.flush()

        const disk = JSON.parse(await fsp.readFile(path.join(tmpDir, 'data.json'), 'utf8'))
        expect(disk).toEqual({ items: ['second'] })
        expect(mf.getStats().writeCount).toBe(2)
    })

    it('flush() writes a checkpoint file', async () => {
        const mf = makeFile(tmpDir)
        await mf.load()
        await mf.set({ items: [7] })
        await mf.flush()
        await wait(50)

        const cp = await fsp.readFile(path.join(tmpDir, 'data.json.checkpoint.json'), 'utf8').catch(() => null)
        expect(cp).not.toBeNull()
        expect(JSON.parse(cp!)).toEqual({ items: [7] })
    })

    it('checkpoint is not written when enableCheckpoint is false', async () => {
        const mf = makeFile(tmpDir, { enableCheckpoint: false })
        await mf.load()
        await mf.set({ items: [1] })
        await mf.flush()
        await wait(50)

        const cp = await fsp.readFile(path.join(tmpDir, 'data.json.checkpoint.json'), 'utf8').catch(() => null)
        expect(cp).toBeNull()
    })
})

// ── close ─────────────────────────────────────────────────────────────────────

describe('ManagedFile — close', () => {
    let tmpDir: string
    beforeEach(async () => { tmpDir = makeTmpDir(); await fsp.mkdir(tmpDir, { recursive: true }) })
    afterEach(() => fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {}))

    it('close() flushes dirty state to disk', async () => {
        const mf = makeFile(tmpDir)
        await mf.load()
        await mf.set({ items: ['on-close'] })
        await mf.close()

        const disk = JSON.parse(await fsp.readFile(path.join(tmpDir, 'data.json'), 'utf8'))
        expect(disk).toEqual({ items: ['on-close'] })
    })

    it('close() is safe to call when not dirty', async () => {
        const mf = makeFile(tmpDir)
        await mf.load()
        await expect(mf.close()).resolves.not.toThrow()
    })
})

// ── getStats ──────────────────────────────────────────────────────────────────

describe('ManagedFile — getStats', () => {
    let tmpDir: string
    beforeEach(async () => { tmpDir = makeTmpDir(); await fsp.mkdir(tmpDir, { recursive: true }) })
    afterEach(() => fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {}))

    it('returns the expected shape after load', async () => {
        const mf = makeFile(tmpDir)
        await mf.load()
        const stats = mf.getStats()

        expect(typeof stats.name).toBe('string')
        expect(typeof stats.filePath).toBe('string')
        expect(stats.loaded).toBe(true)
        expect(typeof stats.loadedAt).toBe('string')
        expect(stats.dirty).toBe(false)
        expect(stats.pendingFlushInMs).toBeNull()
        expect(stats.writeCount).toBe(0)
        expect(stats.auditViolationCount).toBe(0)
        expect(stats.recoveryUsedOnLoad).toBe(false)
        expect(stats.lastFlushedAt).toBeNull()
    })

    it('writeCount increments after each flush', async () => {
        const mf = makeFile(tmpDir)
        await mf.load()

        await mf.set({ items: [1] }); await mf.flush()
        expect(mf.getStats().writeCount).toBe(1)

        await mf.set({ items: [2] }); await mf.flush()
        expect(mf.getStats().writeCount).toBe(2)
    })

    it('lastFlushedAt is set after flush', async () => {
        const mf = makeFile(tmpDir)
        await mf.load()
        await mf.set({ items: [1] })
        await mf.flush()
        expect(mf.getStats().lastFlushedAt).not.toBeNull()
    })

    it('reports prevMetrics when auditMetrics is provided', async () => {
        const mf = makeFile(tmpDir, { auditMetrics: (v: any) => ({ count: v.items.length }) })
        await mf.load()
        const stats = mf.getStats()
        expect(stats.prevMetrics).toEqual({ count: 0 })
    })

    it('pendingFlushInMs is non-null while a scheduled flush is pending', async () => {
        const mf = makeFile(tmpDir, { maxFlushIntervalMs: 60_000 })
        await mf.load()
        await mf.set({ items: [1] })
        const stats = mf.getStats()
        expect(stats.pendingFlushInMs).not.toBeNull()
        expect(stats.pendingFlushInMs).toBeGreaterThanOrEqual(0)
        await mf.flush()
    })
})

// ── Audit ─────────────────────────────────────────────────────────────────────

describe('ManagedFile — audit', () => {
    let tmpDir: string
    beforeEach(async () => { tmpDir = makeTmpDir(); await fsp.mkdir(tmpDir, { recursive: true }) })
    afterEach(() => fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {}))

    it('throws on audit violation in set() and increments auditViolationCount', async () => {
        const mf = makeFile(tmpDir, {
            auditMetrics: (v: any) => ({ count: v.items.length }),
            audit: (prev: any, newVal: any) => newVal.items.length < prev.count
                ? { ok: false, reason: 'count decreased' }
                : { ok: true },
        })
        await mf.load()
        await mf.set({ items: [1] })
        await mf.flush()
        await expect(mf.set({ items: [] })).rejects.toThrow(/Audit violation/)
        expect(mf.getStats().auditViolationCount).toBe(1)
    })

    it('audit violation creates a quarantine file', async () => {
        const mf = makeFile(tmpDir, {
            auditMetrics: (v: any) => ({ count: v.items.length }),
            audit: (prev: any, newVal: any) => newVal.items.length < prev.count
                ? { ok: false, reason: 'shrink' }
                : { ok: true },
        })
        await mf.load()
        await mf.set({ items: [1] })
        await mf.flush()

        await expect(mf.set({ items: [] })).rejects.toThrow()
        await wait(50)

        const entries = await fsp.readdir(tmpDir)
        const quarantines = entries.filter(e => e.includes('.quarantine-'))
        expect(quarantines.length).toBeGreaterThanOrEqual(1)
    })
})

// ── Backup ────────────────────────────────────────────────────────────────────

describe('ManagedFile — backup', () => {
    let tmpDir: string
    beforeEach(async () => { tmpDir = makeTmpDir(); await fsp.mkdir(tmpDir, { recursive: true }) })
    afterEach(() => fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {}))

    it('backup() is a no-op before load', async () => {
        const backupDir = path.join(tmpDir, 'backups')
        const mf = makeFile(tmpDir, { backupDir })
        await expect(mf.backup()).resolves.not.toThrow()
    })

    it('backup() creates a timestamped file in backupDir', async () => {
        const backupDir = path.join(tmpDir, 'backups')
        const mf = makeFile(tmpDir, { backupDir })
        await mf.load()
        await mf.backup()
        const entries = await fsp.readdir(backupDir)
        expect(entries.length).toBe(1)
        expect(entries[0].startsWith('data-') && entries[0].endsWith('.json')).toBe(true)
    })

    it('prunes old backups when over backupKeep limit', async () => {
        const backupDir = path.join(tmpDir, 'backups')
        const mf = makeFile(tmpDir, { backupDir, backupKeep: 2 })
        await mf.load()
        for (let i = 0; i < 4; i++) {
            await wait(10)
            await mf.backup()
        }
        const entries = await fsp.readdir(backupDir)
        expect(entries.length).toBeLessThanOrEqual(2)
    })

    it('automatic backup triggers during flush when backupIntervalMs has elapsed', async () => {
        const backupDir = path.join(tmpDir, 'backups')
        const mf = makeFile(tmpDir, { backupDir, backupIntervalMs: 0 })
        await mf.load()
        await mf.set({ items: [99] })
        await mf.flush()
        await wait(100)

        const entries = await fsp.readdir(backupDir).catch(() => [])
        expect(entries.length).toBeGreaterThanOrEqual(1)
    })

    it('creates initial backup on first load when no existing backup', async () => {
        const backupDir = path.join(tmpDir, 'backups')
        await fsp.writeFile(path.join(tmpDir, 'data.json'), JSON.stringify({ items: ['loaded'] }))
        const mf = makeFile(tmpDir, { backupDir })
        await mf.load()
        await wait(100)

        const entries = await fsp.readdir(backupDir).catch(() => [])
        expect(entries.length).toBeGreaterThanOrEqual(1)
    })

    it('skips initial backup when a backup already exists', async () => {
        const backupDir = path.join(tmpDir, 'backups')
        await fsp.mkdir(backupDir, { recursive: true })
        await fsp.writeFile(
            path.join(backupDir, 'data-2026-01-01T00-00-00-000Z.json'),
            '{}'
        )
        await fsp.writeFile(path.join(tmpDir, 'data.json'), JSON.stringify({ items: [] }))
        const mf = makeFile(tmpDir, { backupDir })
        await mf.load()
        await wait(100)

        const entries = await fsp.readdir(backupDir)
        expect(entries.length).toBe(1)
    })
})
