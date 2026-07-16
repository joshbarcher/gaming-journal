import { describe, it, beforeEach, afterEach, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { GET, PUT } from '../../routes/api/journal-notes/[appid]/+server.js'
import type { StickyNote } from '../../lib/types.js'

// journalNotesService caches its ManagedFile per resolved path, so a fresh
// DATA_DIR per test gives every test its own isolated store.

function tmpDataDir() {
    return path.join(os.tmpdir(), `jnotes-route-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

function note(overrides: Partial<StickyNote> = {}): StickyNote {
    return { id: 'n1', label: 'L', message: 'hello', from: 'me', size: 'md' as never, color: 'yellow' as never, rotation: 1, ...overrides }
}

function getReq(appid: string) {
    return { params: { appid } } as never
}

function putReq(appid: string, body: string) {
    return { params: { appid }, request: new Request('http://x/api/journal-notes/' + appid, { method: 'PUT', body }) } as never
}

describe('/api/journal-notes/[appid]', () => {
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

    describe('GET — hostile appid params', () => {
        // No appid validation exists by design (notes are keyed by the raw
        // string); the contract is: any unknown key → empty array, never a crash.
        it.each(['0', '-1', 'abc', '1e3', '', ' ', '440.5', 'null', 'undefined'])(
            'returns [] for unknown appid %j',
            async (appid) => {
                const res = await GET(getReq(appid))
                expect(res.status).toBe(200)
                expect(await res.json()).toEqual([])
            }
        )

        it('returns [] for "__proto__" and "constructor" (not Object.prototype leakage)', async () => {
            for (const appid of ['__proto__', 'constructor', 'hasOwnProperty']) {
                const res = await GET(getReq(appid))
                expect(res.status).toBe(200)
                expect(await res.json()).toEqual([])
            }
        })
    })

    describe('PUT — body validation', () => {
        // BUG: the route (src/routes/api/journal-notes/[appid]/+server.ts:15)
        // does `setJournalNotes(appid, await request.json())` inside one big
        // try/catch — a malformed client body is caught and reported as a 500
        // server error instead of a 400 client error.
        it('returns 400 for a non-JSON body (currently a 500)', async () => {
            const res = await PUT(putReq('440', 'oops not json'))
            expect(res.status).toBe(400)
        })

        // BUG: there is NO shape validation at all — any JSON value (object,
        // string, null) is persisted as the appid's "StickyNote[]" and every
        // future GET for that appid serves the garbage back, breaking the
        // StickyNote[] response contract for all clients.
        it('rejects a non-array body with 400 (currently persists it)', async () => {
            const res = await PUT(putReq('440', JSON.stringify({ sneaky: true })))
            expect(res.status).toBe(400)
        })

        // BUG: same hole with a JSON null body — GET then returns `null`, and
        // clients doing notes.map(...) crash.
        it('rejects a JSON null body with 400 (currently persists null)', async () => {
            const res = await PUT(putReq('441', 'null'))
            expect(res.status).toBe(400)
        })

        it('a rejected non-array body persists nothing — GET still serves []', async () => {
            // Companion to the 400-validation tests above (regression: the raw body
            // was once stored verbatim and served back, crashing client notes.map()).
            await PUT(putReq('442', JSON.stringify({ sneaky: true })))
            const got = await GET(getReq('442'))
            expect(await got.json()).toEqual([])
        })
    })

    describe('PUT — round trips', () => {
        it('stores and returns a valid notes array', async () => {
            const notes = [note(), note({ id: 'n2', message: 'second' })]
            const res = await PUT(putReq('570', JSON.stringify(notes)))
            expect(res.status).toBe(200)
            expect(await res.json()).toEqual(notes)
            expect(await GET(getReq('570')).then(r => r.json())).toEqual(notes)
        })

        it('an empty array clears the notes and round-trips', async () => {
            await PUT(putReq('570', JSON.stringify([note()])))
            await PUT(putReq('570', '[]'))
            expect(await GET(getReq('570')).then(r => r.json())).toEqual([])
        })

        it('appids are distinct keys — writing one does not disturb another', async () => {
            await PUT(putReq('100', JSON.stringify([note({ message: 'a' })])))
            await PUT(putReq('200', JSON.stringify([note({ message: 'b' })])))
            expect((await GET(getReq('100')).then(r => r.json()))[0].message).toBe('a')
            expect((await GET(getReq('200')).then(r => r.json()))[0].message).toBe('b')
        })

        it('appid "__proto__" round-trips as an inert key without polluting Object.prototype', async () => {
            const notes = [note({ message: 'proto-safe' })]
            const res = await PUT(putReq('__proto__', JSON.stringify(notes)))
            expect(res.status).toBe(200)
            // If the store's prototype had been swapped to the notes array,
            // fresh objects would inherit array-ish props.
            expect(({} as Record<string, unknown>)['length']).toBeUndefined()
            expect(({} as Record<string, unknown>)['0']).toBeUndefined()
            const got = await GET(getReq('__proto__'))
            expect(await got.json()).toEqual(notes)
            // A different appid must still see an empty store.
            expect(await GET(getReq('999')).then(r => r.json())).toEqual([])
        })

        it('numeric-string appids are NOT normalized ("0440" and "440" are different keys)', async () => {
            await PUT(putReq('0440', JSON.stringify([note({ message: 'padded' })])))
            expect(await GET(getReq('440')).then(r => r.json())).toEqual([])
        })
    })

    describe('server errors', () => {
        it('GET reports 500 with an error key when DATA_DIR is unset', async () => {
            delete process.env.DATA_DIR
            const res = await GET(getReq('440'))
            expect(res.status).toBe(500)
            expect((await res.json()).error).toMatch(/DATA_DIR/)
        })

        it('PUT reports 500 with an error key when DATA_DIR is unset', async () => {
            delete process.env.DATA_DIR
            const res = await PUT(putReq('440', '[]'))
            expect(res.status).toBe(500)
            expect((await res.json()).error).toMatch(/DATA_DIR/)
        })
    })
})
