import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'

import { GET as getAllRoute } from '../../routes/api/local-wishlist/+server.js'
import { GET as getStatus, POST as addRoute, DELETE as removeRoute } from '../../routes/api/local-wishlist/[appid]/+server.js'

// Adversarial tests for the local-wishlist routes. The [appid] mutations make a
// fire-and-forget relay POST — global fetch is stubbed so no real relay is ever
// hit, and we assert both that the relay call happens and that relay failures
// never fail the endpoint response.

function tmpDataDir() {
    return path.join(os.tmpdir(), `lw-routes-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const ev = (appid: string) => ({ params: { appid } } as any)

function okRelayResponse() {
    return { ok: true, status: 200, text: async () => '' }
}

describe('local-wishlist routes (adversarial)', () => {
    let dataDir: string
    let savedDataDir: string | undefined
    let savedRelayUrl: string | undefined
    let savedPort: string | undefined
    let fetchMock: ReturnType<typeof vi.fn>

    beforeEach(() => {
        savedDataDir  = process.env.DATA_DIR
        savedRelayUrl = process.env.RELAY_URL
        savedPort     = process.env.PORT
        dataDir = tmpDataDir()
        process.env.DATA_DIR  = dataDir
        // Provision/patch now fire at the journal's OWN /relay on loopback
        // (fold-in) — keyed off PORT, not RELAY_URL. See journalRelayBase.
        process.env.PORT = '1234'
        fetchMock = vi.fn(async () => okRelayResponse())
        vi.stubGlobal('fetch', fetchMock)
    })

    afterEach(async () => {
        vi.unstubAllGlobals()
        if (savedDataDir === undefined) delete process.env.DATA_DIR
        else process.env.DATA_DIR = savedDataDir
        if (savedRelayUrl === undefined) delete process.env.RELAY_URL
        else process.env.RELAY_URL = savedRelayUrl
        if (savedPort === undefined) delete process.env.PORT
        else process.env.PORT = savedPort
        await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {})
    })

    describe('GET /api/local-wishlist (collection)', () => {
        it('returns { items: {} } when nothing was ever stored', async () => {
            const res = await getAllRoute()
            expect(res.status).toBe(200)
            expect(await res.json()).toEqual({ items: {} })
        })

        it('returns a 500 JSON envelope (not a throw) when DATA_DIR is unset', async () => {
            delete process.env.DATA_DIR
            const res = await getAllRoute()
            expect(res.status).toBe(500)
            expect((await res.json()).error).toMatch(/DATA_DIR/)
        })
    })

    describe('appid validation', () => {
        it.each(['abc', '0', '__proto__', 'NaN', ''])('GET rejects appid %j with 400', async (appid) => {
            const res = await getStatus(ev(appid))
            expect(res.status).toBe(400)
            expect((await res.json()).error).toBe('invalid appid')
        })

        it('POST rejects appid "abc" with 400 and never calls the relay', async () => {
            const res = await addRoute(ev('abc'))
            expect(res.status).toBe(400)
            expect(fetchMock).not.toHaveBeenCalled()
        })

        it('POST rejects appid "0" with 400 (falsy Number)', async () => {
            const res = await addRoute(ev('0'))
            expect(res.status).toBe(400)
        })

        it('DELETE rejects appid "__proto__" with 400 and never calls the relay', async () => {
            const res = await removeRoute(ev('__proto__'))
            expect(res.status).toBe(400)
            expect(fetchMock).not.toHaveBeenCalled()
        })

        // Contract (quirk): validation is just `!Number(appid)` — only falsy values are
        // rejected, so "-1" and "12.5" sail through and even reach the relay admin API.
        it('accepts appid "-1" (only falsy Numbers rejected) and provisions it on the relay', async () => {
            const res = await addRoute(ev('-1'))
            expect(res.status).toBe(200)
            expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:1234/relay/api/admin/provision/-1', { method: 'POST' })
        })

        it('accepts decimal appid "12.5" and stores it under key "12.5"', async () => {
            await addRoute(ev('12.5'))
            const status = await (await getStatus(ev('12.5'))).json()
            expect(status.wishlisted).toBe(true)
        })
    })

    describe('POST /api/local-wishlist/[appid] — relay interaction', () => {
        it('persists the item AND fires exactly one relay provision call', async () => {
            const res = await addRoute(ev('440'))
            expect(res.status).toBe(200)
            const body = await res.json()
            expect(body.ok).toBe(true)
            expect(typeof body.item.dateAdded).toBe('number')
            expect(fetchMock).toHaveBeenCalledTimes(1)
            expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:1234/relay/api/admin/provision/440', { method: 'POST' })
        })

        it('targets the journal\'s own /relay admin route (no double slash)', async () => {
            await addRoute(ev('570'))
            const url = String(fetchMock.mock.calls[0][0])
            expect(url).toBe('http://127.0.0.1:1234/relay/api/admin/provision/570')
            expect(url.replace(/^https?:\/\//, '')).not.toContain('//')
        })

        it('falls back to loopback:5173 when PORT is unset (fetch still stubbed)', async () => {
            delete process.env.PORT
            await addRoute(ev('570'))
            expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:5173/relay/api/admin/provision/570', { method: 'POST' })
        })

        it('still returns 200 when the relay call rejects (network error)', async () => {
            fetchMock.mockRejectedValue(new TypeError('fetch failed'))
            const res = await addRoute(ev('600'))
            expect(res.status).toBe(200)
            expect((await res.json()).ok).toBe(true)
            expect(fetchMock).toHaveBeenCalledTimes(1)
            // and the item really persisted despite the relay being down
            expect((await (await getStatus(ev('600'))).json()).wishlisted).toBe(true)
        })

        it('still returns 200 when the relay answers non-2xx', async () => {
            fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => 'relay sad' })
            const res = await addRoute(ev('601'))
            expect(res.status).toBe(200)
        })

        it('still returns 200 when the relay body text() itself rejects', async () => {
            fetchMock.mockResolvedValue({ ok: false, status: 500, text: () => Promise.reject(new Error('stream died')) })
            const res = await addRoute(ev('602'))
            expect(res.status).toBe(200)
        })

        it('is fire-and-forget — responds even if the relay call NEVER settles', async () => {
            fetchMock.mockReturnValue(new Promise(() => {})) // hangs forever
            const res = await addRoute(ev('603'))
            expect(res.status).toBe(200)
            expect(fetchMock).toHaveBeenCalledTimes(1)
        })

        it('duplicate add is idempotent — same dateAdded, still 200, relay re-fired', async () => {
            const first = await (await addRoute(ev('700'))).json()
            const second = await (await addRoute(ev('700'))).json()
            expect(second.ok).toBe(true)
            expect(second.item.dateAdded).toBe(first.item.dateAdded)
            expect(fetchMock).toHaveBeenCalledTimes(2) // relay provision fires on every add
        })
    })

    describe('DELETE /api/local-wishlist/[appid]', () => {
        it('removing a nonexistent appid still returns { ok: true } and fires the relay patch', async () => {
            const res = await removeRoute(ev('31337'))
            expect(res.status).toBe(200)
            expect(await res.json()).toEqual({ ok: true })
            expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:1234/relay/api/admin/patch/31337', { method: 'POST' })
        })

        it('add → remove round trip clears wishlisted status', async () => {
            await addRoute(ev('800'))
            await removeRoute(ev('800'))
            const status = await (await getStatus(ev('800'))).json()
            expect(status.wishlisted).toBe(false)
        })

        it('still returns 200 when the relay patch call rejects', async () => {
            await addRoute(ev('801'))
            fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
            const res = await removeRoute(ev('801'))
            expect(res.status).toBe(200)
            expect((await (await getStatus(ev('801'))).json()).wishlisted).toBe(false)
        })
    })

    describe('GET /api/local-wishlist/[appid] (status)', () => {
        it('never calls the relay (read-only endpoint)', async () => {
            await getStatus(ev('900'))
            expect(fetchMock).not.toHaveBeenCalled()
        })

        it('normalizes "007" and "7" to the same key', async () => {
            await addRoute(ev('7'))
            const status = await (await getStatus(ev('007'))).json()
            expect(status.wishlisted).toBe(true)
        })

        it('500 JSON envelope when DATA_DIR is unset', async () => {
            delete process.env.DATA_DIR
            const res = await getStatus(ev('1'))
            expect(res.status).toBe(500)
            expect((await res.json()).error).toMatch(/DATA_DIR/)
        })
    })
})
