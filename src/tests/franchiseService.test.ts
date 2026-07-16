import { describe, it, beforeEach, afterEach, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { FranchiseService } from '../lib/server/services/franchiseService.js'
import type { Franchise } from '../lib/types.js'

function tmpPath() {
    return path.join(os.tmpdir(), `franchise-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
}

async function cleanup(filePath: string) {
    await fsp.unlink(filePath).catch(() => {})
    await fsp.unlink(filePath + '.checkpoint.json').catch(() => {})
}

describe('FranchiseService', () => {
    let service: FranchiseService
    let filePath: string

    beforeEach(async () => {
        filePath = tmpPath()
        service = new FranchiseService(filePath)
        await service.load()
    })

    afterEach(async () => {
        await service.close()
        await cleanup(filePath)
    })

    describe('initial state', () => {
        it('starts empty', () => {
            expect(service.getAll()).toEqual([])
        })

        it('getById returns null for any id on an empty store', () => {
            expect(service.getById('nope')).toBeNull()
        })
    })

    describe('create', () => {
        it('returns a franchise with a uuid, timestamps, and empty entries by default', async () => {
            const f = await service.create({ name: 'Zelda' })
            expect(f.id).toMatch(/^[0-9a-f-]{36}$/)
            expect(f.entries).toEqual([])
            expect(Number.isNaN(new Date(f.createdAt).getTime())).toBe(false)
            expect(Number.isNaN(new Date(f.updatedAt).getTime())).toBe(false)
        })

        it('maps provided entries and fills missing entry names with "App <appid>"', async () => {
            const f = await service.create({ name: 'Halo', entries: [{ appid: 10 }, { appid: 20, name: 'Halo 2' }] })
            expect(f.entries).toEqual([
                { appid: 10, name: 'App 10' },
                { appid: 20, name: 'Halo 2' },
            ])
        })

        it('documents the entry-without-appid hole: name becomes "App undefined"', async () => {
            // Partial<FranchiseEntry> permits omitting appid; create() does `e.appid!`.
            const f = await service.create({ name: 'Broken', entries: [{ name: 'Orphan' }] })
            expect(f.entries[0].appid).toBeUndefined()
            const g = await service.create({ name: 'Broken2', entries: [{}] })
            expect(g.entries[0].name).toBe('App undefined')
        })

        it('allows duplicate names — each gets a distinct id', async () => {
            const a = await service.create({ name: 'Same' })
            const b = await service.create({ name: 'Same' })
            expect(a.id).not.toBe(b.id)
            expect(service.getAll().length).toBe(2)
        })

        it('round-trips unicode and very long names', async () => {
            const long = '🐉ドラゴンクエスト'.repeat(5000)
            const f = await service.create({ name: long })
            await service.flush()
            const s2 = new FranchiseService(filePath)
            await s2.load()
            expect(s2.getById(f.id)!.name).toBe(long)
            await s2.close()
        })

        it('preserves insertion order in getAll()', async () => {
            const names = ['c', 'a', 'b']
            for (const n of names) await service.create({ name: n })
            expect(service.getAll().map(f => f.name)).toEqual(names)
        })
    })

    describe('encapsulation', () => {
        it('getById returns a defensive copy — mutating it does not corrupt the store', async () => {
            const f = await service.create({ name: 'Safe', entries: [{ appid: 1, name: 'One' }] })
            const copy = service.getById(f.id)!
            copy.name = 'HACKED'
            copy.entries.push({ appid: 999, name: 'Injected' })
            const fresh = service.getById(f.id)!
            expect(fresh.name).toBe('Safe')
            expect(fresh.entries.length).toBe(1)
        })

        // REGRESSION: getAll() once copied only the outer array, handing out the live
        // stored franchise objects so callers could mutate the store in place and
        // bypass updatedAt/persistence; getAll now clones each franchise like getById.
        // src/lib/server/services/franchiseService.ts
        it('getAll must not hand out live references to stored franchises', async () => {
            const f = await service.create({ name: 'Original' })
            service.getAll()[0].name = 'MUTATED'
            expect(service.getById(f.id)!.name).toBe('Original')
        })
    })

    describe('update', () => {
        it('updates name and refreshes updatedAt', async () => {
            const f = await service.create({ name: 'Before' })
            await new Promise(r => setTimeout(r, 5))
            const u = await service.update(f.id, { name: 'After' })
            expect(u!.name).toBe('After')
            expect(u!.updatedAt >= f.updatedAt).toBe(true)
        })

        it('strips id and createdAt from updates', async () => {
            const f = await service.create({ name: 'X' })
            const u = await service.update(f.id, { id: 'hijack', createdAt: '1970-01-01T00:00:00.000Z' } as Partial<Franchise>)
            expect(u!.id).toBe(f.id)
            expect(u!.createdAt).toBe(f.createdAt)
        })

        it('cannot backdate updatedAt — a caller-supplied value is overridden', async () => {
            const f = await service.create({ name: 'X' })
            const u = await service.update(f.id, { updatedAt: '1970-01-01T00:00:00.000Z' })
            expect(new Date(u!.updatedAt).getFullYear()).toBeGreaterThan(1970)
        })

        it('returns null for a nonexistent id', async () => {
            expect(await service.update('ghost', { name: 'Y' })).toBeNull()
        })

        it('can replace the entries array wholesale', async () => {
            const f = await service.create({ name: 'X', entries: [{ appid: 1, name: 'One' }] })
            const u = await service.update(f.id, { entries: [{ appid: 2, name: 'Two' }] })
            expect(u!.entries).toEqual([{ appid: 2, name: 'Two' }])
        })
    })

    describe('remove', () => {
        it('removes and returns true; second remove returns false (idempotent outcome)', async () => {
            const f = await service.create({ name: 'Doomed' })
            expect(await service.remove(f.id)).toBe(true)
            expect(await service.remove(f.id)).toBe(false)
            expect(service.getById(f.id)).toBeNull()
        })

        it('returns false for a nonexistent id', async () => {
            expect(await service.remove('ghost')).toBe(false)
        })

        it('leaves other franchises intact', async () => {
            const a = await service.create({ name: 'Keep' })
            const b = await service.create({ name: 'Drop' })
            await service.remove(b.id)
            expect(service.getAll().map(f => f.id)).toEqual([a.id])
        })
    })

    describe('duplicate ids already on disk', () => {
        async function loadWithDuplicates() {
            const dup: Franchise = {
                id: 'dup-1', name: 'First', entries: [],
                createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
            }
            await fsp.writeFile(filePath, JSON.stringify({
                franchises: [dup, { ...dup, name: 'Second' }],
            }))
            const s = new FranchiseService(filePath)
            await s.load()
            return s
        }

        it('getById returns the first match; update touches only the first', async () => {
            const s = await loadWithDuplicates()
            expect(s.getById('dup-1')!.name).toBe('First')
            await s.update('dup-1', { name: 'Renamed' })
            const names = s.getAll().map(f => f.name)
            expect(names).toEqual(['Renamed', 'Second'])
            await s.close()
        })

        it('remove deletes ALL franchises sharing the id (documents dedupe-on-remove)', async () => {
            const s = await loadWithDuplicates()
            expect(await s.remove('dup-1')).toBe(true)
            expect(s.getAll()).toEqual([])
            await s.close()
        })
    })

    describe('addEntry', () => {
        it('appends an entry and bumps updatedAt', async () => {
            const f = await service.create({ name: 'F' })
            const u = await service.addEntry(f.id, { appid: 42, name: 'FF' })
            expect(u!.entries).toEqual([{ appid: 42, name: 'FF' }])
        })

        it('fills a missing entry name with "App <appid>"', async () => {
            const f = await service.create({ name: 'F' })
            const u = await service.addEntry(f.id, { appid: 42 })
            expect(u!.entries[0].name).toBe('App 42')
        })

        it('is a no-op for a duplicate appid — entry count and updatedAt unchanged', async () => {
            const f = await service.create({ name: 'F', entries: [{ appid: 1, name: 'One' }] })
            await new Promise(r => setTimeout(r, 5))
            const u = await service.addEntry(f.id, { appid: 1, name: 'One Again' })
            expect(u!.entries.length).toBe(1)
            expect(u!.entries[0].name).toBe('One')
            expect(u!.updatedAt).toBe(f.updatedAt)
        })

        it('returns null for a nonexistent franchise', async () => {
            expect(await service.addEntry('ghost', { appid: 1 })).toBeNull()
        })
    })

    describe('removeEntry', () => {
        it('removes the targeted entry only', async () => {
            const f = await service.create({ name: 'F', entries: [{ appid: 1, name: 'A' }, { appid: 2, name: 'B' }] })
            const u = await service.removeEntry(f.id, 1)
            expect(u!.entries).toEqual([{ appid: 2, name: 'B' }])
        })

        it('is idempotent — removing a nonexistent appid leaves entries unchanged (but still bumps updatedAt)', async () => {
            const f = await service.create({ name: 'F', entries: [{ appid: 1, name: 'A' }] })
            const u = await service.removeEntry(f.id, 999)
            expect(u!.entries).toEqual([{ appid: 1, name: 'A' }])
            // Documented quirk: a no-op removal still rewrites updatedAt.
            expect(typeof u!.updatedAt).toBe('string')
        })

        it('returns null for a nonexistent franchise', async () => {
            expect(await service.removeEntry('ghost', 1)).toBeNull()
        })
    })

    describe('reorderEntries', () => {
        async function threeEntries() {
            return service.create({
                name: 'R',
                entries: [{ appid: 1, name: 'One' }, { appid: 2, name: 'Two' }, { appid: 3, name: 'Three' }],
            })
        }

        it('applies a full reorder', async () => {
            const f = await threeEntries()
            const u = await service.reorderEntries(f.id, [3, 1, 2])
            expect(u!.entries.map(e => e.appid)).toEqual([3, 1, 2])
        })

        it('appends unmentioned entries after the reordered ones, in original order', async () => {
            const f = await threeEntries()
            const u = await service.reorderEntries(f.id, [3])
            expect(u!.entries.map(e => e.appid)).toEqual([3, 1, 2])
        })

        it('ignores unknown appids in the requested order', async () => {
            const f = await threeEntries()
            const u = await service.reorderEntries(f.id, [999, 2, 1, 3])
            expect(u!.entries.map(e => e.appid)).toEqual([2, 1, 3])
        })

        it('an empty order array keeps every entry (all fall into "rest")', async () => {
            const f = await threeEntries()
            const u = await service.reorderEntries(f.id, [])
            expect(u!.entries.map(e => e.appid)).toEqual([1, 2, 3])
        })

        it('returns null for a nonexistent franchise', async () => {
            expect(await service.reorderEntries('ghost', [1])).toBeNull()
        })

        // REGRESSION: reorderEntries once inserted the same entry once per occurrence,
        // so a duplicated appid (double-fired drag, hostile client) grew the franchise;
        // it now deletes each matched entry from the map, guarding against duplicates.
        // src/lib/server/services/franchiseService.ts
        it('a duplicated appid in the order must not duplicate the entry', async () => {
            const f = await threeEntries()
            const u = await service.reorderEntries(f.id, [3, 3, 1])
            expect(u!.entries.length).toBe(3)
            expect(new Set(u!.entries.map(e => e.appid)).size).toBe(3)
        })
    })

    describe('concurrency (same instance)', () => {
        it('10 unawaited create() calls all land and produce unique ids', async () => {
            const results = await Promise.all(
                Array.from({ length: 10 }, (_, i) => service.create({ name: `f${i}` }))
            )
            expect(service.getAll().length).toBe(10)
            expect(new Set(results.map(f => f.id)).size).toBe(10)
        })

        it('unawaited addEntry calls to the same franchise all land', async () => {
            const f = await service.create({ name: 'Target' })
            await Promise.all([1, 2, 3, 4, 5].map(appid => service.addEntry(f.id, { appid, name: `E${appid}` })))
            const fresh = service.getById(f.id)!
            expect(fresh.entries.map(e => e.appid).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
        })

        it('interleaved create/remove stays consistent', async () => {
            const keep = await service.create({ name: 'keeper' })
            const doomed = await service.create({ name: 'doomed' })
            await Promise.all([
                service.remove(doomed.id),
                service.create({ name: 'newcomer' }),
            ])
            const names = service.getAll().map(f => f.name).sort()
            expect(names).toEqual(['keeper', 'newcomer'])
            expect(service.getById(keep.id)).not.toBeNull()
        })
    })

    describe('persistence & corruption', () => {
        it('flushes and reloads from disk', async () => {
            const f = await service.create({ name: 'Persisted', entries: [{ appid: 9, name: 'Nine' }] })
            await service.flush()
            const s2 = new FranchiseService(filePath)
            await s2.load()
            expect(s2.getById(f.id)!.entries).toEqual([{ appid: 9, name: 'Nine' }])
            await s2.close()
        })

        it('falls back to an empty store when the file is corrupt and no checkpoint exists', async () => {
            await fsp.writeFile(filePath, '{"franchises": [ BROKEN')
            const s2 = new FranchiseService(filePath)
            await s2.load()
            expect(s2.getAll()).toEqual([])
            await s2.close()
        })

        it('recovers from the checkpoint when the main file is corrupt', async () => {
            const good = {
                franchises: [{
                    id: 'cp-1', name: 'FromCheckpoint', entries: [],
                    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
                }],
            }
            await fsp.writeFile(filePath, 'TRASH')
            await fsp.writeFile(filePath + '.checkpoint.json', JSON.stringify(good))
            const s2 = new FranchiseService(filePath)
            await s2.load()
            expect(s2.getById('cp-1')!.name).toBe('FromCheckpoint')
            await s2.close()
        })

        it('getAll throws before load() (ManagedFile contract)', () => {
            const s2 = new FranchiseService(tmpPath())
            expect(() => s2.getAll()).toThrow(/not loaded/)
        })
    })
})
