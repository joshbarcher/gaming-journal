// GET /relay/api/guides/jobs/stream — SSE stream pushed on every job state
// change (ports relay guides.controller handleJobStream).
//
// job-queue.js broadcasts to Express-shaped clients (res.write /
// res.writableEnded / res.on('close')), so this route hands it a small shim
// wired to the ReadableStream controller: enqueue failures and client
// disconnects (cancel) flip writableEnded and fire the 'close' listeners,
// exactly how the Express socket behaved — broadcast() then prunes the client.
import { relayRoute } from '$lib/server/relay/shared/route-helpers.js'
import { SSE_HEADERS } from '$lib/server/relay/guides/sse.js'
import { getJobs, addSseClient } from '$lib/server/relay/guides/job-queue.js'

type SseClientShim = {
    writableEnded: boolean
    write: (chunk: string) => void
    on: (event: string, cb: () => void) => void
    _close: () => void
}

export const GET = relayRoute('guides', async () => {
    const encoder = new TextEncoder()
    let shim: SseClientShim | null = null

    const stream = new ReadableStream({
        start(controller) {
            const closeCbs: Array<() => void> = []
            shim = {
                writableEnded: false,
                write(chunk: string) {
                    if (this.writableEnded) return
                    try { controller.enqueue(encoder.encode(chunk)) }
                    catch { this._close() }
                },
                on(event: string, cb: () => void) {
                    if (event === 'close') closeCbs.push(cb)
                },
                _close() {
                    if (this.writableEnded) return
                    this.writableEnded = true
                    for (const cb of closeCbs) cb()
                },
            }

            // The relay flushHeaders()ed eagerly; a Node Response only puts
            // headers on the wire with the first body byte, so open with an
            // SSE comment (ignored by EventSource and the RN frame parser —
            // it carries no `data: ` line) to keep the connection from
            // sitting in CONNECTING until the first broadcast.
            shim.write(`: connected\n\n`)

            // Send full current state immediately so the client can hydrate
            const jobs = getJobs()
            if (jobs.length) {
                shim.write(`data: ${JSON.stringify({ type: 'snapshot', jobs })}\n\n`)
            }

            addSseClient(shim)
        },
        cancel() {
            shim?._close()
        },
    })

    return new Response(stream, { headers: SSE_HEADERS })
})
