import { describe, it, beforeEach, afterEach, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { JournalService } from '../lib/server/services/journalService.js'
import type { ListPage, ProgressPage, NotesPage, ContentPage } from '../lib/types.js'

function tmpPath() {
    return path.join(os.tmpdir(), `journal-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
}

async function cleanup(filePath: string) {
    await fsp.unlink(filePath).catch(() => {})
    await fsp.unlink(filePath + '.checkpoint.json').catch(() => {})
}

describe('JournalService', () => {
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

    describe('initial state', () => {
        it('starts with an empty pages array', () => {
            expect(service.getAll()).toEqual([])
        })
    })

    describe('create', () => {
        it('returns a page with a generated id', async () => {
            const page = await service.create({ type: 'notes', title: 'Research' })
            expect(page.id).toBeTruthy()
            expect(typeof page.id).toBe('string')
        })

        it('sets type and title from input', async () => {
            const page = await service.create({ type: 'notes', title: 'Research' })
            expect(page.type).toBe('notes')
            expect(page.title).toBe('Research')
        })

        it('applies type defaults for list', async () => {
            const page = await service.create({ type: 'list', title: 'Topics' }) as ListPage
            expect(page.ordered).toBe(true)
            expect(page.items).toEqual([])
        })

        it('applies type defaults for progress', async () => {
            const page = await service.create({ type: 'progress', title: 'Goals' }) as ProgressPage
            expect(page.tasks).toEqual([])
        })

        it('applies type defaults for notes', async () => {
            const page = await service.create({ type: 'notes', title: 'Things' }) as NotesPage
            expect(page.notes).toEqual([])
        })

        it('applies type defaults for page', async () => {
            const page = await service.create({ type: 'page', title: 'Journal' }) as ContentPage
            expect(page.content).toBe('')
        })

        it('sets createdAt and updatedAt as ISO strings', async () => {
            const page = await service.create({ type: 'notes', title: 'X' })
            expect(new Date(page.createdAt).getTime()).toBeTruthy()
            expect(new Date(page.updatedAt).getTime()).toBeTruthy()
        })

        it('adds the page to getAll()', async () => {
            await service.create({ type: 'notes', title: 'A' })
            await service.create({ type: 'notes', title: 'B' })
            expect(service.getAll().length).toBe(2)
        })

        it('allows extra fields on create', async () => {
            const page = await service.create({ type: 'list', title: 'T', ordered: false }) as ListPage
            expect(page.ordered).toBe(false)
        })
    })

    describe('getById', () => {
        it('finds a page by id', async () => {
            const created = await service.create({ type: 'notes', title: 'Find me' })
            const found = service.getById(created.id)
            expect(found!.title).toBe('Find me')
        })

        it('returns null for unknown id', () => {
            expect(service.getById('nonexistent')).toBeNull()
        })
    })

    describe('update', () => {
        it('updates allowed fields', async () => {
            const page = await service.create({ type: 'notes', title: 'Original' })
            const updated = await service.update(page.id, { title: 'Updated' })
            expect(updated!.title).toBe('Updated')
        })

        it('refreshes updatedAt', async () => {
            const page = await service.create({ type: 'notes', title: 'X' })
            await new Promise(r => setTimeout(r, 5))
            const updated = await service.update(page.id, { title: 'Y' })
            expect(updated!.updatedAt >= page.updatedAt).toBe(true)
        })

        it('does not change type even if sent', async () => {
            const page = await service.create({ type: 'notes', title: 'X' })
            const updated = await service.update(page.id, { type: 'page', title: 'Y' })
            expect(updated!.type).toBe('notes')
        })

        it('does not change id even if sent', async () => {
            const page = await service.create({ type: 'notes', title: 'X' })
            const updated = await service.update(page.id, { id: 'hacked', title: 'Y' })
            expect(updated!.id).toBe(page.id)
        })

        it('does not change createdAt even if sent', async () => {
            const page = await service.create({ type: 'notes', title: 'X' })
            const updated = await service.update(page.id, { createdAt: '1970-01-01T00:00:00.000Z' })
            expect(updated!.createdAt).toBe(page.createdAt)
        })

        it('returns null for unknown id', async () => {
            const result = await service.update('nonexistent', { title: 'Y' })
            expect(result).toBeNull()
        })
    })

    describe('remove', () => {
        it('removes a page and returns true', async () => {
            const page = await service.create({ type: 'notes', title: 'Delete me' })
            const result = await service.remove(page.id)
            expect(result).toBe(true)
            expect(service.getById(page.id)).toBeNull()
        })

        it('returns false for unknown id', async () => {
            const result = await service.remove('nonexistent')
            expect(result).toBe(false)
        })

        it('does not affect other pages when one is removed', async () => {
            const a = await service.create({ type: 'notes', title: 'A' })
            const b = await service.create({ type: 'notes', title: 'B' })
            await service.remove(a.id)
            expect(service.getAll().length).toBe(1)
            expect(service.getAll()[0].id).toBe(b.id)
        })
    })

    describe('persistence', () => {
        it('reloads pages from disk after flush', async () => {
            const page = await service.create({ type: 'notes', title: 'Persisted' })
            await service.flush()

            const service2 = new JournalService(filePath)
            await service2.load()
            const found = service2.getById(page.id)
            expect(found).toBeTruthy()
            expect(found!.title).toBe('Persisted')
            await service2.close()
        })
    })
})
