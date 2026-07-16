import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'

import { GET, POST, PUT, PATCH, DELETE } from '../../routes/relay/[...path]/+server.js'

// Adversarial tests for the /relay/[...path] proxy. Global fetch is stubbed —
// no real relay is ever contacted. The proxy passes an undici `dispatcher` in
// its RequestInit; the stub receives and records it.

interface Captured {
    url:  string
    opts: {
        method:     string
        headers:    Headers
        body:       ArrayBuffer | undefined
        dispatcher: unknown
    }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function ev(url: string, init: RequestInit = {}): any {
    const u = new URL(url)
    return { url: u, request: new Request(u, init) }
}

describe('relay proxy route (adversarial)', () => {
    let savedRelayUrl: string | undefined
    let calls: Captured[]
    let fetchMock: ReturnType<typeof vi.fn>

    function stubFetch(respond: () => Response | Promise<Response> = () => new Response('ok')) {
        calls = []
        fetchMock = vi.fn(async (url: string | URL, opts: any) => {
            calls.push({ url: String(url), opts })
            return respond()
        })
        vi.stubGlobal('fetch', fetchMock)
    }

    beforeEach(() => {
        savedRelayUrl = process.env.RELAY_URL
        process.env.RELAY_URL = 'http://relay.test:9999'
        stubFetch()
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        if (savedRelayUrl === undefined) delete process.env.RELAY_URL
        else process.env.RELAY_URL = savedRelayUrl
    })

    describe('path mapping', () => {
        it('maps /relay/api/x to RELAY_URL/api/x', async () => {
            await GET(ev('http://app.local/relay/api/games'))
            expect(calls[0].url).toBe('http://relay.test:9999/api/games')
        })

        it('strips a trailing slash from RELAY_URL', async () => {
            process.env.RELAY_URL = 'http://relay.test:9999/'
            await GET(ev('http://app.local/relay/api/games'))
            expect(calls[0].url).toBe('http://relay.test:9999/api/games')
        })

        it('only strips the LEADING /relay — a later /relay segment survives', async () => {
            await GET(ev('http://app.local/relay/api/relay/things'))
            expect(calls[0].url).toBe('http://relay.test:9999/api/relay/things')
        })
    })

    describe('query-string forwarding', () => {
        it('forwards the search string verbatim, weird encodings included', async () => {
            await GET(ev('http://app.local/relay/api/search?q=a%20b&plus=1+2&tick=%E2%9C%93&amp=%26&empty='))
            expect(calls[0].url).toBe('http://relay.test:9999/api/search?q=a%20b&plus=1+2&tick=%E2%9C%93&amp=%26&empty=')
        })

        it('forwards an encoded traversal inside the QUERY untouched (relay must handle it)', async () => {
            await GET(ev('http://app.local/relay/api/files?path=..%2F..%2Fetc%2Fpasswd'))
            expect(calls[0].url).toBe('http://relay.test:9999/api/files?path=..%2F..%2Fetc%2Fpasswd')
        })

        it('sends no "?" when there is no query', async () => {
            await GET(ev('http://app.local/relay/api/games'))
            expect(calls[0].url).not.toContain('?')
        })
    })

    describe('path traversal', () => {
        // Contract: the WHATWG URL parser collapses dot segments — including
        // percent-encoded %2e%2e — BEFORE the handler sees url.pathname, so a
        // single-encoded traversal cannot climb above the relay root; it just
        // becomes a normal relay path with the /relay prefix consumed.
        it('single-encoded %2e%2e is collapsed by URL normalization before the proxy runs', async () => {
            const e = ev('http://app.local/relay/%2e%2e/api/secret')
            expect(e.url.pathname).toBe('/api/secret') // normalized: no /relay prefix left
            await GET(e)
            expect(calls[0].url).toBe('http://relay.test:9999/api/secret')
        })

        it('literal /relay/../api collapses the same way', async () => {
            const e = ev('http://app.local/relay/../api')
            expect(e.url.pathname).toBe('/api')
            await GET(e)
            expect(calls[0].url).toBe('http://relay.test:9999/api')
        })

        // Contract: a DOUBLE-encoded traversal (%252e%252e) survives URL parsing as-is
        // and is forwarded to the relay verbatim. The relay's HTTP parser will decode it
        // once to the literal string "%2e%2e" — harmless UNLESS the relay decodes twice.
        // This test pins down exactly what crosses the wire so that exposure is explicit.
        it('double-encoded %252e%252e is forwarded to the relay verbatim', async () => {
            const e = ev('http://app.local/relay/%252e%252e/%252e%252e/etc/passwd')
            expect(e.url.pathname).toBe('/relay/%252e%252e/%252e%252e/etc/passwd')
            await GET(e)
            expect(calls[0].url).toBe('http://relay.test:9999/%252e%252e/%252e%252e/etc/passwd')
        })
    })

    describe('request header filtering', () => {
        it('forwards ONLY content-type / accept / range — cookie and authorization must not leak', async () => {
            await GET(ev('http://app.local/relay/api/games', {
                headers: {
                    'content-type':  'application/json',
                    'accept':        'application/json',
                    'range':         'bytes=0-1023',
                    'cookie':        'session=SUPER_SECRET',
                    'authorization': 'Bearer SUPER_SECRET_TOKEN',
                    'x-api-key':     'also-secret',
                    'referer':       'http://app.local/private-page',
                },
            }))
            const h = calls[0].opts.headers
            expect(h.get('content-type')).toBe('application/json')
            expect(h.get('accept')).toBe('application/json')
            expect(h.get('range')).toBe('bytes=0-1023')
            expect(h.has('cookie')).toBe(false)
            expect(h.has('authorization')).toBe(false)
            expect(h.has('x-api-key')).toBe(false)
            expect(h.has('referer')).toBe(false)
            // exactly the three allowlisted headers, nothing else
            expect([...h.keys()].sort()).toEqual(['accept', 'content-type', 'range'])
        })

        it('omits allowlisted headers entirely when the client did not send them', async () => {
            await GET(ev('http://app.local/relay/api/games'))
            const h = calls[0].opts.headers
            expect([...h.keys()]).toEqual([])
        })
    })

    describe('SSE agent routing', () => {
        it('accept: text/event-stream uses a DIFFERENT dispatcher than normal API calls', async () => {
            await GET(ev('http://app.local/relay/api/games'))
            await GET(ev('http://app.local/relay/api/events', { headers: { accept: 'text/event-stream' } }))
            const [api, sse] = calls
            expect(api.opts.dispatcher).toBeDefined()
            expect(sse.opts.dispatcher).toBeDefined()
            expect(sse.opts.dispatcher).not.toBe(api.opts.dispatcher)
        })

        it('normal API calls all reuse the same persistent dispatcher', async () => {
            await GET(ev('http://app.local/relay/api/a'))
            await POST(ev('http://app.local/relay/api/b', { method: 'POST', body: 'x' }))
            expect(calls[0].opts.dispatcher).toBe(calls[1].opts.dispatcher)
        })

        // Contract: SSE detection is an EXACT string match — a composite accept header
        // like "text/event-stream, text/html" rides the regular API pool.
        it('a composite accept header does NOT select the SSE pool (exact-match contract)', async () => {
            await GET(ev('http://app.local/relay/api/a'))
            await GET(ev('http://app.local/relay/api/events', { headers: { accept: 'text/event-stream, text/html' } }))
            expect(calls[1].opts.dispatcher).toBe(calls[0].opts.dispatcher)
        })
    })

    describe('body forwarding', () => {
        it('forwards a POST body as an ArrayBuffer with the exact bytes', async () => {
            await POST(ev('http://app.local/relay/api/things', {
                method:  'POST',
                headers: { 'content-type': 'application/json' },
                body:    '{"hello":"wörld"}',
            }))
            const body = calls[0].opts.body
            expect(body).toBeInstanceOf(ArrayBuffer)
            expect(new TextDecoder().decode(body)).toBe('{"hello":"wörld"}')
            expect(calls[0].opts.method).toBe('POST')
        })

        it('GET sends NO body (undefined, not an empty buffer)', async () => {
            await GET(ev('http://app.local/relay/api/games'))
            expect(calls[0].opts.body).toBeUndefined()
        })

        it('a bodyless DELETE forwards a zero-length ArrayBuffer (non-GET/HEAD always reads the body)', async () => {
            await DELETE(ev('http://app.local/relay/api/things/1', { method: 'DELETE' }))
            const body = calls[0].opts.body
            expect(body).toBeInstanceOf(ArrayBuffer)
            expect((body as ArrayBuffer).byteLength).toBe(0)
            expect(calls[0].opts.method).toBe('DELETE')
        })

        it('PUT and PATCH forward their method and body', async () => {
            await PUT(ev('http://app.local/relay/api/a', { method: 'PUT', body: 'put-body' }))
            await PATCH(ev('http://app.local/relay/api/b', { method: 'PATCH', body: 'patch-body' }))
            expect(calls[0].opts.method).toBe('PUT')
            expect(new TextDecoder().decode(calls[0].opts.body)).toBe('put-body')
            expect(calls[1].opts.method).toBe('PATCH')
            expect(new TextDecoder().decode(calls[1].opts.body)).toBe('patch-body')
        })
    })

    describe('relay failure', () => {
        it('relay unreachable → 502 JSON envelope, not a thrown error', async () => {
            vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed: ECONNREFUSED') }))
            const res = await GET(ev('http://app.local/relay/api/games'))
            expect(res.status).toBe(502)
            expect(res.headers.get('content-type')).toBe('application/json')
            expect(await res.json()).toEqual({ error: 'Relay server unreachable' })
        })

        it('a failing POST also degrades to 502 after the body was read', async () => {
            vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom') }))
            const res = await POST(ev('http://app.local/relay/api/x', { method: 'POST', body: 'irrelevant' }))
            expect(res.status).toBe(502)
        })
    })

    describe('response passthrough', () => {
        it('passes a relay 404 status and body through', async () => {
            stubFetch(() => new Response('{"error":"nope"}', { status: 404, headers: { 'content-type': 'application/json' } }))
            const res = await GET(ev('http://app.local/relay/api/games/999'))
            expect(res.status).toBe(404)
            expect(await res.json()).toEqual({ error: 'nope' })
        })

        it('passes a relay 500 through as 500 (not converted to 502)', async () => {
            stubFetch(() => new Response('relay exploded', { status: 500 }))
            const res = await GET(ev('http://app.local/relay/api/games'))
            expect(res.status).toBe(500)
            expect(await res.text()).toBe('relay exploded')
        })

        it('passes a 206 partial response with its range headers (video seeking)', async () => {
            stubFetch(() => new Response('chunk', {
                status:  206,
                headers: {
                    'content-type':  'video/mp4',
                    'content-range': 'bytes 0-4/100',
                    'accept-ranges': 'bytes',
                },
            }))
            const res = await GET(ev('http://app.local/relay/api/media/clip.mp4', { headers: { range: 'bytes=0-4' } }))
            expect(res.status).toBe(206)
            expect(res.headers.get('content-range')).toBe('bytes 0-4/100')
            expect(res.headers.get('accept-ranges')).toBe('bytes')
            expect(await res.text()).toBe('chunk')
        })

        it('passes a bodyless 204 through without throwing (null body + null-body status)', async () => {
            stubFetch(() => new Response(null, { status: 204 }))
            const res = await GET(ev('http://app.local/relay/api/ack'))
            expect(res.status).toBe(204)
            expect(res.body).toBeNull()
        })

        it('allowlists response headers — set-cookie and custom headers are dropped', async () => {
            stubFetch(() => new Response('body', {
                status:  200,
                headers: {
                    'content-type':                'text/plain;charset=UTF-8',
                    'cache-control':               'max-age=60',
                    'set-cookie':                  'relay_session=leak-me',
                    'x-internal-secret':           'do-not-forward',
                    'access-control-allow-origin': '*',
                },
            }))
            const res = await GET(ev('http://app.local/relay/api/games'))
            expect(res.headers.get('content-type')).toBe('text/plain;charset=UTF-8')
            expect(res.headers.get('cache-control')).toBe('max-age=60')
            expect(res.headers.has('set-cookie')).toBe(false)
            expect(res.headers.has('x-internal-secret')).toBe(false)
            expect(res.headers.has('access-control-allow-origin')).toBe(false)
        })

        it('streams the relay body through unchanged', async () => {
            const payload = JSON.stringify({ big: 'x'.repeat(50_000) })
            stubFetch(() => new Response(payload, { headers: { 'content-type': 'application/json' } }))
            const res = await GET(ev('http://app.local/relay/api/blob'))
            expect(await res.text()).toBe(payload)
        })
    })
})
