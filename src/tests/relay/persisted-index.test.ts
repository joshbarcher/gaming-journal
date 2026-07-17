// Fast-boot cache helper (shared/persisted-index.js) — the boot-redesign core.
// Verifies: first boot builds+persists; later boots load the sidecar in one read
// and refresh in the background; a corrupt/missing sidecar falls back to a full
// rebuild; writes are atomic; ensureLoaded is idempotent.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createPersistedIndex } from '../../lib/server/relay/shared/persisted-index.js'

let dir: string
const sidecar = () => path.join(dir, 'idx.json')
const settle = () => new Promise(r => setTimeout(r, 20))

beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'gj-pindex-')) })
afterEach(async () => { vi.restoreAllMocks(); await rm(dir, { recursive: true, force: true }) })

describe('createPersistedIndex', () => {
    it('first boot (no sidecar) awaits the rebuild, serves it, and persists a sidecar', async () => {
        const rebuild = vi.fn(async () => [{ appid: 1 }, { appid: 2 }])
        const idx = createPersistedIndex({ name: 't', file: sidecar, rebuild })

        await idx.boot()
        expect(rebuild).toHaveBeenCalledTimes(1)
        expect(idx.get()).toEqual([{ appid: 1 }, { appid: 2 }])

        const persisted = JSON.parse(await readFile(sidecar(), 'utf8'))
        expect(persisted.index).toEqual([{ appid: 1 }, { appid: 2 }])
        expect(typeof persisted.builtAt).toBe('string')
    })

    it('later boot loads the sidecar in one read and refreshes in the background', async () => {
        await writeFile(sidecar(), JSON.stringify({ builtAt: '2026-01-01T00:00:00Z', index: [{ appid: 9 }] }))
        // Slow rebuild so the background refresh is still in flight right after boot().
        const rebuild = vi.fn(async () => { await settle(); return [{ appid: 9 }, { appid: 10 }] })
        const idx = createPersistedIndex({ name: 't', file: sidecar, rebuild })

        await idx.boot()
        // Served instantly from the sidecar — the refresh hasn't finished yet.
        expect(idx.get()).toEqual([{ appid: 9 }])
        expect(idx.meta().builtAt).toBe('2026-01-01T00:00:00Z')

        // Background refresh eventually swaps the fresh index in + re-persists.
        await settle(); await settle()
        expect(rebuild).toHaveBeenCalledTimes(1)
        expect(idx.get()).toEqual([{ appid: 9 }, { appid: 10 }])
        const persisted = JSON.parse(await readFile(sidecar(), 'utf8'))
        expect(persisted.index).toEqual([{ appid: 9 }, { appid: 10 }])
    })

    it('a corrupt sidecar falls back to a full rebuild rather than serving garbage', async () => {
        await writeFile(sidecar(), '{ this is not json')
        const rebuild = vi.fn(async () => [{ appid: 42 }])
        const idx = createPersistedIndex({ name: 't', file: sidecar, rebuild })

        await idx.boot()
        expect(rebuild).toHaveBeenCalledTimes(1)
        expect(idx.get()).toEqual([{ appid: 42 }])
    })

    it('a sidecar missing the index array is treated as absent', async () => {
        await writeFile(sidecar(), JSON.stringify({ builtAt: 'x' })) // no `index`
        const rebuild = vi.fn(async () => [{ appid: 7 }])
        const idx = createPersistedIndex({ name: 't', file: sidecar, rebuild })
        await idx.boot()
        expect(rebuild).toHaveBeenCalledTimes(1)
        expect(idx.get()).toEqual([{ appid: 7 }])
    })

    it('ensureLoaded builds once and coalesces concurrent callers', async () => {
        let calls = 0
        const rebuild = vi.fn(async () => { calls++; await settle(); return [{ appid: calls }] })
        const idx = createPersistedIndex({ name: 't', file: sidecar, rebuild })

        await Promise.all([idx.ensureLoaded(), idx.ensureLoaded(), idx.ensureLoaded()])
        expect(rebuild).toHaveBeenCalledTimes(1)
        expect(idx.get()).toEqual([{ appid: 1 }])
        // Already loaded — a later ensureLoaded is a no-op.
        await idx.ensureLoaded()
        expect(rebuild).toHaveBeenCalledTimes(1)
    })

    it('get() is [] before any load; meta() reports count/builtAt/refreshing', async () => {
        const idx = createPersistedIndex({ name: 't', file: sidecar, rebuild: async () => [] })
        expect(idx.get()).toEqual([])
        expect(idx.meta()).toEqual({ builtAt: null, refreshing: false, count: 0 })
    })

    it('refresh coalesces — a second call during an in-flight rebuild is a no-op', async () => {
        let running = 0, maxConcurrent = 0
        const rebuild = vi.fn(async () => {
            running++; maxConcurrent = Math.max(maxConcurrent, running)
            await settle(); running--; return [{ appid: 1 }]
        })
        const idx = createPersistedIndex({ name: 't', file: sidecar, rebuild })
        await Promise.all([idx.refresh(), idx.refresh(), idx.refresh()])
        expect(maxConcurrent).toBe(1)
    })
})
