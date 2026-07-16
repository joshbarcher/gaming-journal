import { describe, it, beforeEach, afterEach, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { GET, PATCH } from '../../routes/api/settings/+server.js'

// settingsService goes through getStoreFile, which caches per resolved path —
// a fresh DATA_DIR per test isolates every store.

const DEFAULT_KEYS = ['showChildLocked', 'showFiltered', 'showSoftware', 'hideUnavailable', 'titleBlocklist', 'discoverFiltersEnabled', 'hideAdultContent'].sort()

function tmpDataDir() {
    return path.join(os.tmpdir(), `settings-route-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

function patchReq(body: string) {
    return { request: new Request('http://x/api/settings', { method: 'PATCH', body }) } as never
}

describe('/api/settings', () => {
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

    describe('GET', () => {
        it('returns the full defaults shape on a fresh store', async () => {
            const res = await GET()
            expect(res.status).toBe(200)
            const body = await res.json()
            expect(Object.keys(body).sort()).toEqual(DEFAULT_KEYS)
            expect(body.titleBlocklist).toEqual([])
            expect(body.hideAdultContent).toBe(true)
        })

        it('returns 500 with an error key when DATA_DIR is unset', async () => {
            delete process.env.DATA_DIR
            const res = await GET()
            expect(res.status).toBe(500)
            expect((await res.json()).error).toMatch(/DATA_DIR/)
        })
    })

    describe('PATCH — malformed bodies', () => {
        // BUG: `await request.json()` (src/routes/api/settings/+server.ts:14) is
        // inside the catch-all try — a malformed client body is reported as a
        // 500 server error instead of a 400 client error.
        it('returns 400 for a non-JSON body (currently a 500)', async () => {
            const res = await PATCH(patchReq('{{{'))
            expect(res.status).toBe(400)
        })

        it.each([['null body', 'null'], ['array body', '[true,false]']])(
            'rejects a non-object JSON root (%s) with 400 (regression: once a silent no-op)',
            async (_label, raw) => {
                const res = await PATCH(patchReq(raw))
                expect(res.status).toBe(400)
            },
        )
    })

    describe('PATCH — key/type filtering (documented silent-ignore contract)', () => {
        it('ignores wrong-typed boolean settings (string "true" does not flip the flag)', async () => {
            const res = await PATCH(patchReq(JSON.stringify({ showChildLocked: 'true', showSoftware: 1, hideAdultContent: null })))
            expect(res.status).toBe(200)
            const body = await res.json()
            expect(body.showChildLocked).toBe(false)
            expect(body.showSoftware).toBe(false)
            expect(body.hideAdultContent).toBe(true)
        })

        it('ignores a non-array titleBlocklist', async () => {
            const res = await PATCH(patchReq(JSON.stringify({ titleBlocklist: 'nope' })))
            expect((await res.json()).titleBlocklist).toEqual([])
        })

        it('ignores a titleBlocklist containing non-strings (all-or-nothing)', async () => {
            const res = await PATCH(patchReq(JSON.stringify({ titleBlocklist: ['ok', 42] })))
            expect((await res.json()).titleBlocklist).toEqual([])
        })

        it('ignores unknown keys — they never appear in the response or persist', async () => {
            const res = await PATCH(patchReq(JSON.stringify({ evilKey: true, showFiltered: true })))
            const body = await res.json()
            expect(body.evilKey).toBeUndefined()
            expect(body.showFiltered).toBe(true)
            const roundTrip = await (await GET()).json()
            expect(roundTrip.evilKey).toBeUndefined()
        })

        it('"__proto__"/"constructor"/"toString" keys are ignored and do not pollute', async () => {
            const res = await PATCH(patchReq('{"__proto__":{"polluted":true},"constructor":true,"toString":true}'))
            expect(res.status).toBe(200)
            const body = await res.json()
            expect(Object.keys(body).sort()).toEqual(DEFAULT_KEYS)
            expect(({} as Record<string, unknown>).polluted).toBeUndefined()
        })
    })

    describe('PATCH — valid patches', () => {
        it('applies boolean flips and persists them for the next GET', async () => {
            const res = await PATCH(patchReq(JSON.stringify({ showSoftware: true, hideAdultContent: false })))
            expect(res.status).toBe(200)
            const body = await res.json()
            expect(body.showSoftware).toBe(true)
            expect(body.hideAdultContent).toBe(false)
            const after = await (await GET()).json()
            expect(after.showSoftware).toBe(true)
            expect(after.hideAdultContent).toBe(false)
        })

        it('replaces titleBlocklist wholesale (no merge with the previous list)', async () => {
            await PATCH(patchReq(JSON.stringify({ titleBlocklist: ['a', 'b'] })))
            const res = await PATCH(patchReq(JSON.stringify({ titleBlocklist: ['c'] })))
            expect((await res.json()).titleBlocklist).toEqual(['c'])
        })

        it('an empty patch body {} returns the current settings unchanged', async () => {
            await PATCH(patchReq(JSON.stringify({ showFiltered: true })))
            const res = await PATCH(patchReq('{}'))
            expect((await res.json()).showFiltered).toBe(true)
        })

        it('returns 500 with an error key when DATA_DIR is unset', async () => {
            delete process.env.DATA_DIR
            const res = await PATCH(patchReq('{}'))
            expect(res.status).toBe(500)
            expect((await res.json()).error).toMatch(/DATA_DIR/)
        })
    })
})
