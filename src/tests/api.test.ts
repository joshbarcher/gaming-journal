import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { api } from '../lib/js/api.js'

let fetchMock: ReturnType<typeof vi.fn>

function jsonRes(body: unknown, status = 200) {
    return {
        ok:     status >= 200 && status < 300,
        status,
        json:   () => Promise.resolve(body),
    }
}

// A response whose body is not valid JSON (e.g. an HTML error page).
function htmlRes(status: number) {
    return {
        ok:     status >= 200 && status < 300,
        status,
        json:   () => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0')),
    }
}

beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

// ── URL and method construction ───────────────────────────────────────────────

describe('request — URL and method construction', () => {
    it('pages.list issues GET /api/pages with no body and no Content-Type', async () => {
        fetchMock.mockResolvedValue(jsonRes([]))
        await api.pages.list()
        expect(fetchMock).toHaveBeenCalledWith('/api/pages', { method: 'GET', headers: {} })
        const opts = fetchMock.mock.calls[0][1]
        expect(opts.body).toBeUndefined()
        expect(opts.headers['Content-Type']).toBeUndefined()
    })

    it('pages.create issues POST with JSON Content-Type and stringified body', async () => {
        fetchMock.mockResolvedValue(jsonRes({ id: '1' }))
        const body = { title: 'X', type: 'notes' }
        await api.pages.create(body)
        const [url, opts] = fetchMock.mock.calls[0]
        expect(url).toBe('/api/pages')
        expect(opts.method).toBe('POST')
        expect(opts.headers['Content-Type']).toBe('application/json')
        expect(opts.body).toBe(JSON.stringify(body))
    })

    it('localReviews.updateNote uses PATCH with the nested note path', async () => {
        fetchMock.mockResolvedValue(jsonRes({}))
        await api.localReviews.updateNote(440, 'n7', { text: 'hi' })
        const [url, opts] = fetchMock.mock.calls[0]
        expect(url).toBe('/api/local-reviews/440/notes/n7')
        expect(opts.method).toBe('PATCH')
    })

    it('franchises.removeEntry uses DELETE on the entry path', async () => {
        fetchMock.mockResolvedValue(jsonRes({}))
        await api.franchises.removeEntry('f1', 570)
        expect(fetchMock.mock.calls[0][0]).toBe('/api/franchises/f1/entries/570')
        expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
    })

    it('pages.reorder wraps ids in an object body', async () => {
        fetchMock.mockResolvedValue(jsonRes({}))
        await api.pages.reorder(['a', 'b'])
        expect(fetchMock.mock.calls[0][1].body).toBe('{"ids":["a","b"]}')
    })

    it('journalNotes.set sends a raw array as the JSON body', async () => {
        fetchMock.mockResolvedValue(jsonRes({}))
        await api.journalNotes.set(440, [{ t: 1 }])
        expect(fetchMock.mock.calls[0][1].body).toBe('[{"t":1}]')
    })

    it('preserves unicode in the JSON body', async () => {
        fetchMock.mockResolvedValue(jsonRes({}))
        await api.pages.create({ title: 'ファイナル 🎮 déjà' })
        expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({ title: 'ファイナル 🎮 déjà' }))
    })

    // Path/query segments are raw template interpolation — no encodeURIComponent.
    // Contract tests documenting that a hostile id/appid can alter the request
    // (path traversal, extra query params). In practice ids are server-generated,
    // but the door is open.
    it('does NOT URL-encode path segments (documents raw interpolation)', async () => {
        fetchMock.mockResolvedValue(jsonRes({}))
        await api.pages.get('abc/../../etc')
        expect(fetchMock.mock.calls[0][0]).toBe('/api/pages/abc/../../etc')
    })

    it('does NOT URL-encode query values (documents parameter injection surface)', async () => {
        fetchMock.mockResolvedValue(jsonRes([]))
        await api.pages.listByGame('440&admin=1')
        expect(fetchMock.mock.calls[0][0]).toBe('/api/pages?appid=440&admin=1')
    })

    it('an explicit null body is still serialized and sent with Content-Type', async () => {
        fetchMock.mockResolvedValue(jsonRes({}))
        await api.pages.create(null)
        const opts = fetchMock.mock.calls[0][1]
        expect(opts.body).toBe('null')
        expect(opts.headers['Content-Type']).toBe('application/json')
    })
})

// ── response handling ─────────────────────────────────────────────────────────

describe('request — response handling', () => {
    it('returns parsed JSON for an ok response', async () => {
        fetchMock.mockResolvedValue(jsonRes({ id: 'p1', title: 'T' }))
        await expect(api.pages.get('p1')).resolves.toEqual({ id: 'p1', title: 'T' })
    })

    it('returns null for a 204 response without touching the body', async () => {
        const json = vi.fn(() => Promise.reject(new Error('body should not be read')))
        fetchMock.mockResolvedValue({ ok: true, status: 204, json })
        await expect(api.pages.remove('p1')).resolves.toBeNull()
        expect(json).not.toHaveBeenCalled()
    })

    it('throws the server-provided error message on a non-ok response', async () => {
        fetchMock.mockResolvedValue(jsonRes({ error: 'page not found' }, 404))
        await expect(api.pages.get('nope')).rejects.toThrow('page not found')
    })

    it('falls back to "HTTP <status>" when the error body has no error field', async () => {
        fetchMock.mockResolvedValue(jsonRes({ message: 'other shape' }, 500))
        await expect(api.pages.list()).rejects.toThrow('HTTP 500')
    })

    it('propagates network-level fetch rejections', async () => {
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
        await expect(api.pages.list()).rejects.toThrow('Failed to fetch')
    })

    it('rejects when an ok response has an invalid JSON body (contract: SyntaxError propagates)', async () => {
        fetchMock.mockResolvedValue(htmlRes(200))
        await expect(api.pages.list()).rejects.toThrow(SyntaxError)
    })

    // BUG: api.ts:12 — on a non-ok response the body is parsed with res.json()
    // BEFORE the status check, so a non-JSON error body (e.g. an HTML 502 page
    // from a proxy) rejects with a bare SyntaxError and the HTTP status is lost.
    // Correct behavior: surface "HTTP 502".
    it('surfaces the HTTP status when a non-ok response body is not JSON', async () => {
        fetchMock.mockResolvedValue(htmlRes(502))
        await expect(api.pages.list()).rejects.toThrow('HTTP 502')
    })

    // BUG: api.ts:13 — `data.error` is read without a null check; a non-ok
    // response whose body is the JSON literal `null` throws
    // "TypeError: Cannot read properties of null" instead of Error("HTTP 500").
    it('throws "HTTP 500" when a non-ok response body is JSON null', async () => {
        fetchMock.mockResolvedValue(jsonRes(null, 500))
        await expect(api.pages.list()).rejects.toThrow('HTTP 500')
    })

    it('a non-Error error field is still surfaced (contract: Error message is stringified)', async () => {
        fetchMock.mockResolvedValue(jsonRes({ error: 42 }, 400))
        await expect(api.pages.list()).rejects.toThrow('42')
    })
})
