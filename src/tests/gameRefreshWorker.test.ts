import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'

// The worker module assigns `self.onmessage` at import time. In jsdom,
// `self === window`, so we import once and drive the handler directly.

type WorkerMsg = { type?: string; id?: unknown; url?: string; postUrl?: string; getUrl?: string }
let handler: (ev: { data: WorkerMsg | null }) => Promise<void>

beforeAll(async () => {
    // @ts-expect-error — side-effect script (assigns self.onmessage), not a module
    await import('../lib/workers/game-refresh.worker.js')
    handler = (self as any).onmessage
    expect(typeof handler).toBe('function')
})

let posted: Array<{ id: unknown; data: unknown }>
let fetchMock: ReturnType<typeof vi.fn>

function res(status: number, body: unknown = { ok: true }, jsonThrows = false) {
    return {
        ok:     status >= 200 && status < 300,
        status,
        json:   async () => {
            if (jsonThrows) throw new SyntaxError('unexpected token')
            return body
        },
    }
}

beforeEach(() => {
    posted    = []
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('postMessage', vi.fn((m: any) => posted.push(m)))
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
})

// ── type: 'get' — direct responses ────────────────────────────────────────────

describe('game-refresh worker — get (no polling)', () => {
    it('posts { id, data } on a 200 response', async () => {
        fetchMock.mockResolvedValueOnce(res(200, { hltb: 42 }))
        await handler({ data: { type: 'get', id: 7, url: '/relay/api/x' } })
        expect(posted).toEqual([{ id: 7, data: { hltb: 42 } }])
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('posts data: null on a non-ok, non-202 response', async () => {
        fetchMock.mockResolvedValueOnce(res(500))
        await handler({ data: { type: 'get', id: 1, url: '/relay/api/x' } })
        expect(posted).toEqual([{ id: 1, data: null }])
    })

    it('posts data: null when fetch rejects', async () => {
        fetchMock.mockRejectedValueOnce(new TypeError('network down'))
        await handler({ data: { type: 'get', id: 2, url: '/relay/api/x' } })
        expect(posted).toEqual([{ id: 2, data: null }])
    })

    it('posts data: null when the 200 body is invalid JSON', async () => {
        fetchMock.mockResolvedValueOnce(res(200, null, true))
        await handler({ data: { type: 'get', id: 3, url: '/relay/api/x' } })
        expect(posted).toEqual([{ id: 3, data: null }])
    })

    it('preserves falsy ids in the reply (id: 0)', async () => {
        fetchMock.mockResolvedValueOnce(res(200, 'body'))
        await handler({ data: { type: 'get', id: 0, url: '/u' } })
        expect(posted).toEqual([{ id: 0, data: 'body' }])
    })
})

// ── type: 'get' — 202 poll loop ───────────────────────────────────────────────

describe('game-refresh worker — 202 polling', () => {
    it('strips a trailing ?fetch=true and polls until success', async () => {
        vi.useFakeTimers()
        fetchMock
            .mockResolvedValueOnce(res(202))
            .mockResolvedValueOnce(res(200, { done: true }))

        const p = handler({ data: { type: 'get', id: 9, url: '/relay/api/section?fetch=true' } })
        await vi.advanceTimersByTimeAsync(2001)
        await p

        expect(fetchMock).toHaveBeenNthCalledWith(1, '/relay/api/section?fetch=true')
        expect(fetchMock).toHaveBeenNthCalledWith(2, '/relay/api/section')
        expect(posted).toEqual([{ id: 9, data: { done: true } }])
    })

    it('strips &fetch=true when other params precede it', async () => {
        vi.useFakeTimers()
        fetchMock
            .mockResolvedValueOnce(res(202))
            .mockResolvedValueOnce(res(200, 'ok'))

        const p = handler({ data: { type: 'get', id: 1, url: '/api/s?appid=5&fetch=true' } })
        await vi.advanceTimersByTimeAsync(2001)
        await p

        expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/s?appid=5')
    })

    it('strips &fetch=true from the middle of the query string', async () => {
        vi.useFakeTimers()
        fetchMock
            .mockResolvedValueOnce(res(202))
            .mockResolvedValueOnce(res(200, 'ok'))

        const p = handler({ data: { type: 'get', id: 1, url: '/api/s?a=1&fetch=true&b=2' } })
        await vi.advanceTimersByTimeAsync(2001)
        await p

        expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/s?a=1&b=2')
    })

    // BUG: game-refresh.worker.js:11 — buildPollUrl removes "?fetch=true" including
    // the "?" when fetch=true is the FIRST param but not the only one, producing a
    // malformed URL like "/api/s&appid=5" (the "\?&" cleanup never matches because
    // the separator was consumed by the first replace).
    it('produces a valid poll URL when fetch=true is first of several params', async () => {
        vi.useFakeTimers()
        fetchMock
            .mockResolvedValueOnce(res(202))
            .mockResolvedValueOnce(res(200, 'ok'))

        const p = handler({ data: { type: 'get', id: 1, url: '/api/s?fetch=true&appid=5' } })
        await vi.advanceTimersByTimeAsync(2001)
        await p

        expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/s?appid=5')
    })

    it('keeps polling through 404s, then succeeds', async () => {
        vi.useFakeTimers()
        fetchMock
            .mockResolvedValueOnce(res(202))
            .mockResolvedValueOnce(res(404))
            .mockResolvedValueOnce(res(404))
            .mockResolvedValueOnce(res(200, { v: 1 }))

        const p = handler({ data: { type: 'get', id: 5, url: '/api/s?fetch=true' } })
        await vi.advanceTimersByTimeAsync(3 * 2000 + 10)
        await p

        expect(fetchMock).toHaveBeenCalledTimes(4)
        expect(posted).toEqual([{ id: 5, data: { v: 1 } }])
    })

    it('gives up with null after 8 polls of 404', async () => {
        vi.useFakeTimers()
        fetchMock.mockResolvedValueOnce(res(202))
        for (let i = 0; i < 8; i++) fetchMock.mockResolvedValueOnce(res(404))

        const p = handler({ data: { type: 'get', id: 6, url: '/api/s?fetch=true' } })
        await vi.advanceTimersByTimeAsync(8 * 2000 + 10)
        await p

        expect(fetchMock).toHaveBeenCalledTimes(9)
        expect(posted).toEqual([{ id: 6, data: null }])
    })

    it('stops polling immediately on an unexpected error status (500)', async () => {
        vi.useFakeTimers()
        fetchMock
            .mockResolvedValueOnce(res(202))
            .mockResolvedValueOnce(res(500))

        const p = handler({ data: { type: 'get', id: 7, url: '/api/s?fetch=true' } })
        await vi.advanceTimersByTimeAsync(2001)
        await p

        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(posted).toEqual([{ id: 7, data: null }])
    })

    it('stops polling when a poll fetch throws', async () => {
        vi.useFakeTimers()
        fetchMock
            .mockResolvedValueOnce(res(202))
            .mockRejectedValueOnce(new TypeError('conn reset'))

        const p = handler({ data: { type: 'get', id: 8, url: '/api/s?fetch=true' } })
        await vi.advanceTimersByTimeAsync(2001)
        await p

        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(posted).toEqual([{ id: 8, data: null }])
    })

    it('a bare URL without fetch=true polls the same URL', async () => {
        vi.useFakeTimers()
        fetchMock
            .mockResolvedValueOnce(res(202))
            .mockResolvedValueOnce(res(200, 'ok'))

        const p = handler({ data: { type: 'get', id: 1, url: '/api/plain' } })
        await vi.advanceTimersByTimeAsync(2001)
        await p

        expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/plain')
    })
})

// ── type: 'post_get' ──────────────────────────────────────────────────────────

describe('game-refresh worker — post_get', () => {
    it('POSTs then GETs and posts the GET body', async () => {
        fetchMock
            .mockResolvedValueOnce(res(200))            // POST
            .mockResolvedValueOnce(res(200, { g: 1 }))  // GET

        await handler({ data: { type: 'post_get', id: 11, postUrl: '/api/refresh', getUrl: '/api/data' } })

        expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/refresh', { method: 'POST' })
        expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/data')
        expect(posted).toEqual([{ id: 11, data: { g: 1 } }])
    })

    it('a failed POST short-circuits to data: null (GET never happens)', async () => {
        fetchMock.mockRejectedValueOnce(new TypeError('post failed'))
        await handler({ data: { type: 'post_get', id: 12, postUrl: '/p', getUrl: '/g' } })
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(posted).toEqual([{ id: 12, data: null }])
    })

    it('a non-ok POST is ignored — the GET still runs (contract)', async () => {
        fetchMock
            .mockResolvedValueOnce(res(500))            // POST result unchecked
            .mockResolvedValueOnce(res(200, 'fresh'))
        await handler({ data: { type: 'post_get', id: 13, postUrl: '/p', getUrl: '/g' } })
        expect(posted).toEqual([{ id: 13, data: 'fresh' }])
    })

    it('a non-ok GET posts data: null', async () => {
        fetchMock
            .mockResolvedValueOnce(res(200))
            .mockResolvedValueOnce(res(503))
        await handler({ data: { type: 'post_get', id: 14, postUrl: '/p', getUrl: '/g' } })
        expect(posted).toEqual([{ id: 14, data: null }])
    })

    it('an invalid-JSON GET body posts data: null via the catch-all', async () => {
        fetchMock
            .mockResolvedValueOnce(res(200))
            .mockResolvedValueOnce(res(200, null, true))
        await handler({ data: { type: 'post_get', id: 15, postUrl: '/p', getUrl: '/g' } })
        expect(posted).toEqual([{ id: 15, data: null }])
    })
})

// ── Malformed messages ────────────────────────────────────────────────────────

describe('game-refresh worker — malformed messages', () => {
    it('an unknown type posts nothing (contract: caller would wait forever)', async () => {
        await handler({ data: { type: 'delete', id: 20, url: '/x' } })
        expect(fetchMock).not.toHaveBeenCalled()
        expect(posted).toEqual([])
    })

    it('a message with no type posts nothing', async () => {
        await handler({ data: { id: 21 } })
        expect(posted).toEqual([])
    })

    it('a null message rejects (contract: destructuring happens outside the try)', async () => {
        await expect(handler({ data: null })).rejects.toThrow(TypeError)
        expect(posted).toEqual([])
    })
})
