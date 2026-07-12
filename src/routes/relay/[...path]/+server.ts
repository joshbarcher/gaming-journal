import type { RequestEvent } from '@sveltejs/kit'
import { Agent }             from 'undici'

function relayBase(): string {
    return (process.env.RELAY_URL ?? 'http://localhost:8050').replace(/\/$/, '')
}

// Persistent pool for regular API calls — keepAliveTimeout: Infinity avoids
// the 2-second stale-socket hang that occurs when a timed-out socket is reused.
const _apiAgent = new Agent({
    keepAliveTimeout:    Infinity,
    keepAliveMaxTimeout: 10 * 60 * 1_000,
    connections:         8,
})

// Separate pool for SSE streams (text/event-stream). Long-lived connections
// that must not share slots with API calls. Uses a generous connection count
// and lets undici manage socket lifecycle naturally (no aggressive close).
const _sseAgent = new Agent({
    keepAliveTimeout:    Infinity,
    keepAliveMaxTimeout: Infinity,
    connections:         32,
})

async function proxy({ request, url }: RequestEvent) {
    const targetPath = url.pathname.replace(/^\/relay/, '')
    const targetUrl  = `${relayBase()}${targetPath}${url.search}`
    const isSSE     = request.headers.get('accept') === 'text/event-stream'

    const headers = new Headers()
    if (request.headers.has('content-type')) headers.set('content-type', request.headers.get('content-type')!)
    if (request.headers.has('accept')) headers.set('accept', request.headers.get('accept')!)
    // Forward Range so <video>/<audio> stream properly: without it the browser is
    // handed one un-recoverable 200 for the whole file and aborts on any mid-stream
    // hiccup ("Video playback aborted due to a network error"). With it, the relay
    // (express.static) replies 206 and the browser can seek and re-request ranges.
    if (request.headers.has('range')) headers.set('range', request.headers.get('range')!)

    try {
        const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer()
        const response = await fetch(targetUrl, { method: request.method, headers, body, dispatcher: isSSE ? _sseAgent : _apiAgent } as RequestInit)

        const responseHeaders = new Headers()
        for (const key of ['content-type', 'content-length', 'cache-control', 'accept-ranges', 'content-range']) {
            if (response.headers.has(key)) responseHeaders.set(key, response.headers.get(key)!)
        }

        return new Response(response.body, { status: response.status, headers: responseHeaders })
    } catch {
        return new Response(JSON.stringify({ error: 'Relay server unreachable' }), {
            status: 502,
            headers: { 'content-type': 'application/json' },
        })
    }
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
