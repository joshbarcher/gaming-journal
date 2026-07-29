// Loopback fetch for the app's own /relay/* routes (see journalRelayBase).
//
// WHY THIS EXISTS
// ───────────────
// SSR loaders (+layout.server, +page.server) and alertsService used the bare
// global `fetch`, i.e. undici's DEFAULT dispatcher — whose keepAliveTimeout is
// 4 seconds. Browse the site, pause for longer than that, and every pooled
// socket has idled out; the next render then reuses a dead socket and pays the
// 2-second stale-socket hang already documented in relay/shared/forward.ts.
// That is the "site was unused for a bit → 2-3s before anything appears" delay:
// a render is 10+ loopback calls, so it only takes one to stall the page.
//
// Two defences, because pooling alone can't be made airtight:
//
//  1. A dedicated Agent whose idle timeout is comfortably BELOW the server's.
//     server.js sets keepAliveTimeout to 10 minutes, so retiring client-side at
//     4 makes us always the side that closes. That removes the race where the
//     server's FIN is in flight while we're writing a request onto the socket —
//     the case a longer client timeout (forward.ts uses Infinity, aimed at a
//     separate upstream) actively invites.
//  2. Retry once on a connection-level failure. Config narrows the race window
//     but can't close it — a socket can still die between checkout and write
//     (NAT/conntrack eviction, upstream restart). Undici does not retry on the
//     fetch path, so a single dead socket surfaces as a failed load and a blank
//     card. Retrying an idempotent GET costs ~1ms on loopback and turns a
//     multi-second stall into an imperceptible blip.

import { Agent, type RequestInit as UndiciRequestInit } from 'undici'

const SERVER_KEEP_ALIVE_MS = 10 * 60 * 1_000   // must mirror server.js

const _internalAgent = new Agent({
    // Below the server's timeout so we retire sockets first — see (1) above.
    keepAliveTimeout:          4 * 60 * 1_000,
    keepAliveMaxTimeout:       SERVER_KEEP_ALIVE_MS - 60 * 1_000,
    // Extra margin subtracted from any server-advertised Keep-Alive timeout.
    keepAliveTimeoutThreshold: 2_000,
    // A single SSR render fans out ~10 loopback calls (layout + page + alerts).
    // The default of 6 would queue some of them behind others for no reason.
    connections:               32,
})

// Connection-level failures: the socket died, the request never got a reply.
// Safe to replay for a GET. Anything else (4xx/5xx, JSON errors, aborts) is a
// real answer from the app and must NOT be retried.
const RETRYABLE = new Set([
    'UND_ERR_SOCKET',
    'UND_ERR_CLOSED',
    'UND_ERR_DESTROYED',
    'ECONNRESET',
    'ECONNREFUSED',
    'EPIPE',
])

function isRetryable(err: unknown): boolean {
    for (let e = err as { code?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
        if (e.code && RETRYABLE.has(e.code)) return true
    }
    return false
}

/**
 * fetch() against our own server, pooled and retried. Same signature as fetch.
 * Only GET/HEAD are replayed — a retried POST could double-apply a mutation.
 */
export async function internalFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const opts = { ...init, dispatcher: _internalAgent } as UndiciRequestInit
    const method = (init.method ?? 'GET').toUpperCase()

    try {
        return await fetch(url, opts as RequestInit)
    } catch (err) {
        if (!isRetryable(err) || !['GET', 'HEAD'].includes(method)) throw err
        // Fresh connection: the dead socket was evicted from the pool by the
        // error above, so this checkout can't hand us the same one.
        return await fetch(url, opts as RequestInit)
    }
}

/** internalFetch + JSON, collapsing every failure to null so one dead card
 *  never takes down a whole page load. 204 → null (pin uses it for "unset"). */
export async function internalJson<T>(url: string): Promise<T | null> {
    try {
        const res = await internalFetch(url)
        if (!res.ok || res.status === 204) return null
        return await res.json() as T
    } catch {
        return null
    }
}
