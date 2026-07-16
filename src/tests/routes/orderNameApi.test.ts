import { describe, it, beforeEach, afterEach, expect } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { GET, PUT } from '../../routes/api/order/[name]/+server.js'

// /api/order/[name] — orderService deliberately does NOT validate names; the
// route is the validation layer. These tests confirm the route actually
// enforces isValidOrderName on both verbs (it does), and that invalid names
// never create `<name>-order.json` files on disk.

function tmpDataDir() {
    return path.join(os.tmpdir(), `order-route-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

const storeDir = (dataDir: string) => path.join(dataDir, 'gaming-journal')

function getReq(name: string) {
    return { params: { name } } as never
}

function putReq(name: string, body: string) {
    return { params: { name }, request: new Request('http://x/api/order/' + encodeURIComponent(name), { method: 'PUT', body }) } as never
}

describe('/api/order/[name]', () => {
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

    describe('name validation (route-level allowlist)', () => {
        const evilNames = ['..%2Fevil', '../evil', '..\\evil', '__proto__', 'constructor', 'a/b', 'in-progress2', 'IN-PROGRESS', '', ' ', 'backlog ', 'null']

        it.each(evilNames)('GET rejects %j with 404 and an error key', async (name) => {
            const res = await GET(getReq(name))
            expect(res.status).toBe(404)
            expect((await res.json()).error).toBe('Unknown order')
        })

        it.each(evilNames)('PUT rejects %j with 404 even with a valid body', async (name) => {
            const res = await PUT(putReq(name, '[1,2,3]'))
            expect(res.status).toBe(404)
        })

        it('invalid names never create <name>-order.json files on disk', async () => {
            await GET(getReq('__proto__'))
            await PUT(putReq('evil-name', '[1]'))
            await PUT(putReq('a/b', '[1]'))
            // Nothing should have been written for any of them — the data dir
            // (or the gaming-journal subdir) simply doesn't exist yet.
            const entries = await fsp.readdir(storeDir(dataDir)).catch(() => [])
            expect(entries).toEqual([])
        })
    })

    describe('GET (valid names)', () => {
        it('returns [] for a valid name with no stored order', async () => {
            for (const name of ['in-progress', 'backlog']) {
                const res = await GET(getReq(name))
                expect(res.status).toBe(200)
                expect(await res.json()).toEqual([])
            }
        })
    })

    describe('PUT body validation', () => {
        // REGRESSION: a malformed body once threw a SyntaxError out of the handler
        // (json() parse sat outside the try/catch). It now returns 400.
        it('returns 400 for a non-JSON body (currently throws uncaught)', async () => {
            const res = await PUT(putReq('backlog', 'not json ['))
            expect(res.status).toBe(400)
        })

        it('returns 400 for a non-array JSON body', async () => {
            const res = await PUT(putReq('backlog', '{"a":1}'))
            expect(res.status).toBe(400)
            expect((await res.json()).error).toMatch(/array of numbers/)
        })

        it('returns 400 for a JSON null body', async () => {
            const res = await PUT(putReq('backlog', 'null'))
            expect(res.status).toBe(400)
        })

        it('returns 400 for an array of numeric strings', async () => {
            const res = await PUT(putReq('backlog', '["1","2"]'))
            expect(res.status).toBe(400)
        })

        it('returns 400 for a mixed array', async () => {
            const res = await PUT(putReq('backlog', '[1,"2",3]'))
            expect(res.status).toBe(400)
        })

        it('returns 400 for an array containing null (what JSON turns NaN into)', async () => {
            const res = await PUT(putReq('backlog', '[1,null]'))
            expect(res.status).toBe(400)
        })

        it('accepts an empty array (clears the order)', async () => {
            const res = await PUT(putReq('in-progress', '[]'))
            expect(res.status).toBe(200)
            expect(await GET(getReq('in-progress')).then(r => r.json())).toEqual([])
        })
    })

    describe('round trips and isolation', () => {
        it('PUT then GET round-trips the exact array, order preserved', async () => {
            const res = await PUT(putReq('backlog', '[440,-1,0,1000,2.5]'))
            expect(res.status).toBe(200)
            expect((await res.json()).ok).toBe(true)
            const got = await GET(getReq('backlog'))
            expect(await got.json()).toEqual([440, -1, 0, 1000, 2.5])
        })

        it('the two order names are separate stores', async () => {
            await PUT(putReq('backlog', '[1,2]'))
            await PUT(putReq('in-progress', '[9]'))
            expect(await GET(getReq('backlog')).then(r => r.json())).toEqual([1, 2])
            expect(await GET(getReq('in-progress')).then(r => r.json())).toEqual([9])
        })

        it('a second PUT fully replaces the previous order (no merge)', async () => {
            await PUT(putReq('backlog', '[1,2,3]'))
            await PUT(putReq('backlog', '[7]'))
            expect(await GET(getReq('backlog')).then(r => r.json())).toEqual([7])
        })
    })

    describe('server errors', () => {
        it('GET returns 500 with an error key when DATA_DIR is unset', async () => {
            delete process.env.DATA_DIR
            const res = await GET(getReq('backlog'))
            expect(res.status).toBe(500)
            expect((await res.json()).error).toMatch(/DATA_DIR/)
        })

        it('PUT returns 500 with an error key when DATA_DIR is unset', async () => {
            delete process.env.DATA_DIR
            const res = await PUT(putReq('backlog', '[1]'))
            expect(res.status).toBe(500)
            expect((await res.json()).error).toMatch(/DATA_DIR/)
        })
    })
})
