// @vitest-environment node
//
// Adversarial tests for the /api/franchises route handlers.
//
// NOTE: getFranchiseService() caches a module-level singleton that binds
// DATA_DIR at first call — this file uses ONE DATA_DIR for all tests and
// isolates tests through unique franchise ids (every test creates its own
// franchise via the POST handler). The DATA_DIR-unset test uses
// vi.resetModules() + a dynamic import so it never touches the shared singleton.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { GET as listGET, POST as createPOST } from '../../routes/api/franchises/+server.js'
import { GET as getOne, PUT as renamePUT, DELETE as removeDELETE } from '../../routes/api/franchises/[id]/+server.js'
import { POST as entryPOST } from '../../routes/api/franchises/[id]/entries/+server.js'
import { DELETE as entryDELETE } from '../../routes/api/franchises/[id]/entries/[appid]/+server.js'
import { PUT as orderPUT } from '../../routes/api/franchises/[id]/entries/order/+server.js'
import { getFranchiseService } from '../../lib/server/services/franchiseService.js'

const dataDir = path.join(os.tmpdir(), `franchise-routes-${Date.now()}-${Math.random().toString(36).slice(2)}`)
let savedDataDir: string | undefined

beforeAll(async () => {
    savedDataDir = process.env.DATA_DIR
    process.env.DATA_DIR = dataDir
    // Production loads the singleton in hooks.server.ts before any request;
    // mirror that here or every handler 500s with "not loaded".
    await getFranchiseService().load()
})

afterAll(async () => {
    await getFranchiseService().close().catch(() => {})
    if (savedDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = savedDataDir
    await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

function jsonReq(method: string, body: unknown): Request {
    return new Request('http://test.local/', {
        method,
        body:    JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
    })
}

function rawReq(method: string, body?: string): Request {
    return new Request('http://test.local/', {
        method,
        body,
        headers: { 'content-type': 'application/json' },
    })
}

/** Create a franchise through the real handler; unique name per call. */
async function createFranchise(prefix = 'fr') {
    const name = `${prefix}-${randomUUID()}`
    const res  = await createPOST({ request: jsonReq('POST', { name }) } as any)
    expect(res.status).toBe(201)
    return await res.json()
}

describe('GET /api/franchises', () => {
    it('returns 500 with a diagnostic (not a crash) when DATA_DIR is unset', async () => {
        vi.resetModules()
        const saved = process.env.DATA_DIR
        delete process.env.DATA_DIR
        try {
            const mod = await import('../../routes/api/franchises/+server.js')
            const res = mod.GET()
            expect(res.status).toBe(500)
            expect((await res.json()).error).toMatch(/DATA_DIR/)
        } finally {
            process.env.DATA_DIR = saved
        }
    })

    it('returns an array even on a brand-new empty store', async () => {
        const res = await listGET()
        expect(res.status).toBe(200)
        expect(Array.isArray(await res.json())).toBe(true)
    })
})

describe('POST /api/franchises — body validation', () => {
    it.each([
        ['missing name', {}],
        ['name is a number', { name: 42 }],
        ['name is empty string', { name: '' }],
        ['name is whitespace only', { name: '   ' }],
        ['name is boolean', { name: true }],
        ['name is null', { name: null }],
        ['name is an array', { name: ['a'] }],
        ['name is an object', { name: { toString: 'x' } }],
    ])('400 when %s', async (_label, body) => {
        const res = await createPOST({ request: jsonReq('POST', body) } as any)
        expect(res.status).toBe(400)
    })

    it.each([
        ['a bare JSON number', '123'],
        ['a bare JSON string', '"just-a-string"'],
        ['a JSON array', '[1,2,3]'],
        ['a JSON boolean', 'true'],
    ])('400 when the body is %s (destructures to no name)', async (_label, raw) => {
        const res = await createPOST({ request: rawReq('POST', raw) } as any)
        expect(res.status).toBe(400)
    })

    // BUG: request.json() rejection is caught by the generic catch and returned
    // as 500 — a client sending malformed JSON is a 400-class error, not a
    // server error. src/routes/api/franchises/+server.ts:20-22
    it('returns 400 (not 500) for malformed JSON', async () => {
        const res = await createPOST({ request: rawReq('POST', '{"name": "oops') } as any)
        expect(res.status).toBe(400)
    })

    // BUG: same class — an empty body makes request.json() throw, which comes
    // back as 500 instead of 400. src/routes/api/franchises/+server.ts:20-22
    it('returns 400 (not 500) for an empty body', async () => {
        const res = await createPOST({ request: rawReq('POST') } as any)
        expect(res.status).toBe(400)
    })

    // BUG: body "null" parses fine, then `const { name } = null` throws
    // TypeError -> 500. A null body is client error -> 400.
    // src/routes/api/franchises/+server.ts:14
    it('returns 400 (not 500) for a JSON null body', async () => {
        const res = await createPOST({ request: rawReq('POST', 'null') } as any)
        expect(res.status).toBe(400)
    })

    it('ignores injected id/entries/createdAt (no mass assignment)', async () => {
        const name = `inject-${randomUUID()}`
        const res  = await createPOST({
            request: jsonReq('POST', {
                name,
                id:        'evil-id',
                entries:   [{ appid: 666, name: 'sneaky' }],
                createdAt: '1970-01-01T00:00:00.000Z',
            }),
        } as any)
        expect(res.status).toBe(201)
        const f = await res.json()
        expect(f.id).not.toBe('evil-id')
        expect(f.entries).toEqual([])
        expect(f.createdAt).not.toBe('1970-01-01T00:00:00.000Z')
    })

    it('trims the name before storing', async () => {
        const base = `trimmed-${randomUUID()}`
        const res  = await createPOST({ request: jsonReq('POST', { name: `  ${base}  ` }) } as any)
        const f    = await res.json()
        expect(f.name).toBe(base)
    })
})

describe('GET /api/franchises/[id]', () => {
    it.each(['nope', '__proto__', 'constructor', 'hasOwnProperty', ''])(
        '404 for nonexistent/hostile id %j (never leaks prototype members)',
        async (id) => {
            const res = await getOne({ params: { id } } as any)
            expect(res.status).toBe(404)
            expect((await res.json()).error).toMatch(/not found/i)
        },
    )
})

describe('PUT /api/franchises/[id]', () => {
    it('404 for a nonexistent id with a valid body', async () => {
        const res = await renamePUT({ params: { id: 'ghost' }, request: jsonReq('PUT', { name: 'x' }) } as any)
        expect(res.status).toBe(404)
    })

    it.each([
        ['name is a number', { name: 42 }],
        ['name is empty', { name: '' }],
        ['name is whitespace', { name: '  ' }],
        ['name is null', { name: null }],
        ['name is boolean false', { name: false }],
    ])('400 when %s', async (_label, body) => {
        const f   = await createFranchise('put-val')
        const res = await renamePUT({ params: { id: f.id }, request: jsonReq('PUT', body) } as any)
        expect(res.status).toBe(400)
    })

    it('an empty JSON object body is a no-op rename (200, name kept)', async () => {
        const f   = await createFranchise('noop')
        const res = await renamePUT({ params: { id: f.id }, request: jsonReq('PUT', {}) } as any)
        expect(res.status).toBe(200)
        expect((await res.json()).name).toBe(f.name)
    })

    it('renames with trimming, and ignores injected id/entries/createdAt', async () => {
        const f       = await createFranchise('rename')
        const newName = `renamed-${randomUUID()}`
        const res     = await renamePUT({
            params:  { id: f.id },
            request: jsonReq('PUT', { name: `  ${newName} `, id: 'evil', entries: 'garbage', createdAt: 'nope' }),
        } as any)
        expect(res.status).toBe(200)
        const updated = await res.json()
        expect(updated.name).toBe(newName)
        expect(updated.id).toBe(f.id)
        expect(updated.entries).toEqual([])
        expect(updated.createdAt).toBe(f.createdAt)
    })

    // BUG: malformed JSON in the PUT body surfaces as 500 via the blanket
    // catch; should be 400. src/routes/api/franchises/[id]/+server.ts:25-27
    it('returns 400 (not 500) for malformed JSON', async () => {
        const f   = await createFranchise('put-bad-json')
        const res = await renamePUT({ params: { id: f.id }, request: rawReq('PUT', '{{{') } as any)
        expect(res.status).toBe(400)
    })

    // BUG: `const { name } = null` throws -> 500 for a JSON null body.
    // src/routes/api/franchises/[id]/+server.ts:16
    it('returns 400 (not 500) for a JSON null body', async () => {
        const f   = await createFranchise('put-null')
        const res = await renamePUT({ params: { id: f.id }, request: rawReq('PUT', 'null') } as any)
        expect(res.status).toBe(400)
    })
})

describe('DELETE /api/franchises/[id]', () => {
    it('404 for a nonexistent id', async () => {
        const res = await removeDELETE({ params: { id: 'ghost' } } as any)
        expect(res.status).toBe(404)
    })

    it('204 on first delete, 404 on the second (not idempotent-200, not 500)', async () => {
        const f    = await createFranchise('double-del')
        const res1 = await removeDELETE({ params: { id: f.id } } as any)
        expect(res1.status).toBe(204)
        expect(res1.body).toBeNull()
        const res2 = await removeDELETE({ params: { id: f.id } } as any)
        expect(res2.status).toBe(404)
    })
})

describe('POST /api/franchises/[id]/entries', () => {
    it.each([
        ['appid missing', {}],
        ['appid is a numeric string', { appid: '123' }],
        ['appid is zero', { appid: 0 }],
        ['appid is null', { appid: null }],
        ['appid is boolean', { appid: true }],
        ['appid is an array', { appid: [1] }],
    ])('400 when %s', async (_label, body) => {
        const f   = await createFranchise('entry-val')
        const res = await entryPOST({ params: { id: f.id }, request: jsonReq('POST', body) } as any)
        expect(res.status).toBe(400)
    })

    it('404 for a nonexistent franchise id (and for "__proto__")', async () => {
        for (const id of ['ghost', '__proto__']) {
            const res = await entryPOST({ params: { id }, request: jsonReq('POST', { appid: 570 }) } as any)
            expect(res.status).toBe(404)
        }
    })

    it('duplicate adds are idempotent — same appid twice keeps one entry', async () => {
        const f = await createFranchise('dup-entry')
        await entryPOST({ params: { id: f.id }, request: jsonReq('POST', { appid: 570, name: 'Dota 2' }) } as any)
        const res = await entryPOST({ params: { id: f.id }, request: jsonReq('POST', { appid: 570, name: 'Renamed Attempt' }) } as any)
        expect(res.status).toBe(200)
        const updated = await res.json()
        expect(updated.entries).toHaveLength(1)
        expect(updated.entries[0].name).toBe('Dota 2') // original kept, not clobbered
    })

    it('contract: negative and fractional appids are accepted (no range validation)', async () => {
        const f    = await createFranchise('weird-appids')
        const res1 = await entryPOST({ params: { id: f.id }, request: jsonReq('POST', { appid: -1 }) } as any)
        expect(res1.status).toBe(200)
        const res2 = await entryPOST({ params: { id: f.id }, request: jsonReq('POST', { appid: 1.5 }) } as any)
        expect(res2.status).toBe(200)
        expect((await res2.json()).entries.map((e: { appid: number }) => e.appid)).toEqual([-1, 1.5])
    })

    it('missing or null name falls back to "App <appid>"', async () => {
        const f   = await createFranchise('default-name')
        await entryPOST({ params: { id: f.id }, request: jsonReq('POST', { appid: 10 }) } as any)
        const res = await entryPOST({ params: { id: f.id }, request: jsonReq('POST', { appid: 20, name: null }) } as any)
        const updated = await res.json()
        expect(updated.entries[0].name).toBe('App 10')
        expect(updated.entries[1].name).toBe('App 20')
    })

    // BUG: the route validates appid but not name — a non-string name (42,
    // object, array) is persisted verbatim into the store, corrupting the
    // FranchiseEntry.name:string contract that the UI renders.
    // src/routes/api/franchises/[id]/entries/+server.ts:6-10 (low severity)
    it('rejects a non-string entry name with 400', async () => {
        const f   = await createFranchise('bad-name-type')
        const res = await entryPOST({ params: { id: f.id }, request: jsonReq('POST', { appid: 30, name: 42 }) } as any)
        expect(res.status).toBe(400)
    })

    // BUG: malformed JSON -> blanket catch -> 500; should be 400.
    // src/routes/api/franchises/[id]/entries/+server.ts:13-15
    it('returns 400 (not 500) for malformed JSON', async () => {
        const f   = await createFranchise('entry-bad-json')
        const res = await entryPOST({ params: { id: f.id }, request: rawReq('POST', 'not json') } as any)
        expect(res.status).toBe(400)
    })
})

describe('DELETE /api/franchises/[id]/entries/[appid]', () => {
    it.each(['abc', '0', '__proto__', '', 'NaN'])(
        '400 for non-coercible/zero appid param %j',
        async (appid) => {
            const f   = await createFranchise('del-entry-val')
            const res = await entryDELETE({ params: { id: f.id, appid } } as any)
            expect(res.status).toBe(400)
        },
    )

    it('404 when the franchise does not exist', async () => {
        const res = await entryDELETE({ params: { id: 'ghost', appid: '570' } } as any)
        expect(res.status).toBe(404)
    })

    it('removing an appid that is not in the franchise is a 200 no-op', async () => {
        const f = await createFranchise('del-noop')
        await entryPOST({ params: { id: f.id }, request: jsonReq('POST', { appid: 1 }) } as any)
        const res = await entryDELETE({ params: { id: f.id, appid: '999' } } as any)
        expect(res.status).toBe(200)
        expect((await res.json()).entries).toHaveLength(1)
    })

    it('contract: "-1" passes the falsy check and is a 200 no-op on an existing franchise', async () => {
        const f   = await createFranchise('del-neg')
        const res = await entryDELETE({ params: { id: f.id, appid: '-1' } } as any)
        expect(res.status).toBe(200)
    })

    it('contract: scientific notation "1e3" Number-coerces and deletes appid 1000', async () => {
        const f = await createFranchise('del-sci')
        await entryPOST({ params: { id: f.id }, request: jsonReq('POST', { appid: 1000 }) } as any)
        const res = await entryDELETE({ params: { id: f.id, appid: '1e3' } } as any)
        expect(res.status).toBe(200)
        expect((await res.json()).entries).toHaveLength(0)
    })
})

describe('PUT /api/franchises/[id]/entries/order', () => {
    async function withEntries(appids: number[]) {
        const f = await createFranchise('order')
        for (const appid of appids) {
            await entryPOST({ params: { id: f.id }, request: jsonReq('POST', { appid }) } as any)
        }
        return f
    }

    it.each([
        ['appids missing', {}],
        ['appids is a string', { appids: 'not-array' }],
        ['appids is a number', { appids: 3 }],
        ['appids is an object', { appids: { 0: 1 } }],
        ['appids is null', { appids: null }],
    ])('400 when %s', async (_label, body) => {
        const f   = await withEntries([1, 2])
        const res = await orderPUT({ params: { id: f.id }, request: jsonReq('PUT', body) } as any)
        expect(res.status).toBe(400)
    })

    it('404 when the franchise does not exist', async () => {
        const res = await orderPUT({ params: { id: 'ghost' }, request: jsonReq('PUT', { appids: [1] }) } as any)
        expect(res.status).toBe(404)
    })

    it('unknown/null appids are ignored and unlisted entries keep their place at the end', async () => {
        const f   = await withEntries([1, 2, 3])
        const res = await orderPUT({
            params:  { id: f.id },
            request: jsonReq('PUT', { appids: [3, 999, null, 1] }),
        } as any)
        expect(res.status).toBe(200)
        expect((await res.json()).entries.map((e: { appid: number }) => e.appid)).toEqual([3, 1, 2])
    })

    it('duplicate appids in the order list do not duplicate entries', async () => {
        const f   = await withEntries([1, 2])
        const res = await orderPUT({
            params:  { id: f.id },
            request: jsonReq('PUT', { appids: [2, 2, 2, 1, 1] }),
        } as any)
        const updated = await res.json()
        expect(updated.entries.map((e: { appid: number }) => e.appid)).toEqual([2, 1])
        expect(updated.entries).toHaveLength(2)
    })

    it('contract: string appids ["2","1"] never match numeric entries — order is unchanged, no error', async () => {
        const f   = await withEntries([1, 2])
        const res = await orderPUT({
            params:  { id: f.id },
            request: jsonReq('PUT', { appids: ['2', '1'] }),
        } as any)
        expect(res.status).toBe(200)
        expect((await res.json()).entries.map((e: { appid: number }) => e.appid)).toEqual([1, 2])
    })

    // BUG: malformed JSON -> blanket catch -> 500; should be 400.
    // src/routes/api/franchises/[id]/entries/order/+server.ts:11-13
    it('returns 400 (not 500) for malformed JSON', async () => {
        const f   = await withEntries([1])
        const res = await orderPUT({ params: { id: f.id }, request: rawReq('PUT', '[[[') } as any)
        expect(res.status).toBe(400)
    })

    // BUG: JSON null body -> destructure throws -> 500; should be 400.
    // src/routes/api/franchises/[id]/entries/order/+server.ts:6
    it('returns 400 (not 500) for a JSON null body', async () => {
        const f   = await withEntries([1])
        const res = await orderPUT({ params: { id: f.id }, request: rawReq('PUT', 'null') } as any)
        expect(res.status).toBe(400)
    })
})
