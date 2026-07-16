import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import os   from 'node:os'
import path from 'node:path'
import fsp  from 'node:fs/promises'
import { ManagedFile } from '../lib/server/shared/managed-file.js'

// Adversarial/edge tests for the paths the base suite doesn't reach:
// error recovery, checkpoint corruption, write-queue collapsing,
// concurrent load/save, and shutdown during pending writes.

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir() {
    return path.join(os.tmpdir(), `mf-edge-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

function wait(ms: number) { return new Promise(r => setTimeout(r, ms)) }

function makeFile(tmpDir: string, overrides: Record<string, any> = {}) {
    return new ManagedFile<{ items: unknown[] }>({
        filePath:     path.join(tmpDir, 'data.json'),
        name:         'edge',
        defaultValue: () => ({ items: [] }),
        log:          () => {},
        ...overrides,
    })
}

async function readDisk(tmpDir: string) {
    return JSON.parse(await fsp.readFile(path.join(tmpDir, 'data.json'), 'utf8'))
}

let tmpDir: string
beforeEach(async () => {
    tmpDir = makeTmpDir()
    await fsp.mkdir(tmpDir, { recursive: true })
})
afterEach(async () => {
    vi.restoreAllMocks()
    // give stray async checkpoint/backup writes a beat before cleanup
    await wait(20)
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
})

// ── Checkpoint corruption / unreadable-main recovery chain ────────────────────

describe('ManagedFile — corruption recovery chain', () => {
    it('main corrupt AND checkpoint corrupt → default value, loadSource "default"', async () => {
        await fsp.writeFile(path.join(tmpDir, 'data.json'),                 '{oops')
        await fsp.writeFile(path.join(tmpDir, 'data.json.checkpoint.json'), 'ALSO BAD')
        const mf = makeFile(tmpDir)
        await mf.load()
        expect(mf.get()).toEqual({ items: [] })
        expect(mf.getStats().loadSource).toBe('default')
        expect(mf.getStats().recoveryUsedOnLoad).toBe(false)
    })

    it('zero-byte main file is treated as corrupt and falls back to checkpoint', async () => {
        await fsp.writeFile(path.join(tmpDir, 'data.json'), '')
        await fsp.writeFile(
            path.join(tmpDir, 'data.json.checkpoint.json'),
            JSON.stringify({ items: ['rescued'] })
        )
        const mf = makeFile(tmpDir)
        await mf.load()
        expect(mf.get().items).toEqual(['rescued'])
        expect(mf.getStats().loadSource).toBe('checkpoint')
        expect(mf.getStats().recoveryUsedOnLoad).toBe(true)
    })

    it('non-ENOENT read error on main (path is a directory) falls back to checkpoint', async () => {
        await fsp.mkdir(path.join(tmpDir, 'data.json'))
        await fsp.writeFile(
            path.join(tmpDir, 'data.json.checkpoint.json'),
            JSON.stringify({ items: ['from-cp'] })
        )
        const mf = makeFile(tmpDir)
        await mf.load()
        expect(mf.get().items).toEqual(['from-cp'])
        expect(mf.getStats().recoveryUsedOnLoad).toBe(true)
    })

    it('non-ENOENT read error on main with checkpoint disabled rejects load()', async () => {
        await fsp.mkdir(path.join(tmpDir, 'data.json'))
        const mf = makeFile(tmpDir, { enableCheckpoint: false })
        await expect(mf.load()).rejects.toThrow()
        expect(() => mf.get()).toThrow(/not loaded/)
    })

    it('checkpoint read error (checkpoint path is a directory) → default value', async () => {
        await fsp.writeFile(path.join(tmpDir, 'data.json'), '{bad json')
        await fsp.mkdir(path.join(tmpDir, 'data.json.checkpoint.json'))
        const mf = makeFile(tmpDir)
        await mf.load()
        expect(mf.get()).toEqual({ items: [] })
        expect(mf.getStats().loadSource).toBe('default')
    })

    it('a failed load() can be retried after the file is repaired', async () => {
        const filePath = path.join(tmpDir, 'data.json')
        await fsp.writeFile(filePath, 'NOT JSON')
        const mf = makeFile(tmpDir, { enableCheckpoint: false })

        await expect(mf.load()).rejects.toThrow()

        await fsp.writeFile(filePath, JSON.stringify({ items: ['repaired'] }))
        await mf.load()
        expect(mf.get().items).toEqual(['repaired'])
    })
})

// ── Concurrent load ───────────────────────────────────────────────────────────

describe('ManagedFile — concurrent load', () => {
    it('two concurrent load() calls share one read/parse', async () => {
        await fsp.writeFile(path.join(tmpDir, 'data.json'), JSON.stringify({ items: [1] }))
        let parseCalls = 0
        const mf = makeFile(tmpDir, {
            parse: (s: string) => { parseCalls++; return JSON.parse(s) },
        })

        await Promise.all([mf.load(), mf.load(), mf.load()])
        expect(parseCalls).toBe(1)
        expect(mf.get()).toEqual({ items: [1] })
    })

    it('load() after a completed load ignores newer disk content (in-memory wins)', async () => {
        const filePath = path.join(tmpDir, 'data.json')
        await fsp.writeFile(filePath, JSON.stringify({ items: ['v1'] }))
        const mf = makeFile(tmpDir)
        await mf.load()

        await fsp.writeFile(filePath, JSON.stringify({ items: ['v2-external'] }))
        await mf.load()
        expect(mf.get().items).toEqual(['v1'])
    })

    it('concurrent rejecting loads reject both callers with the same failure', async () => {
        await fsp.writeFile(path.join(tmpDir, 'data.json'), 'BAD')
        const mf = makeFile(tmpDir, { enableCheckpoint: false })
        const p1 = mf.load()
        const p2 = mf.load()
        await expect(p1).rejects.toThrow()
        await expect(p2).rejects.toThrow()
    })
})

// ── Write failure, retry, and recovery ────────────────────────────────────────

describe('ManagedFile — write failure and recovery', () => {
    it('transient rename failure is retried and the flush succeeds', async () => {
        const mf = makeFile(tmpDir, { retryDelays: [1, 1] })
        await mf.load()
        await mf.set({ items: ['retry-me'] })

        vi.spyOn(fsp, 'rename').mockRejectedValueOnce(new Error('EBUSY: locked'))

        await mf.flush()
        expect(await readDisk(tmpDir)).toEqual({ items: ['retry-me'] })
        expect(mf.getStats().writeCount).toBe(1)
        expect(mf.getStats().dirty).toBe(false)
    })

    it('persistent write failure rejects flush, keeps dirty=true, and recovers later', async () => {
        const mf = makeFile(tmpDir, { retryDelays: [1, 1] })
        await mf.load()
        await mf.set({ items: ['blocked'] })

        const spy = vi.spyOn(fsp, 'rename').mockRejectedValue(new Error('EACCES: denied'))
        await expect(mf.flush()).rejects.toThrow(/EACCES/)

        const stats = mf.getStats()
        expect(stats.dirty).toBe(true)
        expect(stats.writeCount).toBe(0)
        expect(stats.lastFlushedAt).toBeNull()

        // error recovery: restore the FS and flush again
        spy.mockRestore()
        await mf.flush()
        expect(await readDisk(tmpDir)).toEqual({ items: ['blocked'] })
        expect(mf.getStats().writeCount).toBe(1)
        expect(mf.getStats().dirty).toBe(false)
    })

    it('retryDelays: [] means exactly one write attempt', async () => {
        const mf = makeFile(tmpDir, { retryDelays: [], enableCheckpoint: false })
        await mf.load()
        await mf.set({ items: [1] })

        const spy = vi.spyOn(fsp, 'rename').mockRejectedValue(new Error('nope'))
        await expect(mf.flush()).rejects.toThrow('nope')
        expect(spy).toHaveBeenCalledTimes(1)
    })

    it('failed writes leave no .tmp litter behind', async () => {
        const mf = makeFile(tmpDir, { retryDelays: [], enableCheckpoint: false })
        await mf.load()
        await mf.set({ items: [1] })

        vi.spyOn(fsp, 'rename').mockRejectedValue(new Error('fail'))
        await expect(mf.flush()).rejects.toThrow()

        const entries = await fsp.readdir(tmpDir)
        expect(entries.filter(e => e.endsWith('.tmp'))).toEqual([])
    })

    it('a failing SCHEDULED flush logs an error, stays dirty, and a manual flush recovers', async () => {
        const errors: string[] = []
        const mf = makeFile(tmpDir, {
            maxFlushIntervalMs: 20,
            retryDelays: [1],
            log: (level: string, msg: string) => { if (level === 'error') errors.push(msg) },
        })
        await mf.load()

        const spy = vi.spyOn(fsp, 'rename').mockRejectedValue(new Error('disk full'))
        await mf.set({ items: ['scheduled'] })
        await wait(120) // let the timer fire and fail

        expect(errors.some(m => /Scheduled flush failed/.test(m))).toBe(true)
        expect(mf.getStats().dirty).toBe(true)

        spy.mockRestore()
        await mf.flush()
        expect(await readDisk(tmpDir)).toEqual({ items: ['scheduled'] })
    })
})

// ── Write-queue collapsing ────────────────────────────────────────────────────

describe('ManagedFile — write-queue collapsing', () => {
    function slowRename(delayMs: number) {
        const real = fsp.rename
        return vi.spyOn(fsp, 'rename').mockImplementation(async (a: any, b: any) => {
            await wait(delayMs)
            return real.call(fsp, a, b)
        })
    }

    it('two concurrent flush() calls collapse into a single disk write', async () => {
        const mf = makeFile(tmpDir, { enableCheckpoint: false })
        await mf.load()
        await mf.set({ items: ['once'] })

        slowRename(40)
        const p1 = mf.flush()
        const p2 = mf.flush()
        await Promise.all([p1, p2])

        expect(mf.getStats().writeCount).toBe(1)
        expect(await readDisk(tmpDir)).toEqual({ items: ['once'] })
    })

    it('set() during an in-flight flush queues a second write with the newer value', async () => {
        const mf = makeFile(tmpDir, { enableCheckpoint: false })
        await mf.load()
        await mf.set({ items: ['A'] })

        slowRename(40)
        const p1 = mf.flush()
        await wait(10)              // let _doFlush serialize A and start the slow rename
        await mf.set({ items: ['B'] })
        const p2 = mf.flush()
        await Promise.all([p1, p2])

        expect(mf.getStats().writeCount).toBe(2)
        expect(await readDisk(tmpDir)).toEqual({ items: ['B'] })
    })

    it('a burst of set() calls coalesces into one scheduled write of the final value', async () => {
        const mf = makeFile(tmpDir, { maxFlushIntervalMs: 25, enableCheckpoint: false })
        await mf.load()
        for (let i = 1; i <= 5; i++) {
            await mf.set({ items: [`v${i}`] })
        }
        await wait(150)

        expect(mf.getStats().writeCount).toBe(1)
        expect(mf.getStats().dirty).toBe(false)
        expect(await readDisk(tmpDir)).toEqual({ items: ['v5'] })
    })

    it('a queued flush after an in-flight flush with no new data is a no-op', async () => {
        const mf = makeFile(tmpDir, { enableCheckpoint: false })
        await mf.load()
        await mf.set({ items: [1] })
        await mf.flush()

        // not dirty — flush must not rewrite
        await mf.flush()
        await mf.flush()
        expect(mf.getStats().writeCount).toBe(1)
    })
})

// ── Flush-time audit violation (value mutated after set) ─────────────────────

describe('ManagedFile — flush-time audit violation', () => {
    it('quarantines the data, leaves the real file untouched, and does not throw', async () => {
        let strict = false
        const mf = makeFile(tmpDir, {
            auditMetrics: (v: any) => ({ count: v.items.length }),
            audit: () => strict ? { ok: false, reason: 'flush-time reject' } : { ok: true },
        })
        await mf.load()
        await mf.set({ items: ['good'] })
        await mf.flush()

        // audit passes at set() time, then turns strict before the flush runs
        await mf.set({ items: ['evil'] })
        strict = true
        await expect(mf.flush()).resolves.toBeUndefined()

        // real file untouched
        expect(await readDisk(tmpDir)).toEqual({ items: ['good'] })
        expect(mf.getStats().auditViolationCount).toBe(1)
        expect(mf.getStats().writeCount).toBe(1)

        await wait(30)
        const entries = await fsp.readdir(tmpDir)
        expect(entries.some(e => e.includes('.quarantine-'))).toBe(true)

        // contract: the rejected data is dropped — dirty is NOT restored, so a
        // later flush() will not retry persisting it
        expect(mf.getStats().dirty).toBe(false)
    })

    it('set() audit violation still throws the audit error when the quarantine write itself fails', async () => {
        const mf = makeFile(tmpDir, {
            auditMetrics: (v: any) => ({ count: v.items.length }),
            audit: (prev: any, nv: any) => nv.items.length < prev.count
                ? { ok: false, reason: 'shrink' }
                : { ok: true },
        })
        await mf.load()
        await mf.set({ items: [1, 2] })
        await mf.flush()

        vi.spyOn(fsp, 'rename').mockRejectedValue(new Error('quarantine dir gone'))
        await expect(mf.set({ items: [] })).rejects.toThrow(/Audit violation: shrink/)
        expect(mf.getStats().auditViolationCount).toBe(1)
        // rejected value must not replace the in-memory value
        expect(mf.get().items).toEqual([1, 2])
    })

    it('prunes quarantine files beyond quarantineKeep', async () => {
        const mf = makeFile(tmpDir, {
            quarantineKeep: 2,
            enableCheckpoint: false,
            auditMetrics: (v: any) => ({ count: v.items.length }),
            audit: (prev: any, nv: any) => nv.items.length < prev.count
                ? { ok: false, reason: 'shrink' }
                : { ok: true },
        })
        await mf.load()
        await mf.set({ items: [1, 2, 3] })
        await mf.flush()

        for (let i = 0; i < 4; i++) {
            await expect(mf.set({ items: [] })).rejects.toThrow()
            await wait(15) // distinct quarantine timestamps + let async prune settle
        }
        await wait(50)

        const entries = await fsp.readdir(tmpDir)
        const quarantines = entries.filter(e => e.includes('.quarantine-'))
        expect(quarantines.length).toBeLessThanOrEqual(2)
        expect(quarantines.length).toBeGreaterThan(0)
    })

    it('audit without auditMetrics never fires (contract: prevMetrics stays null)', async () => {
        let auditCalls = 0
        const mf = makeFile(tmpDir, {
            audit: () => { auditCalls++; return { ok: false, reason: 'always reject' } },
        })
        await mf.load()
        // Even a would-be violation sails through because prevMetrics === null
        await expect(mf.set({ items: ['anything'] })).resolves.toBeUndefined()
        await mf.flush()
        expect(auditCalls).toBe(0)
        expect(mf.getStats().auditViolationCount).toBe(0)
        expect(await readDisk(tmpDir)).toEqual({ items: ['anything'] })
    })
})

// ── Shutdown during pending writes ────────────────────────────────────────────

describe('ManagedFile — shutdown during pending write', () => {
    it('close() with a pending scheduled flush persists exactly once and cancels the timer', async () => {
        const mf = makeFile(tmpDir, { maxFlushIntervalMs: 60_000 })
        await mf.load()
        await mf.set({ items: ['pending'] })
        expect(mf.getStats().pendingFlushInMs).not.toBeNull()

        await mf.close()
        expect(await readDisk(tmpDir)).toEqual({ items: ['pending'] })
        expect(mf.getStats().writeCount).toBe(1)
        expect(mf.getStats().pendingFlushInMs).toBeNull()

        // wait past nothing — no stray timer write occurs after close
        await wait(50)
        expect(mf.getStats().writeCount).toBe(1)
    })

    it('close() while a flush is in flight and dirty again writes the newest value', async () => {
        const mf = makeFile(tmpDir, { enableCheckpoint: false })
        await mf.load()
        await mf.set({ items: ['A'] })

        const real = fsp.rename
        vi.spyOn(fsp, 'rename').mockImplementation(async (a: any, b: any) => {
            await wait(40)
            return real.call(fsp, a, b)
        })

        const p1 = mf.flush()
        await wait(10)
        await mf.set({ items: ['B'] })
        await mf.close()
        await p1

        expect(await readDisk(tmpDir)).toEqual({ items: ['B'] })
        expect(mf.getStats().writeCount).toBe(2)
    })

    it('close() awaits the pending checkpoint write', async () => {
        const mf = makeFile(tmpDir) // checkpoint enabled
        await mf.load()
        await mf.set({ items: ['cp'] })
        await mf.close()

        // checkpoint must exist immediately after close resolves — no wait()
        const cp = JSON.parse(
            await fsp.readFile(path.join(tmpDir, 'data.json.checkpoint.json'), 'utf8')
        )
        expect(cp).toEqual({ items: ['cp'] })
    })

    it('close() rejects when the final flush cannot write (contract: caller sees the failure)', async () => {
        const mf = makeFile(tmpDir, { retryDelays: [] })
        await mf.load()
        await mf.set({ items: ['doomed'] })

        vi.spyOn(fsp, 'rename').mockRejectedValue(new Error('device unavailable'))
        await expect(mf.close()).rejects.toThrow('device unavailable')
        expect(mf.getStats().dirty).toBe(true)
    })

    it('double close() is safe and does not double-write', async () => {
        const mf = makeFile(tmpDir)
        await mf.load()
        await mf.set({ items: [1] })
        await mf.close()
        await expect(mf.close()).resolves.toBeUndefined()
        expect(mf.getStats().writeCount).toBe(1)
    })

    it('close() before load() resolves without creating any file', async () => {
        const mf = makeFile(tmpDir)
        await expect(mf.close()).resolves.toBeUndefined()
        await expect(fsp.readFile(path.join(tmpDir, 'data.json'))).rejects.toThrow()
    })
})

// ── Scheduled flush interval semantics ────────────────────────────────────────

describe('ManagedFile — scheduled flush semantics', () => {
    it('the first scheduled flush fires after maxFlushIntervalMs without an explicit flush()', async () => {
        const mf = makeFile(tmpDir, { maxFlushIntervalMs: 25, enableCheckpoint: false })
        await mf.load()
        await mf.set({ items: ['auto'] })
        expect(mf.getStats().dirty).toBe(true)

        await wait(150)
        expect(mf.getStats().dirty).toBe(false)
        expect(await readDisk(tmpDir)).toEqual({ items: ['auto'] })
        await mf.close()
    })

    it('a set() right after a flush schedules the next write a full interval out', async () => {
        const mf = makeFile(tmpDir, { maxFlushIntervalMs: 60_000 })
        await mf.load()
        await mf.set({ items: [1] })
        await mf.flush()

        await mf.set({ items: [2] })
        const pending = mf.getStats().pendingFlushInMs
        expect(pending).not.toBeNull()
        // just flushed → next flush ~a full interval away, not immediate
        expect(pending!).toBeGreaterThan(50_000)
        await mf.flush()
    })
})
