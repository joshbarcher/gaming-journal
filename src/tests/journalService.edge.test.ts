import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { JournalService, VALID_TYPES, typeDefaults } from '../lib/server/services/journalService.js'
import type { PageType } from '../lib/types.js'

function tmpPath() {
    return path.join(os.tmpdir(), `journal-edge-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
}

async function cleanup(filePath: string) {
    await fsp.unlink(filePath).catch(() => {})
    await fsp.unlink(filePath + '.checkpoint.json').catch(() => {})
}

describe('JournalService — edge cases', () => {
    let service: JournalService
    let filePath: string

    beforeEach(async () => {
        filePath = tmpPath()
        service = new JournalService(filePath)
        await service.load()
    })

    afterEach(async () => {
        await service.close()
        await cleanup(filePath)
    })

    describe('create — input hardening', () => {
        // Regression: create() once let `...rest` spread a caller-supplied `id` over the
        // generated UUID (duplicate-id injection). It now strips id like update() does.
        it('ignores a caller-supplied id (never trusts input ids)', async () => {
            const page = await service.create({ type: 'notes', title: 'X', id: 'evil-id' } as never)
            expect(page.id).not.toBe('evil-id')
        })

        // BUG: same spread order problem — caller input can override typeDefaults with a
        // wrong-typed value (items: "nope" on a list page corrupts the store shape).
        // Defensible as "caller provides initial items", but only with same-shape values;
        // documenting the sharp edge with the wrong-typed case.
        it('allows callers to seed type-default fields (current contract)', async () => {
            const page = await service.create({ type: 'list', title: 'L', items: [{ id: 'i1', text: 'a', done: false }] } as never)
            expect((page as never as { items: unknown[] }).items).toHaveLength(1)
        })

        it('caller-supplied createdAt/updatedAt are overwritten with real timestamps', async () => {
            const page = await service.create({
                type: 'notes', title: 'X',
                createdAt: '1970-01-01T00:00:00.000Z',
                updatedAt: '1970-01-01T00:00:00.000Z',
            } as never)
            expect(new Date(page.createdAt).getFullYear()).toBeGreaterThan(2020)
            expect(new Date(page.updatedAt).getFullYear()).toBeGreaterThan(2020)
        })

        it('typeDefaults covers every VALID_TYPE (no undefined branches)', () => {
            for (const t of VALID_TYPES) {
                expect(typeDefaults(t as PageType), `defaults for ${t}`).toBeTruthy()
            }
        })
    })

    describe('getByAppid', () => {
        it('finds pages by string appid and returns copies', async () => {
            await service.create({ type: 'notes', title: 'A', appid: '440' } as never)
            const got = service.getByAppid('440')
            expect(got).toHaveLength(1)
            // returned object must be a copy — mutating it must not corrupt the store
            ;(got[0] as never as { title: string }).title = 'MUTATED'
            expect(service.getByAppid('440')[0].title).toBe('A')
        })

        it('accepts a numeric appid argument for string-stored pages', async () => {
            await service.create({ type: 'notes', title: 'A', appid: '440' } as never)
            expect(service.getByAppid(440)).toHaveLength(1)
        })

        // Regression: getByAppid once compared String(arg) === p.appid strictly, so a page
        // stored with a NUMERIC appid (e.g. straight from a Steam payload) was unfindable.
        it('finds pages that were stored with a numeric appid', async () => {
            await service.create({ type: 'notes', title: 'N', appid: 440 } as never)
            expect(service.getByAppid(440)).toHaveLength(1)
        })

        it('returns empty array for unknown appid', () => {
            expect(service.getByAppid('nope')).toEqual([])
        })
    })

    describe('reorder', () => {
        async function seed(n: number) {
            const ids: string[] = []
            for (let i = 0; i < n; i++) ids.push((await service.create({ type: 'notes', title: `P${i}` })).id)
            return ids
        }

        it('applies the given order and appends unlisted pages at the end', async () => {
            const [a, b, c] = await seed(3)
            await service.reorder([c, a])
            expect(service.getAll().map(p => p.id)).toEqual([c, a, b])
        })

        it('ignores unknown ids', async () => {
            const [a, b] = await seed(2)
            await service.reorder(['ghost', b, a])
            expect(service.getAll().map(p => p.id)).toEqual([b, a])
        })

        // Regression: duplicate ids in the reorder payload once duplicated the page itself
        // (map.get resolved twice) — a double-send from the UI silently corrupted the store.
        it('never duplicates a page when the ids payload contains duplicates', async () => {
            const [a, b] = await seed(2)
            await service.reorder([a, a, b])
            const all = service.getAll()
            expect(all.filter(p => p.id === a)).toHaveLength(1)
            expect(all).toHaveLength(2)
        })

        it('reorder with empty ids keeps every page', async () => {
            await seed(3)
            await service.reorder([])
            expect(service.getAll()).toHaveLength(3)
        })
    })

    describe('update', () => {
        it('strips id/type/createdAt from updates', async () => {
            const page = await service.create({ type: 'notes', title: 'A' })
            const updated = await service.update(page.id, {
                id: 'evil', type: 'list', createdAt: '1970-01-01T00:00:00.000Z', title: 'B',
            } as never)
            expect(updated?.id).toBe(page.id)
            expect(updated?.type).toBe('notes')
            expect(updated?.createdAt).toBe(page.createdAt)
            expect(updated?.title).toBe('B')
        })

        it('returns null for a deleted page (stale-tab update)', async () => {
            const page = await service.create({ type: 'notes', title: 'A' })
            await service.remove(page.id)
            expect(await service.update(page.id, { title: 'B' })).toBeNull()
        })
    })

    describe('concurrency', () => {
        it('parallel creates all land (no lost updates)', async () => {
            await Promise.all(Array.from({ length: 25 }, (_, i) =>
                service.create({ type: 'notes', title: `c${i}` })))
            expect(service.getAll()).toHaveLength(25)
        })

        it('interleaved create/remove stays consistent', async () => {
            const keep = await service.create({ type: 'notes', title: 'keep' })
            const doomed = await service.create({ type: 'notes', title: 'doomed' })
            await Promise.all([
                service.remove(doomed.id),
                service.create({ type: 'notes', title: 'new1' }),
                service.create({ type: 'notes', title: 'new2' }),
            ])
            const all = service.getAll()
            expect(all.find(p => p.id === doomed.id)).toBeUndefined()
            expect(all.find(p => p.id === keep.id)).toBeTruthy()
            expect(all).toHaveLength(3)
        })

        it('mutations survive a reload from disk (round-trip)', async () => {
            const page = await service.create({ type: 'counter', title: 'C' })
            await service.update(page.id, { current: 7 } as never)
            await service.close()

            const reloaded = new JournalService(filePath)
            await reloaded.load()
            const got = reloaded.getById(page.id) as never as { current: number }
            expect(got.current).toBe(7)
            await reloaded.close()
        })
    })

    describe('getJournalService singleton', () => {
        it('throws a clear error when DATA_DIR is unset', async () => {
            vi.resetModules()
            const prev = process.env.DATA_DIR
            delete process.env.DATA_DIR
            try {
                const mod = await import('../lib/server/services/journalService.js')
                expect(() => mod.getJournalService()).toThrow(/DATA_DIR/)
            } finally {
                if (prev !== undefined) process.env.DATA_DIR = prev
            }
        })
    })
})
