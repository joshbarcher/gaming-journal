import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import os  from 'node:os'
import path from 'node:path'
import fsp  from 'node:fs/promises'
import { ManagedFile } from '../lib/server/shared/managed-file.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir() {
    return path.join(os.tmpdir(), `mf-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)) }

function makeFile(tmpDir, overrides = {}) {
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
        assert.throws(
            () => new ManagedFile({ name: 'x', defaultValue: () => ({}) }),
            /filePath/
        )
    })

    it('throws when name is missing', () => {
        assert.throws(
            () => new ManagedFile({ filePath: '/tmp/x.json', defaultValue: () => ({}) }),
            /name/
        )
    })

    it('throws when defaultValue is not a function', () => {
        assert.throws(
            () => new ManagedFile({ filePath: '/tmp/x.json', name: 'x', defaultValue: {} }),
            /defaultValue/
        )
    })
})

// ── Load — main file ──────────────────────────────────────────────────────────

describe('ManagedFile — load from file', () => {
    let tmpDir
    beforeEach(async () => { tmpDir = makeTmpDir(); await fsp.mkdir(tmpDir, { recursive: true }) })
    afterEach(() => fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {}))

    it('loads value from an existing file', async () => {
        await fsp.writeFile(path.join(tmpDir, 'data.json'), JSON.stringify({ items: [1, 2, 3] }))
        const mf = makeFile(tmpDir)
        await mf.load()
        assert.deepEqual(mf.get(), { items: [1, 2, 3] })
    })

    it('uses default value when file does not exist (checkpoint enabled)', async () => {
        const mf = makeFile(tmpDir)
        await mf.load()
        assert.deepEqual(mf.get(), { items: [] })
        assert.equal(mf.getStats().loadSource, 'default')
    })

    it('uses default value when file does not exist (checkpoint disabled)', async () => {
        const mf = makeFile(tmpDir, { enableCheckpoint: false })
        await mf.load()
        assert.deepEqual(mf.get(), { items: [] })
    })

    it('load() is idempotent — second call is a no-op', async () => {
        const mf = makeFile(tmpDir)
        await mf.load()
        await mf.load()
        assert.deepEqual(mf.get(), { items: [] })
    })
})

// ── Load — checkpoint fallback ────────────────────────────────────────────────

describe('ManagedFile — checkpoint fallback', () => {
    let tmpDir
    beforeEach(async () => { tmpDir = makeTmpDir(); await fsp.mkdir(tmpDir, { recursive: true }) })
    afterEach(() => fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {}))

    it('falls back to checkpoint when main file is missing', async () => {
        const filePath       = path.join(tmpDir, 'data.json')
        const checkpointPath = filePath + '.checkpoint.json'
        await fsp.writeFile(checkpointPath, JSON.stringify({ items: ['checkpoint-value'] }))
        const mf = makeFile(tmpDir)
        await mf.load()
        assert.deepEqual(mf.get().items, ['checkpoint-value'])
        assert.equal(mf.getStats().recoveryUsedOnLoad, true)
        assert.equal(mf.getStats().loadSource, 'checkpoint')
    })

    it('falls back to checkpoint when main file is corrupt', async () => {
        const filePath       = path.join(tmpDir, 'data.json')
        const checkpointPath = filePath + '.checkpoint.json'
        await fsp.writeFile(filePath,       'INVALID JSON }{')
        await fsp.writeFile(checkpointPath, JSON.stringify({ items: ['from-checkpoint'] }))
        const mf = makeFile(tmpDir)
        await mf.load()
        assert.deepEqual(mf.get().items, ['from-checkpoint'])
        assert.equal(mf.getStats().recoveryUsedOnLoad, true)
    })

    it('uses default when main is missing and checkpoint is missing', async () => {
        const mf = makeFile(tmpDir)
        await mf.load()
        assert.deepEqual(mf.get(), { items: [] })
        assert.equal(mf.getStats().loadSource, 'default')
    })

    it('uses default when main is missing and checkpoint is corrupt', async () => {
        const checkpointPath = path.join(tmpDir, 'data.json.checkpoint.json')
        await fsp.writeFile(checkpointPath, 'BAD JSON')
        const mf = makeFile(tmpDir)
        await mf.load()
        assert.deepEqual(mf.get(), { items: [] })
        assert.equal(mf.getStats().loadSource, 'default')
    })

    it('throws when main is corrupt and checkpoint is disabled', async () => {
        await fsp.writeFile(path.join(tmpDir, 'data.json'), 'INVALID')
        const mf = makeFile(tmpDir, { enableCheckpoint: false })
        await assert.rejects(() => mf.load())
    })
})

// ── get / set / flush ─────────────────────────────────────────────────────────

describe('ManagedFile — get/set/flush', () => {
    let tmpDir
    beforeEach(async () => { tmpDir = makeTmpDir(); await fsp.mkdir(tmpDir, { recursive: true }) })
    afterEach(() => fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {}))

    it('get() throws before load', () => {
        const mf = makeFile(tmpDir)
        assert.throws(() => mf.get(), /not loaded/)
    })

    it('set() throws before load', async () => {
        const mf = makeFile(tmpDir)
        await assert.rejects(() => mf.set({ items: [] }), /not loaded/)
    })

    it('set() + flush() persists value to disk', async () => {
        const mf = makeFile(tmpDir)
        await mf.load()
        await mf.set({ items: [42] })
        await mf.flush()

        const disk = JSON.parse(await fsp.readFile(path.join(tmpDir, 'data.json'), 'utf8'))
        assert.deepEqual(disk, { items: [42] })
    })

    it('flush() is a no-op when not dirty', async () => {
        const mf = makeFile(tmpDir)
        await mf.load()
        await assert.doesNotReject(() => mf.flush())
    })

    it('two set() calls followed by one flush() writes the latest value', async () => {
        const mf = makeFile(tmpDir)
        await mf.load()
        await mf.set({ items: [1] })
        await mf.set({ items: [1, 2] })
        await mf.flush()

        const disk = JSON.parse(await fsp.readFile(path.join(tmpDir, 'data.json'), 'utf8'))
        assert.deepEqual(disk, { items: [1, 2] })
    })

    it('flush() after flush() + set() writes the new value (post-flush dirty cycle)', async () => {
        const mf = makeFile(tmpDir)
        await mf.load()
        await mf.set({ items: ['first'] })
        await mf.flush()
        await mf.set({ items: ['second'] })
        await mf.flush()

        const disk = JSON.parse(await fsp.readFile(path.join(tmpDir, 'data.json'), 'utf8'))
        assert.deepEqual(disk, { items: ['second'] })
        assert.equal(mf.getStats().writeCount, 2)
    })

    it('flush() writes a checkpoint file', async () => {
        const mf = makeFile(tmpDir)
        await mf.load()
        await mf.set({ items: [7] })
        await mf.flush()
        await wait(50)  // checkpoint write is async

        const cp = await fsp.readFile(path.join(tmpDir, 'data.json.checkpoint.json'), 'utf8').catch(() => null)
        assert.ok(cp !== null, 'checkpoint file should exist after flush')
        assert.deepEqual(JSON.parse(cp), { items: [7] })
    })

    it('checkpoint is not written when enableCheckpoint is false', async () => {
        const mf = makeFile(tmpDir, { enableCheckpoint: false })
        await mf.load()
        await mf.set({ items: [1] })
        await mf.flush()
        await wait(50)

        const cp = await fsp.readFile(path.join(tmpDir, 'data.json.checkpoint.json'), 'utf8').catch(() => null)
        assert.equal(cp, null, 'checkpoint file should not exist')
    })
})

// ── close ─────────────────────────────────────────────────────────────────────

describe('ManagedFile — close', () => {
    let tmpDir
    beforeEach(async () => { tmpDir = makeTmpDir(); await fsp.mkdir(tmpDir, { recursive: true }) })
    afterEach(() => fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {}))

    it('close() flushes dirty state to disk', async () => {
        const mf = makeFile(tmpDir)
        await mf.load()
        await mf.set({ items: ['on-close'] })
        await mf.close()

        const disk = JSON.parse(await fsp.readFile(path.join(tmpDir, 'data.json'), 'utf8'))
        assert.deepEqual(disk, { items: ['on-close'] })
    })

    it('close() is safe to call when not dirty', async () => {
        const mf = makeFile(tmpDir)
        await mf.load()
        await assert.doesNotReject(() => mf.close())
    })
})

// ── getStats ──────────────────────────────────────────────────────────────────

describe('ManagedFile — getStats', () => {
    let tmpDir
    beforeEach(async () => { tmpDir = makeTmpDir(); await fsp.mkdir(tmpDir, { recursive: true }) })
    afterEach(() => fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {}))

    it('returns the expected shape after load', async () => {
        const mf = makeFile(tmpDir)
        await mf.load()
        const stats = mf.getStats()

        assert.equal(typeof stats.name,           'string')
        assert.equal(typeof stats.filePath,       'string')
        assert.equal(stats.loaded,                true)
        assert.equal(typeof stats.loadedAt,       'string')
        assert.equal(stats.dirty,                 false)
        assert.equal(stats.pendingFlushInMs,      null)
        assert.equal(stats.writeCount,            0)
        assert.equal(stats.auditViolationCount,   0)
        assert.equal(stats.recoveryUsedOnLoad,    false)
        assert.equal(stats.lastFlushedAt,         null)
    })

    it('writeCount increments after each flush', async () => {
        const mf = makeFile(tmpDir)
        await mf.load()

        await mf.set({ items: [1] }); await mf.flush()
        assert.equal(mf.getStats().writeCount, 1)

        await mf.set({ items: [2] }); await mf.flush()
        assert.equal(mf.getStats().writeCount, 2)
    })

    it('lastFlushedAt is set after flush', async () => {
        const mf = makeFile(tmpDir)
        await mf.load()
        await mf.set({ items: [1] })
        await mf.flush()
        assert.ok(mf.getStats().lastFlushedAt !== null)
    })

    it('reports prevMetrics when auditMetrics is provided', async () => {
        const mf = makeFile(tmpDir, { auditMetrics: v => ({ count: v.items.length }) })
        await mf.load()
        const stats = mf.getStats()
        assert.deepEqual(stats.prevMetrics, { count: 0 })
    })

    it('pendingFlushInMs is non-null while a scheduled flush is pending', async () => {
        const mf = makeFile(tmpDir, { maxFlushIntervalMs: 60_000 })
        await mf.load()
        await mf.set({ items: [1] })  // marks dirty, schedules timer
        const stats = mf.getStats()
        assert.ok(stats.pendingFlushInMs !== null, 'should have pending flush timer')
        assert.ok(stats.pendingFlushInMs >= 0)
        await mf.flush()  // clean up
    })
})

// ── Audit ─────────────────────────────────────────────────────────────────────

describe('ManagedFile — audit', () => {
    let tmpDir
    beforeEach(async () => { tmpDir = makeTmpDir(); await fsp.mkdir(tmpDir, { recursive: true }) })
    afterEach(() => fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {}))

    it('throws on audit violation in set() and increments auditViolationCount', async () => {
        const mf = makeFile(tmpDir, {
            auditMetrics: v => ({ count: v.items.length }),
            audit: (prev, newVal) => newVal.items.length < prev.count
                ? { ok: false, reason: 'count decreased' }
                : { ok: true },
        })
        await mf.load()                      // prevMetrics = { count: 0 }
        await mf.set({ items: [1] })         // ok: 1 >= 0
        await mf.flush()                     // prevMetrics updated to { count: 1 }
        await assert.rejects(
            () => mf.set({ items: [] }),     // fail: 0 < 1
            /Audit violation/
        )
        assert.equal(mf.getStats().auditViolationCount, 1)
    })

    it('audit violation creates a quarantine file', async () => {
        const mf = makeFile(tmpDir, {
            auditMetrics: v => ({ count: v.items.length }),
            audit: (prev, newVal) => newVal.items.length < prev.count
                ? { ok: false, reason: 'shrink' }
                : { ok: true },
        })
        await mf.load()
        await mf.set({ items: [1] })
        await mf.flush()

        await assert.rejects(() => mf.set({ items: [] }))
        await wait(50)  // quarantine write is async

        const entries = await fsp.readdir(tmpDir)
        const quarantines = entries.filter(e => e.includes('.quarantine-'))
        assert.ok(quarantines.length >= 1, 'should have a quarantine file')
    })
})

// ── Backup ────────────────────────────────────────────────────────────────────

describe('ManagedFile — backup', () => {
    let tmpDir
    beforeEach(async () => { tmpDir = makeTmpDir(); await fsp.mkdir(tmpDir, { recursive: true }) })
    afterEach(() => fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {}))

    it('backup() is a no-op before load', async () => {
        const backupDir = path.join(tmpDir, 'backups')
        const mf = makeFile(tmpDir, { backupDir })
        await assert.doesNotReject(() => mf.backup())
    })

    it('backup() creates a timestamped file in backupDir', async () => {
        const backupDir = path.join(tmpDir, 'backups')
        const mf = makeFile(tmpDir, { backupDir })
        await mf.load()
        await mf.backup()
        const entries = await fsp.readdir(backupDir)
        assert.equal(entries.length, 1)
        assert.ok(entries[0].startsWith('data-') && entries[0].endsWith('.json'))
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
        assert.ok(entries.length <= 2, `expected ≤2 backups after pruning, got ${entries.length}`)
    })

    it('automatic backup triggers during flush when backupIntervalMs has elapsed', async () => {
        const backupDir = path.join(tmpDir, 'backups')
        const mf = makeFile(tmpDir, { backupDir, backupIntervalMs: 0 })
        await mf.load()
        await mf.set({ items: [99] })
        await mf.flush()
        await wait(100)  // let async backup complete

        const entries = await fsp.readdir(backupDir).catch(() => [])
        assert.ok(entries.length >= 1, 'expected automatic backup after flush')
    })

    it('creates initial backup on first load when no existing backup', async () => {
        const backupDir = path.join(tmpDir, 'backups')
        await fsp.writeFile(path.join(tmpDir, 'data.json'), JSON.stringify({ items: ['loaded'] }))
        const mf = makeFile(tmpDir, { backupDir })
        await mf.load()
        await wait(100)  // _ensureInitialBackup is async

        const entries = await fsp.readdir(backupDir).catch(() => [])
        assert.ok(entries.length >= 1, 'should have created initial backup on first load')
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
        assert.equal(entries.length, 1, 'should not have added a second backup')
    })
})
