// GET /relay/api/progress-suggest/jobs/stream — SSE stream of job progress
// (ports relay progress-suggest.controller handleJobStream). Event names and
// payloads are identical to the relay: a `snapshot` frame on connect, then
// whole-job frames on state changes and `{type:'log',id,line}` deltas per line.
//
// The queue's addSseClient() takes an express-res-shaped writer
// ({ write, writableEnded, on('close') }); this route adapts a ReadableStream
// controller onto that shape — client disconnects surface via the stream's
// cancel() callback, which fires the 'close' listeners so the queue drops us.
import { relayRoute } from '$lib/server/relay/shared/route-helpers.js'
import { addSseClient } from '$lib/server/relay/progress-suggest/suggest-job-queue.js'

type SseClient = {
    writableEnded: boolean
    write: (chunk: string) => void
    on: (event: string, cb: () => void) => void
}

export const GET = relayRoute('progress-suggest', () => {
    const encoder = new TextEncoder()
    let client: SseClient & { _closeListeners: Array<() => void> }

    const stream = new ReadableStream({
        start(controller) {
            client = {
                writableEnded: false,
                _closeListeners: [],
                write(chunk: string) {
                    if (this.writableEnded) return
                    try {
                        controller.enqueue(encoder.encode(chunk))
                    } catch {
                        this.writableEnded = true   // controller already closed — broadcast() will prune us
                    }
                },
                on(event: string, cb: () => void) {
                    if (event === 'close') this._closeListeners.push(cb)
                },
            }
            addSseClient(client)
        },
        cancel() {
            // Client disconnected: mimic express res 'close' so the queue
            // removes this client from its broadcast set.
            client.writableEnded = true
            for (const cb of client._closeListeners) cb()
        },
    })

    return new Response(stream, {
        headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            'connection': 'keep-alive',
        },
    })
})
