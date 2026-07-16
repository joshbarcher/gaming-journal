// GET /relay/api/reddit/:appid/sync/progress — SSE stream of sync status
// (ports relay reddit.controller handleSyncProgress). Event names and payloads
// are byte-identical to the relay's (`data: {"type":"status","message":…}` /
// `{"type":"done"}` frames) — web and RN both parse them.
//
// Express wrote frames straight to `res`; here a ReadableStream stands in:
// its controller is wrapped in a res-like { write } shim so the service's
// subscriber contract stays unchanged. The relay never ends the response
// server-side (clients close after "done") — mirrored by never calling
// controller.close(); a client disconnect fires cancel(), which unsubscribes
// (the express equivalent was req.on('close', unsub)).
import { relayRoute } from '$lib/server/relay/shared/route-helpers.js'
import { subscribeProgress } from '$lib/server/relay/reddit/reddit.service.js'

export const GET = relayRoute('reddit', ({ params }) => {
    const appid = Number(params.appid)
    let unsub: () => void = () => {}

    const stream = new ReadableStream({
        start(controller) {
            const encoder = new TextEncoder()
            const res = {
                write(chunk: string) {
                    // A frame emitted between disconnect and cancel() must not
                    // throw into the service's subscriber loop.
                    try { controller.enqueue(encoder.encode(chunk)) } catch { /* stream closed */ }
                },
            }
            unsub = subscribeProgress(appid, res)
        },
        cancel() {
            unsub()
        },
    })

    return new Response(stream, {
        headers: {
            'content-type':  'text/event-stream',
            'cache-control': 'no-cache',
            'connection':    'keep-alive',
        },
    })
})
