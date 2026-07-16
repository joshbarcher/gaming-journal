// POST /relay/api/progress-suggest/:appid — direct SSE endpoint (kept for
// debugging/dev; ports relay progress-suggest.controller handleProgressSuggest).
// Streams the CLI's events as SSE data frames, then a final
// {type:'done',trackers} or {type:'error',message} frame, then closes.
import logger from '$lib/server/logger.js'
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { suggestTrackersViaCli as _suggestTrackersViaCli } from '$lib/server/relay/progress-suggest/progress-suggest-cli.service.js'

// The service is untyped ported JS; its `onEvent = () => {}` default infers a
// zero-arg callback, so type the surface we actually call.
const suggestTrackersViaCli = _suggestTrackersViaCli as
    (gameName: string, onEvent: (event: { type: string, [k: string]: unknown }) => void) => Promise<unknown>

export const POST = relayRoute('progress-suggest', async ({ request }) => {
    const body = await request.json().catch(() => null) as { gameName?: string } | null
    const gameName = body?.gameName
    if (!gameName) return json({ error: 'gameName is required' }, 400)

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
        start(controller) {
            let closed = false
            // Express res.write() after a client disconnect is a silent no-op;
            // enqueue() on a cancelled controller throws — swallow to match.
            const send = (data: unknown) => {
                if (closed) return
                try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
                } catch {
                    closed = true
                }
            }
            suggestTrackersViaCli(gameName, send)
                .then((trackers) => send({ type: 'done', trackers }))
                .catch((err: unknown) => {
                    logger.error('Progress suggest failed', { err: err instanceof Error ? err.message : String(err) })
                    send({ type: 'error', message: String(err) })
                })
                .finally(() => {
                    closed = true
                    try { controller.close() } catch { /* already cancelled */ }
                })
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
