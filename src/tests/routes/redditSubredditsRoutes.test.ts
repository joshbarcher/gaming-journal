// @vitest-environment node
//
// Adversarial tests for /api/reddit-subreddits/[appid] and .../[name].
//
// The service goes through getStoreFile() (cache keyed by resolved path), so a
// fresh DATA_DIR per test isolates state. The [name] param arrives URL-decoded
// from SvelteKit — these tests pass decoded values, exactly what the handler sees.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { GET as subsGET, POST as subsPOST } from '../../routes/api/reddit-subreddits/[appid]/+server.js'
import { DELETE as subDELETE } from '../../routes/api/reddit-subreddits/[appid]/[name]/+server.js'

let dataDir: string
let savedDataDir: string | undefined

beforeEach(() => {
    savedDataDir = process.env.DATA_DIR
    dataDir = path.join(os.tmpdir(), `subs-routes-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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

async function add(appid: string, name: unknown) {
    return await subsPOST({ params: { appid }, request: jsonReq({ name }) } as any)
}

describe('GET /api/reddit-subreddits/[appid]', () => {
    it.each(['570', '0', '-1', 'abc', '__proto__', 'constructor', ''])(
        'returns [] for unknown appid %j (no prototype leakage, no coercion errors)',
        async (appid) => {
            const res = await subsGET({ params: { appid } } as any)
            expect(res.status).toBe(200)
            expect(await res.json()).toEqual([])
        },
    )
})

describe('POST /api/reddit-subreddits/[appid] — validation', () => {
    it.each([
        ['name missing', {}],
        ['name is a number', { name: 42 }],
        ['name is empty string', { name: '' }],
        ['name is null', { name: null }],
        ['name is boolean', { name: true }],
        ['name is an array', { name: ['a'] }],
        ['name is an object', { name: {} }],
    ])('400 when %s', async (_label, body) => {
        const res = await subsPOST({ params: { appid: '570' }, request: jsonReq(body) } as any)
        expect(res.status).toBe(400)
    })

    // REGRESSION: json() parsing once sat outside the try, so malformed JSON made the
    // handler reject (an unhandled 500 page in SvelteKit) instead of returning a
    // Response. It now returns a 400 Response.
    it('returns a 400 Response (not a rejected promise) for malformed JSON', async () => {
        const res = await subsPOST({ params: { appid: '570' }, request: rawReq('{"name": "ga') } as any)
        expect(res.status).toBe(400)
    })

    // REGRESSION: a "null" body once destructured as `const { name } = null`, throwing
    // outside the try and rejecting the handler. Now returns 400.
    it('returns a 400 Response (not a rejected promise) for a JSON null body', async () => {
        const res = await subsPOST({ params: { appid: '570' }, request: rawReq('null') } as any)
        expect(res.status).toBe(400)
    })

    // REGRESSION: the guard once checked `!name` before trimming but stored
    // name.trim(), so a whitespace-only name persisted an empty, unremovable subreddit
    // (a blank UI chip). It is now rejected with 400.
    it('rejects a whitespace-only name with 400', async () => {
        const res = await add('570', '   ')
        expect(res.status).toBe(400)
    })
})

describe('POST /api/reddit-subreddits/[appid] — behavior', () => {
    it('round-trips and duplicate adds are idempotent, case-insensitively', async () => {
        expect(await (await add('570', 'DotA2')).json()).toEqual(['DotA2'])
        // exact duplicate
        expect(await (await add('570', 'DotA2')).json()).toEqual(['DotA2'])
        // case-variant duplicate keeps the original casing
        expect(await (await add('570', 'dota2')).json()).toEqual(['DotA2'])
        expect(await (await subsGET({ params: { appid: '570' } } as any)).json()).toEqual(['DotA2'])
    })

    it('contract: names with "/", "..", unicode, and 10k chars are stored verbatim (plain list, not paths)', async () => {
        const long = 'x'.repeat(10_000)
        for (const name of ['r/pathofexile', '..', '../../etc/passwd', 'ゼルダ😀', long]) {
            const res = await add('42', name)
            expect(res.status).toBe(200)
        }
        const list = await (await subsGET({ params: { appid: '42' } } as any)).json()
        expect(list).toEqual(['r/pathofexile', '..', '../../etc/passwd', 'ゼルダ😀', long])
        // nothing escaped the store dir (no file named after the ../ entry)
        expect((await fsp.readdir(path.join(dataDir, 'gaming-journal'))).some(f => f.includes('passwd'))).toBe(false)
    })

    it('name is trimmed before storing and dedup compares the trimmed form', async () => {
        expect(await (await add('7', '  games  ')).json()).toEqual(['games'])
        expect(await (await add('7', 'GAMES')).json()).toEqual(['games'])
    })

    it('appid "__proto__" stores under an own key and never pollutes Object.prototype', async () => {
        const res = await add('__proto__', 'evil')
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual(['evil'])
        expect(await (await subsGET({ params: { appid: '__proto__' } } as any)).json()).toEqual(['evil'])
        // no coercion here (unlike flags): a different appid does NOT see it
        expect(await (await subsGET({ params: { appid: 'NaN' } } as any)).json()).toEqual([])
        expect(({} as any)[0]).toBeUndefined()
        expect(Array.isArray(Object.getPrototypeOf({}))).toBe(false)
    })

    it('contract: appids are raw string keys — "570" and "0570" are different buckets', async () => {
        await add('570', 'a')
        await add('0570', 'b')
        expect(await (await subsGET({ params: { appid: '570' } } as any)).json()).toEqual(['a'])
        expect(await (await subsGET({ params: { appid: '0570' } } as any)).json()).toEqual(['b'])
    })
})

describe('DELETE /api/reddit-subreddits/[appid]/[name]', () => {
    it('is idempotent: unknown name on an existing appid returns the remaining list', async () => {
        await add('570', 'keep')
        const res = await subDELETE({ params: { appid: '570', name: 'never-added' } } as any)
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual(['keep'])
    })

    it('is idempotent: nonexistent appid returns []', async () => {
        const res = await subDELETE({ params: { appid: 'ghost', name: 'x' } } as any)
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual([])
    })

    it('removes case-insensitively and deleting the last entry empties the bucket', async () => {
        await add('570', 'Games')
        const res = await subDELETE({ params: { appid: '570', name: 'GAMES' } } as any)
        expect(await res.json()).toEqual([])
        expect(await (await subsGET({ params: { appid: '570' } } as any)).json()).toEqual([])
    })

    it('removes only the targeted name', async () => {
        await add('570', 'one')
        await add('570', 'two')
        const res = await subDELETE({ params: { appid: '570', name: 'one' } } as any)
        expect(await res.json()).toEqual(['two'])
    })

    it('handles hostile name params: "__proto__", "..", "constructor" are inert', async () => {
        await add('570', 'real')
        for (const name of ['__proto__', '..', 'constructor']) {
            const res = await subDELETE({ params: { appid: '570', name } } as any)
            expect(res.status).toBe(200)
            expect(await res.json()).toEqual(['real'])
        }
        expect(({} as any).length).toBeUndefined()
    })

    it('deletes names containing "/" and unicode (URL-decoded param round trip)', async () => {
        await add('9', 'r/dota2')
        await add('9', 'café☕')
        expect(await (await subDELETE({ params: { appid: '9', name: 'r/dota2' } } as any)).json()).toEqual(['café☕'])
        expect(await (await subDELETE({ params: { appid: '9', name: 'café☕' } } as any)).json()).toEqual([])
    })
})
