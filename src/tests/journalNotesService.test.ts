import { describe, it, beforeEach, afterEach, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { getJournalNotes, setJournalNotes } from '../lib/server/services/journalNotesService.js'
import type { StickyNote } from '../lib/types.js'

function tmpDataDir() {
    return path.join(os.tmpdir(), `jn-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

function note(overrides: Partial<StickyNote> = {}): StickyNote {
    return {
        id:       `n-${Math.random().toString(36).slice(2)}`,
        label:    'Label',
        message:  'Message',
        from:     'me',
        size:     'md',
        color:    'yellow',
        rotation: 2,
        ...overrides,
    }
}

const storePath = (dataDir: string) => path.join(dataDir, 'gaming-journal', 'journal-notes.json')

describe('journalNotesService', () => {
    let dataDir: string
    let savedDataDir: string | undefined

    beforeEach(() => {
        savedDataDir = process.env.DATA_DIR
        dataDir = tmpDataDir()
        process.env.DATA_DIR = dataDir
    })

    afterEach(async () => {
        if (savedDataDir === undefined) delete process.env.DATA_DIR
        else process.env.DATA_DIR = savedDataDir
        await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {})
    })

    describe('environment', () => {
        it('rejects when DATA_DIR is unset', async () => {
            delete process.env.DATA_DIR
            await expect(getJournalNotes('1')).rejects.toThrow(/DATA_DIR/)
            await expect(setJournalNotes('1', [])).rejects.toThrow(/DATA_DIR/)
        })
    })

    describe('empty / missing store', () => {
        it('returns [] for any appid when the file does not exist', async () => {
            expect(await getJournalNotes('570')).toEqual([])
            expect(await getJournalNotes(0)).toEqual([])
        })
    })

    describe('set / get round trips', () => {
        it('persists notes across separate calls', async () => {
            const notes = [note({ message: 'hello' }), note({ message: 'world' })]
            await setJournalNotes('440', notes)
            expect(await getJournalNotes('440')).toEqual(notes)
        })

        it('treats numeric and string appids as the same key', async () => {
            const notes = [note({ message: 'numeric key' })]
            await setJournalNotes(440, notes)
            expect(await getJournalNotes('440')).toEqual(notes)
        })

        it('set fully replaces the list — no merging with previous notes', async () => {
            await setJournalNotes('1', [note({ message: 'old-a' }), note({ message: 'old-b' })])
            const fresh = [note({ message: 'only-one' })]
            await setJournalNotes('1', fresh)
            expect(await getJournalNotes('1')).toEqual(fresh)
        })

        it('setting [] clears the notes for an appid', async () => {
            await setJournalNotes('2', [note()])
            await setJournalNotes('2', [])
            expect(await getJournalNotes('2')).toEqual([])
        })

        it('different appids are fully independent', async () => {
            const a = [note({ message: 'for-a' })]
            const b = [note({ message: 'for-b' })]
            await setJournalNotes('a', a)
            await setJournalNotes('b', b)
            expect(await getJournalNotes('a')).toEqual(a)
            expect(await getJournalNotes('b')).toEqual(b)
        })

        it('preserves note order exactly, including duplicate ids (no dedupe)', async () => {
            const dup = note({ id: 'same-id', message: 'twin' })
            const notes = [dup, note({ message: 'middle' }), { ...dup }]
            await setJournalNotes('3', notes)
            const got = await getJournalNotes('3')
            expect(got.map(n => n.id)).toEqual(['same-id', got[1].id, 'same-id'])
        })

        it('round-trips unicode / emoji text and negative or zero rotation', async () => {
            const notes = [
                note({ label: '📌 ピン', message: 'שלום 🌍 — 𝓯𝓪𝓷𝓬𝔂', rotation: -3 }),
                note({ rotation: 0 }),
            ]
            await setJournalNotes('4', notes)
            expect(await getJournalNotes('4')).toEqual(notes)
        })

        it('round-trips an extremely long message (100k chars)', async () => {
            const notes = [note({ message: 'x'.repeat(100_000) })]
            await setJournalNotes('5', notes)
            expect((await getJournalNotes('5'))[0].message.length).toBe(100_000)
        })

        it('silently degrades NaN rotation to null in the persisted JSON (lossy, documented)', async () => {
            // Same-process reads now come from the shared in-memory instance (NaN intact);
            // the JSON degradation shows up on disk, i.e. what the next process will load.
            await setJournalNotes('6', [note({ rotation: NaN })])
            const onDisk = JSON.parse(await fsp.readFile(storePath(dataDir), 'utf8'))
            expect(onDisk['6'][0].rotation).toBeNull()
        })

        it('preserves extra unknown fields on notes (no schema validation)', async () => {
            const weird = { ...note(), extra: { nested: [1, 2, 3] } } as StickyNote
            await setJournalNotes('7', [weird])
            expect((await getJournalNotes('7'))[0]).toEqual(weird)
        })
    })

    describe('corrupted store on disk', () => {
        it('recovers to an empty store when the file is corrupt JSON and no checkpoint exists', async () => {
            await fsp.mkdir(path.dirname(storePath(dataDir)), { recursive: true })
            await fsp.writeFile(storePath(dataDir), '}}}not json{{{')
            expect(await getJournalNotes('1')).toEqual([])
        })

        it('can write again after corruption and the new data persists', async () => {
            await fsp.mkdir(path.dirname(storePath(dataDir)), { recursive: true })
            await fsp.writeFile(storePath(dataDir), 'garbage')
            const notes = [note({ message: 'recovered' })]
            await setJournalNotes('8', notes)
            expect(await getJournalNotes('8')).toEqual(notes)
        })

        it('prefers the checkpoint over a corrupt main file', async () => {
            const main = storePath(dataDir)
            const notes = [note({ message: 'from-checkpoint' })]
            await fsp.mkdir(path.dirname(main), { recursive: true })
            await fsp.writeFile(main, 'garbage')
            await fsp.writeFile(main + '.checkpoint.json', JSON.stringify({ '9': notes }))
            expect(await getJournalNotes('9')).toEqual(notes)
        })
    })

    describe('prototype-pollution-ish keys', () => {
        // BUG: raw bracket access on a plain-object store — `data['__proto__']` is
        // Object.prototype (truthy), so the `?? []` fallback never fires and the
        // function returns Object.prototype instead of an empty notes array.
        // src/lib/server/services/journalNotesService.ts:22
        it('getJournalNotes("__proto__") on an empty store must return []', async () => {
            expect(await getJournalNotes('__proto__')).toEqual([])
        })

        // BUG: same class — data['constructor'] is the Object constructor function.
        // src/lib/server/services/journalNotesService.ts:22
        it('getJournalNotes("constructor") on an empty store must return []', async () => {
            expect(await getJournalNotes('constructor')).toEqual([])
        })

        // BUG: `data['__proto__'] = notes` goes through the __proto__ setter and swaps
        // the store's prototype instead of creating an own key — nothing is persisted,
        // so the write is silently lost. src/lib/server/services/journalNotesService.ts:29
        it('setJournalNotes("__proto__") must round-trip like any other key', async () => {
            const notes = [note({ message: 'proto-key note' })]
            await setJournalNotes('__proto__', notes)
            expect(await getJournalNotes('__proto__')).toEqual(notes)
        })
    })

    describe('concurrency', () => {
        // BUG: each call opens its own ManagedFile and does read-modify-write across
        // an await. Two concurrent setJournalNotes calls both load the same pre-state,
        // so the last flush wins and the other appid's notes are silently lost.
        // src/lib/server/services/journalNotesService.ts:25-34
        it('concurrent setJournalNotes calls for different appids must both persist', async () => {
            await Promise.allSettled([
                setJournalNotes('501', [note({ message: 'first' })]),
                setJournalNotes('502', [note({ message: 'second' })]),
            ])
            const a = await getJournalNotes('501')
            const b = await getJournalNotes('502')
            expect(a.length).toBe(1)
            expect(b.length).toBe(1)
        })

        it('sequential writes remain consistent (baseline for the concurrency bug)', async () => {
            await setJournalNotes('601', [note({ message: 'one' })])
            await setJournalNotes('602', [note({ message: 'two' })])
            expect((await getJournalNotes('601')).length).toBe(1)
            expect((await getJournalNotes('602')).length).toBe(1)
        })
    })
})
