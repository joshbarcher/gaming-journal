// @vitest-environment node
//
// Adversarial tests for /api/community-prefs and /api/community-prefs/toggle.
//
// communityPrefsService goes through getStoreFile() (cache keyed by resolved
// path), so a fresh DATA_DIR per test isolates state.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { GET as prefsGET } from '../../routes/api/community-prefs/+server.js'
import { POST as togglePOST } from '../../routes/api/community-prefs/toggle/+server.js'

let dataDir: string
let savedDataDir: string | undefined

beforeEach(() => {
    savedDataDir = process.env.DATA_DIR
    dataDir = path.join(os.tmpdir(), `prefs-routes-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    process.env.DATA_DIR = dataDir
})

afterEach(async () => {
    if (savedDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = savedDataDir
    await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

function jsonReq(body: unknown): Request {
    return new Request('http://test.local/', {
        method:  'POST',
        body:    JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
    })
}

function rawReq(body?: string): Request {
    return new Request('http://test.local/', {
        method:  'POST',
        body,
        headers: { 'content-type': 'application/json' },
    })
}

async function toggle(body: unknown) {
    return await togglePOST({ request: jsonReq(body) } as any)
}

describe('GET /api/community-prefs', () => {
    it('returns the full empty shape on a brand-new store', async () => {
        const res = await prefsGET()
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ filtered: [], muted: [], favorited: [], highlighted: {} })
    })
})

describe('POST /api/community-prefs/toggle — validation', () => {
    it.each([
        ['empty object', {}],
        ['missing username', { type: 'mute' }],
        ['missing type', { username: 'bob' }],
        ['empty-string username', { type: 'mute', username: '' }],
        ['empty-string type', { type: '', username: 'bob' }],
        ['username is 0', { type: 'mute', username: 0 }],
        ['type is null', { type: null, username: 'bob' }],
    ])('400 when %s', async (_label, body) => {
        const res = await toggle(body)
        expect(res.status).toBe(400)
        expect((await res.json()).error).toMatch(/required/i)
    })

    it.each(['block', 'highlite', 'FILTER', 'Mute', '__proto__', 'constructor'])(
        '400 for unknown/hostile type %j (exact-match whitelist)',
        async (type) => {
            const res = await toggle({ type, username: 'bob' })
            expect(res.status).toBe(400)
            expect((await res.json()).error).toMatch(/invalid type/i)
        },
    )

    it('400 when type is an array smuggling a valid value (["filter"])', async () => {
        const res = await toggle({ type: ['filter'], username: 'bob' })
        expect(res.status).toBe(400)
    })

    it('400 when type is "highlight" and appid is missing', async () => {
        const res = await toggle({ type: 'highlight', username: 'bob' })
        expect(res.status).toBe(400)
        expect((await res.json()).error).toMatch(/appid/i)
    })

    it('contract: numeric appid 0 is falsy and rejected for highlight, but string "0" passes', async () => {
        expect((await toggle({ type: 'highlight', username: 'bob', appid: 0 })).status).toBe(400)
        const res = await toggle({ type: 'highlight', username: 'bob', appid: '0' })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ active: true })
    })

    it('a JSON null body is handled (?? {}) and returns 400, not 500', async () => {
        const res = await togglePOST({ request: rawReq('null') } as any)
        expect(res.status).toBe(400)
    })

    it('a bare JSON string body destructures to no fields and returns 400', async () => {
        const res = await togglePOST({ request: rawReq('"filter"') } as any)
        expect(res.status).toBe(400)
    })

    // BUG: request.json() rejection on malformed JSON falls into the blanket
    // catch and returns 500 — client-sent garbage is a 400-class error.
    // src/routes/api/community-prefs/toggle/+server.ts:15-17
    it('returns 400 (not 500) for malformed JSON', async () => {
        const res = await togglePOST({ request: rawReq('{"type": "mu') } as any)
        expect(res.status).toBe(400)
    })

    // BUG: any truthy garbage passes as username — an object body field is
    // String()-coerced to the literal key "[object Object]", so every object
    // username collides into one entry. Wrong-typed fields should be 400.
    // src/routes/api/community-prefs/toggle/+server.ts:13 (low)
    it('rejects a non-string/non-number username with 400', async () => {
        const res = await toggle({ type: 'mute', username: { name: 'bob' } })
        expect(res.status).toBe(400)
    })
})

describe('POST /api/community-prefs/toggle — behavior', () => {
    it.each(['filter', 'mute', 'favorite'] as const)(
        '%s: response shape is exactly {active}, toggling twice removes, GET reflects both states',
        async (type) => {
            const listKey = type === 'filter' ? 'filtered' : type === 'mute' ? 'muted' : 'favorited'

            const on = await toggle({ type, username: 'bob' })
            expect(on.status).toBe(200)
            const onBody = await on.json()
            expect(onBody).toEqual({ active: true })
            expect(Object.keys(onBody)).toEqual(['active'])

            expect((await (await prefsGET()).json())[listKey]).toEqual(['bob'])

            const off = await toggle({ type, username: 'bob' })
            expect(await off.json()).toEqual({ active: false })
            expect((await (await prefsGET()).json())[listKey]).toEqual([])
        },
    )

    it('the same username is independent across pref types', async () => {
        await toggle({ type: 'mute', username: 'bob' })
        await toggle({ type: 'favorite', username: 'bob' })
        await toggle({ type: 'mute', username: 'bob' }) // un-mute
        const prefs = await (await prefsGET()).json()
        expect(prefs.muted).toEqual([])
        expect(prefs.favorited).toEqual(['bob'])
    })

    it('highlight: on/off per appid, and clearing the last user drops the appid key entirely', async () => {
        expect(await (await toggle({ type: 'highlight', username: 'bob', appid: 570 })).json()).toEqual({ active: true })
        expect(await (await toggle({ type: 'highlight', username: 'alice', appid: 570 })).json()).toEqual({ active: true })
        expect((await (await prefsGET()).json()).highlighted).toEqual({ '570': ['bob', 'alice'] })

        expect(await (await toggle({ type: 'highlight', username: 'bob', appid: 570 })).json()).toEqual({ active: false })
        expect(await (await toggle({ type: 'highlight', username: 'alice', appid: 570 })).json()).toEqual({ active: false })
        expect((await (await prefsGET()).json()).highlighted).toEqual({})
    })

    it('contract: numeric appid and its string form are the same highlight bucket', async () => {
        await toggle({ type: 'highlight', username: 'bob', appid: 570 })
        const off = await toggle({ type: 'highlight', username: 'bob', appid: '570' })
        expect(await off.json()).toEqual({ active: false })
    })

    it('contract: numeric usernames are String()-coerced, so 42 and "42" toggle the same entry', async () => {
        expect(await (await toggle({ type: 'filter', username: 42 })).json()).toEqual({ active: true })
        expect(await (await toggle({ type: 'filter', username: '42' })).json()).toEqual({ active: false })
        expect((await (await prefsGET()).json()).filtered).toEqual([])
    })

    it('username "__proto__" is inert list data (arrays, not object keys)', async () => {
        expect(await (await toggle({ type: 'mute', username: '__proto__' })).json()).toEqual({ active: true })
        expect((await (await prefsGET()).json()).muted).toEqual(['__proto__'])
        expect(await (await toggle({ type: 'mute', username: '__proto__' })).json()).toEqual({ active: false })
        expect(({} as any).muted).toBeUndefined()
    })

    it('highlight appid "__proto__" stores under an own key and never pollutes Object.prototype', async () => {
        const on = await toggle({ type: 'highlight', username: 'bob', appid: '__proto__' })
        expect(await on.json()).toEqual({ active: true })

        const prefs = await (await prefsGET()).json()
        expect(Object.prototype.hasOwnProperty.call(prefs.highlighted, '__proto__')).toBe(true)
        expect(({} as any).includes).toBeUndefined()
        expect(Array.isArray(Object.getPrototypeOf({}))).toBe(false)

        const off = await toggle({ type: 'highlight', username: 'bob', appid: '__proto__' })
        expect(await off.json()).toEqual({ active: false })
        expect(Object.keys((await (await prefsGET()).json()).highlighted)).toEqual([])
    })

    it('10k-char and unicode usernames round-trip through toggle on/off', async () => {
        const long = 'u'.repeat(10_000)
        for (const username of [long, 'ユーザー😀']) {
            expect(await (await toggle({ type: 'favorite', username })).json()).toEqual({ active: true })
            expect(await (await toggle({ type: 'favorite', username })).json()).toEqual({ active: false })
        }
        expect((await (await prefsGET()).json()).favorited).toEqual([])
    })
})
