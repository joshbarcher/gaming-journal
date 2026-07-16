import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { GET as getPages, POST as postPage } from '../../routes/api/pages/+server.js'
import { GET as getPage, PUT as putPage, DELETE as deletePage } from '../../routes/api/pages/[id]/+server.js'
import { PUT as putOrder } from '../../routes/api/pages/order/+server.js'
import { getJournalService } from '../../lib/server/services/journalService.js'

// getJournalService() caches a module-level singleton that reads DATA_DIR on
// first call — one DATA_DIR for this whole file (set before any handler runs),
// unique pages per test. Vitest isolates files, so the singleton is ours alone.

const dataDir = path.join(os.tmpdir(), `pages-route-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
let savedDataDir: string | undefined

beforeAll(async () => {
    savedDataDir = process.env.DATA_DIR
    process.env.DATA_DIR = dataDir
    // In production hooks.server.ts loads the store at boot; mirror that here.
    await getJournalService().load()
})

afterAll(async () => {
    await getJournalService().close()
    if (savedDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = savedDataDir
    await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

function postReq(body: unknown): { request: Request } {
    return { request: new Request('http://x/api/pages', { method: 'POST', body: JSON.stringify(body) }) }
}

function rawPostReq(body?: string): { request: Request } {
    return { request: new Request('http://x/api/pages', { method: 'POST', body }) }
}

async function createPage(body: Record<string, unknown>): Promise<{ id: string } & Record<string, unknown>> {
    const res = await postPage(postReq(body) as never)
    expect(res.status).toBe(201)
    return res.json()
}

describe('POST /api/pages — body validation', () => {
    // BUG: `await request.json()` (src/routes/api/pages/+server.ts:14) is outside
    // the try/catch — a non-JSON body makes the handler throw a SyntaxError
    // instead of returning 400. In production that surfaces as a 500 crash page.
    it('returns 400 for a non-JSON body (currently throws uncaught)', async () => {
        const res = await postPage(rawPostReq('this is {{{ not json') as never)
        expect(res.status).toBe(400)
    })

    // BUG: same line — an empty body also rejects out of the handler.
    it('returns 400 for an empty body (currently throws uncaught)', async () => {
        const res = await postPage(rawPostReq() as never)
        expect(res.status).toBe(400)
    })

    it('returns 400 with an error key when type and title are missing', async () => {
        const res = await postPage(postReq({}) as never)
        expect(res.status).toBe(400)
        const body = await res.json()
        expect(typeof body.error).toBe('string')
    })

    it('returns 400 when only title is given', async () => {
        const res = await postPage(postReq({ title: 'no type' }) as never)
        expect(res.status).toBe(400)
    })

    it('returns 400 when only type is given', async () => {
        const res = await postPage(postReq({ type: 'page' }) as never)
        expect(res.status).toBe(400)
    })

    it('returns 400 for an invalid page type, listing the valid ones', async () => {
        const res = await postPage(postReq({ type: 'hacker-type', title: 't' }) as never)
        expect(res.status).toBe(400)
        const body = await res.json()
        expect(body.error).toMatch(/type must be one of/)
    })

    it('returns 400 for a wrong-typed type field (type: 42)', async () => {
        const res = await postPage(postReq({ type: 42, title: 't' }) as never)
        expect(res.status).toBe(400)
    })

    it('returns 400 for an empty-string title (conflated with "missing", but still 400)', async () => {
        const res = await postPage(postReq({ type: 'page', title: '' }) as never)
        expect(res.status).toBe(400)
    })

    // BUG: the route only truthiness-checks title (src/routes/api/pages/+server.ts:15) —
    // `title: 42` and `title: {}` are accepted and persisted, violating the Page
    // contract (string title). A `{}` title renders as [object Object] downstream.
    it('rejects a non-string title with 400 (currently persists numbers/objects)', async () => {
        const res = await postPage(postReq({ type: 'page', title: 42 }) as never)
        expect(res.status).toBe(400)
        const res2 = await postPage(postReq({ type: 'page', title: { nested: true } }) as never)
        expect(res2.status).toBe(400)
    })

    // BUG: for type 'progress', a non-array `tasks` skips the id-mapping branch
    // (src/routes/api/pages/+server.ts:19) and the raw value overrides the
    // typeDefaults' `tasks: []` in JournalService.create — the page persists with
    // tasks: "corrupt", which crashes any consumer that does tasks.map(...).
    it('rejects a progress page whose tasks is not an array (currently persists the garbage)', async () => {
        const res = await postPage(postReq({ type: 'progress', title: 'p', tasks: 'corrupt' }) as never)
        expect(res.status).toBe(400)
    })
})

describe('POST /api/pages — field injection', () => {
    it('ignores a client-supplied id (server generates its own)', async () => {
        const page = await createPage({ type: 'page', title: 'inj', id: 'evil-id' })
        expect(page.id).not.toBe('evil-id')
        expect(typeof page.id).toBe('string')
    })

    it('ignores client-supplied createdAt/updatedAt (server stamps its own)', async () => {
        const page = await createPage({ type: 'page', title: 'stamp', createdAt: '1999-01-01T00:00:00.000Z', updatedAt: '1999-01-01T00:00:00.000Z' })
        expect(page.createdAt).not.toBe('1999-01-01T00:00:00.000Z')
        expect(Number.isNaN(new Date(page.createdAt as string).getTime())).toBe(false)
    })

    it('a "__proto__" key in the body does not pollute Object.prototype', async () => {
        const res = await postPage(rawPostReq('{"type":"page","title":"pp","__proto__":{"polluted":true}}') as never)
        expect(res.status).toBe(201)
        expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    })

    it('assigns unique ids and null state to progress tasks that lack them', async () => {
        const page = await createPage({ type: 'progress', title: 'tasks', tasks: [{ text: 'a' }, { text: 'b' }] })
        const tasks = page.tasks as Array<{ id: string; state: unknown }>
        expect(tasks).toHaveLength(2)
        expect(tasks[0].id).toBeTruthy()
        expect(tasks[1].id).toBeTruthy()
        expect(tasks[0].id).not.toBe(tasks[1].id)
        expect(tasks[0].state).toBeNull()
    })
})

describe('GET /api/pages — appid filter', () => {
    it('filters by a string appid', async () => {
        const page = await createPage({ type: 'page', title: 'str-appid', appid: '73441' })
        const res = getPages({ url: new URL('http://x/api/pages?appid=73441') } as never)
        const list = await res.json()
        expect(list.some((p: { id: string }) => p.id === page.id)).toBe(true)
    })

    it('does not leak other appids into a filtered response', async () => {
        const mine = await createPage({ type: 'page', title: 'iso-a', appid: '111222' })
        await createPage({ type: 'page', title: 'iso-b', appid: '333444' })
        const res = getPages({ url: new URL('http://x/api/pages?appid=111222') } as never)
        const list = await res.json()
        expect(list.every((p: { appid?: string }) => p.appid === '111222')).toBe(true)
        expect(list.some((p: { id: string }) => p.id === mine.id)).toBe(true)
    })

    // BUG: POST accepts any `appid` type into ...rest, but the GET filter
    // (src/routes/api/pages/+server.ts:9) compares `p.appid === String(appid)`
    // without coercing the STORED side — a page created with a numeric appid
    // (440, not "440") is invisible to ?appid=440 forever. JournalService.getByAppid
    // heals this with String(p.appid); the route forgot to.
    it('finds pages whose appid was stored as a number', async () => {
        const page = await createPage({ type: 'page', title: 'num-appid', appid: 987654 })
        const res = getPages({ url: new URL('http://x/api/pages?appid=987654') } as never)
        const list = await res.json()
        expect(list.some((p: { id: string }) => p.id === page.id)).toBe(true)
    })

    it('appid=__proto__ matches nothing and does not throw', async () => {
        const res = getPages({ url: new URL('http://x/api/pages?appid=__proto__') } as never)
        const list = await res.json()
        expect(Array.isArray(list)).toBe(true)
        expect(list).toHaveLength(0)
    })
})

describe('GET/PUT/DELETE /api/pages/[id]', () => {
    it('GET returns 404 with an error key for a nonexistent id', async () => {
        const res = getPage({ params: { id: 'no-such-page' } } as never)
        expect(res.status).toBe(404)
        expect((await res.json()).error).toBeTruthy()
    })

    it('GET returns 404 for id "__proto__" (not Object.prototype)', async () => {
        const res = getPage({ params: { id: '__proto__' } } as never)
        expect(res.status).toBe(404)
    })

    // BUG: `await request.json()` (src/routes/api/pages/[id]/+server.ts:12) is
    // OUTSIDE the try/catch — a malformed body throws out of the handler instead
    // of returning 400.
    it('PUT returns 400 for a non-JSON body (currently throws uncaught)', async () => {
        const page = await createPage({ type: 'page', title: 'put-bad-body' })
        const res = await putPage({
            params: { id: page.id },
            request: new Request('http://x', { method: 'PUT', body: '{{{nope' }),
        } as never)
        expect(res.status).toBe(400)
    })

    it('PUT returns 404 for a nonexistent id with a valid body', async () => {
        const res = await putPage({
            params: { id: 'ghost' },
            request: new Request('http://x', { method: 'PUT', body: JSON.stringify({ title: 'x' }) }),
        } as never)
        expect(res.status).toBe(404)
        expect((await res.json()).error).toBeTruthy()
    })

    it('PUT protects id, type, and createdAt from being overwritten', async () => {
        const page = await createPage({ type: 'page', title: 'protected' })
        const res = await putPage({
            params: { id: page.id },
            request: new Request('http://x', {
                method: 'PUT',
                body: JSON.stringify({ id: 'hacked', type: 'list', createdAt: '1999-01-01', title: 'renamed' }),
            }),
        } as never)
        expect(res.status).toBe(200)
        const updated = await res.json()
        expect(updated.id).toBe(page.id)
        expect(updated.type).toBe('page')
        expect(updated.createdAt).toBe(page.createdAt)
        expect(updated.title).toBe('renamed')
    })

    it('PUT applies arbitrary field values without validation (documented leniency — title: null persists)', async () => {
        // Contract test: update() spreads whatever survives the id/type/createdAt
        // strip. There is no schema validation on updates; this documents it.
        const page = await createPage({ type: 'page', title: 'null-me' })
        const res = await putPage({
            params: { id: page.id },
            request: new Request('http://x', { method: 'PUT', body: JSON.stringify({ title: null }) }),
        } as never)
        expect(res.status).toBe(200)
        expect((await res.json()).title).toBeNull()
    })

    it('PUT with a JSON "null" body is rejected with 400 and leaves the page untouched', async () => {
        const page = await createPage({ type: 'page', title: 'null-body' })
        const res = await putPage({
            params: { id: page.id },
            request: new Request('http://x', { method: 'PUT', body: 'null' }),
        } as never)
        expect(res.status).toBe(400)
        const got = await getPage({ params: { id: page.id } } as never)
        expect((await got.json()).title).toBe('null-body')
    })

    it('DELETE returns 404 for a nonexistent id', async () => {
        const res = await deletePage({ params: { id: 'never-was' } } as never)
        expect(res.status).toBe(404)
        expect((await res.json()).error).toBeTruthy()
    })

    it('DELETE is 204 then 404 on repeat (no 500, no silent success)', async () => {
        const page = await createPage({ type: 'page', title: 'delete-twice' })
        const first = await deletePage({ params: { id: page.id } } as never)
        expect(first.status).toBe(204)
        expect(first.body).toBeNull()
        const second = await deletePage({ params: { id: page.id } } as never)
        expect(second.status).toBe(404)
        const gone = getPage({ params: { id: page.id } } as never)
        expect(gone.status).toBe(404)
    })
})

describe('PUT /api/pages/order', () => {
    function orderReq(body: string): { request: Request } {
        return { request: new Request('http://x/api/pages/order', { method: 'PUT', body }) }
    }

    // BUG: `await request.json()` (src/routes/api/pages/order/+server.ts:6) is
    // outside the try/catch — malformed body throws instead of 400.
    it('returns 400 for a non-JSON body (currently throws uncaught)', async () => {
        const res = await putOrder(orderReq('][') as never)
        expect(res.status).toBe(400)
    })

    it('returns 400 when ids is a string', async () => {
        const res = await putOrder(orderReq(JSON.stringify({ ids: 'not-array' })) as never)
        expect(res.status).toBe(400)
        expect((await res.json()).error).toMatch(/ids array/)
    })

    it('returns 400 when ids is missing', async () => {
        const res = await putOrder(orderReq('{}') as never)
        expect(res.status).toBe(400)
    })

    it('returns 400 for a JSON null body', async () => {
        const res = await putOrder(orderReq('null') as never)
        expect(res.status).toBe(400)
    })

    it('reorders pages and leaves unnamed pages behind the named ones', async () => {
        const a = await createPage({ type: 'page', title: 'ord-a' })
        const b = await createPage({ type: 'page', title: 'ord-b' })
        const res = await putOrder(orderReq(JSON.stringify({ ids: [b.id, a.id] })) as never)
        expect(res.status).toBe(200)
        expect((await res.json()).ok).toBe(true)

        const all = await getPages({ url: new URL('http://x/api/pages') } as never).json()
        const idxA = all.findIndex((p: { id: string }) => p.id === a.id)
        const idxB = all.findIndex((p: { id: string }) => p.id === b.id)
        expect(idxB).toBeGreaterThanOrEqual(0)
        expect(idxB).toBeLessThan(idxA)
    })

    it('unknown and duplicate ids are ignored without dropping or duplicating pages', async () => {
        const a = await createPage({ type: 'page', title: 'dupe-a' })
        const before = (await getPages({ url: new URL('http://x/api/pages') } as never).json()).length
        const res = await putOrder(orderReq(JSON.stringify({ ids: [a.id, a.id, 'ghost-id'] })) as never)
        expect(res.status).toBe(200)
        const after = await getPages({ url: new URL('http://x/api/pages') } as never).json()
        expect(after.length).toBe(before)
        expect(after.filter((p: { id: string }) => p.id === a.id)).toHaveLength(1)
    })

    it('non-string ids elements are tolerated (no crash, no reorder effect)', async () => {
        // Contract test: numbers/booleans miss the id map and every page simply
        // keeps its relative order — lenient but harmless.
        const res = await putOrder(orderReq(JSON.stringify({ ids: [42, true, null] })) as never)
        expect(res.status).toBe(200)
        expect((await res.json()).ok).toBe(true)
    })
})
