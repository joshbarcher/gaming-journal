// @vitest-environment node
//
// Adversarial tests for /api/flags and /api/flags/[appid].
//
// flagsService goes through getStoreFile(), which caches ManagedFile instances
// keyed by resolved path — a fresh DATA_DIR per test gives full isolation
// without vi.resetModules().
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { GET as getAllGET } from '../../routes/api/flags/+server.js'
import { GET as flagsGET, PATCH as flagsPATCH } from '../../routes/api/flags/[appid]/+server.js'

let dataDir: string
let savedDataDir: string | undefined

beforeEach(() => {
    savedDataDir = process.env.DATA_DIR
    dataDir = path.join(os.tmpdir(), `flags-routes-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    process.env.DATA_DIR = dataDir
})

afterEach(async () => {
    if (savedDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = savedDataDir
    await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

function jsonReq(body: unknown): Request {
    return new Request('http://test.local/', {
        method:  'PATCH',
        body:    JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
    })
}

function rawReq(body?: string): Request {
    return new Request('http://test.local/', {
        method:  'PATCH',
        body,
        headers: { 'content-type': 'application/json' },
    })
}

describe('GET /api/flags and /api/flags/[appid] — empty store', () => {
    it('GET all returns {} on a brand-new store', async () => {
        const res = await getAllGET()
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({})
    })

    it.each(['570', '1000'])(
        'GET [appid]=%j on an empty store returns {} (never prototype junk)',
        async (appid) => {
            const res = await flagsGET({ params: { appid } } as any)
            expect(res.status).toBe(200)
            expect(await res.json()).toEqual({})
        },
    )

    it.each(['0', '-1', 'abc', '__proto__', 'constructor'])(
        'GET [appid]=%j is rejected with 400 (regression: once read the shared NaN bucket)',
        async (appid) => {
            const res = await flagsGET({ params: { appid } } as any)
            expect(res.status).toBe(400)
        },
    )
})

describe('PATCH /api/flags/[appid] — body validation', () => {
    it.each([
        ['flag missing', { value: true }],
        ['value missing', { flag: 'favorite' }],
        ['flag is a number', { flag: 42, value: true }],
        ['flag is null', { flag: null, value: true }],
        ['value is the string "true"', { flag: 'favorite', value: 'true' }],
        ['value is the number 1', { flag: 'favorite', value: 1 }],
        ['value is null', { flag: 'favorite', value: null }],
        ['value is an object', { flag: 'favorite', value: {} }],
    ])('400 when %s', async (_label, body) => {
        const res = await flagsPATCH({ params: { appid: '570' }, request: jsonReq(body) } as any)
        expect(res.status).toBe(400)
    })

    it.each(['notAFlag', '__proto__', 'constructor', 'hasOwnProperty', 'Favorite', ''])(
        '400 for unknown flag name %j (whitelist is exact-match)',
        async (flag) => {
            const res = await flagsPATCH({ params: { appid: '570' }, request: jsonReq({ flag, value: true }) } as any)
            expect(res.status).toBe(400)
            expect((({} as any).favorite)).toBeUndefined() // prototype untouched
        },
    )

    // REGRESSION: request.json() failure once landed in the blanket catch (whose only
    // 400 carve-out was "Unknown flag"), so malformed JSON came back 500. Now 400.
    it('returns 400 (not 500) for malformed JSON', async () => {
        const res = await flagsPATCH({ params: { appid: '570' }, request: rawReq('{"flag": "fav') } as any)
        expect(res.status).toBe(400)
    })

    // REGRESSION: a "null" body once destructured as `const { flag, value } = null`,
    // throwing a TypeError -> 500. Now returns 400.
    it('returns 400 (not 500) for a JSON null body', async () => {
        const res = await flagsPATCH({ params: { appid: '570' }, request: rawReq('null') } as any)
        expect(res.status).toBe(400)
    })

    // REGRESSION: the route once did Number(params.appid) with no validation, so every
    // non-numeric appid coerced to NaN and shared the single "NaN" key (silent
    // cross-appid data bleed). Non-numeric appids are now rejected with 400.
    it('rejects a non-numeric appid with 400', async () => {
        const res = await flagsPATCH({ params: { appid: 'abc' }, request: jsonReq({ flag: 'favorite', value: true }) } as any)
        expect(res.status).toBe(400)
    })

    // Regression: invalid appids once all collapsed into one shared "NaN" bucket,
    // so a flag set via /api/flags/abc leaked to every other non-numeric appid.
    // Both writes and reads now reject with 400 and nothing persists.
    it('flags set under one invalid appid must not leak to a different invalid appid', async () => {
        const write = await flagsPATCH({ params: { appid: 'abc' }, request: jsonReq({ flag: 'favorite', value: true }) } as any)
        expect(write.status).toBe(400)
        const all = await (await getAllGET()).json()
        expect(all).toEqual({})
    })
})

describe('PATCH /api/flags/[appid] — behavior contracts', () => {
    it('set/unset round trip: true stores the flag, false removes it and empties the store', async () => {
        const on = await flagsPATCH({ params: { appid: '570' }, request: jsonReq({ flag: 'favorite', value: true }) } as any)
        expect(on.status).toBe(200)
        expect(await on.json()).toEqual({ favorite: true })

        expect(await (await flagsGET({ params: { appid: '570' } } as any)).json()).toEqual({ favorite: true })
        expect(await (await getAllGET()).json()).toEqual({ '570': { favorite: true } })

        const off = await flagsPATCH({ params: { appid: '570' }, request: jsonReq({ flag: 'favorite', value: false }) } as any)
        expect(off.status).toBe(200)
        expect(await off.json()).toEqual({})
        // false removes the appid entry entirely, not just the flag
        expect(await (await getAllGET()).json()).toEqual({})
    })

    it('unsetting a flag on an appid that has no flags is a 200 no-op', async () => {
        const res = await flagsPATCH({ params: { appid: '999' }, request: jsonReq({ flag: 'completed', value: false }) } as any)
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({})
    })

    it('multiple flags on one appid accumulate and clear independently', async () => {
        await flagsPATCH({ params: { appid: '10' }, request: jsonReq({ flag: 'completed', value: true }) } as any)
        await flagsPATCH({ params: { appid: '10' }, request: jsonReq({ flag: 'favorite', value: true }) } as any)
        const res = await flagsPATCH({ params: { appid: '10' }, request: jsonReq({ flag: 'completed', value: false }) } as any)
        expect(await res.json()).toEqual({ favorite: true })
    })

    it('negative appids are rejected with 400 (regression: once accepted verbatim)', async () => {
        const res = await flagsPATCH({ params: { appid: '-1' }, request: jsonReq({ flag: 'alert', value: true }) } as any)
        expect(res.status).toBe(400)
    })

    it('contract: "1e3" Number-coerces — a PATCH to "1e3" writes appid 1000\'s flags', async () => {
        await flagsPATCH({ params: { appid: '1e3' }, request: jsonReq({ flag: 'backlog', value: true }) } as any)
        expect(await (await flagsGET({ params: { appid: '1000' } } as any)).json()).toEqual({ backlog: true })
    })

    it('PATCH with appid "__proto__" is rejected and never pollutes Object.prototype', async () => {
        const res = await flagsPATCH({ params: { appid: '__proto__' }, request: jsonReq({ flag: 'favorite', value: true }) } as any)
        expect(res.status).toBe(400)
        expect(({} as any).favorite).toBeUndefined()
        expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'NaN')).toBe(false)
        const all = await (await getAllGET()).json()
        expect(all).toEqual({})  // nothing persisted, no coerced NaN bucket
    })
})
