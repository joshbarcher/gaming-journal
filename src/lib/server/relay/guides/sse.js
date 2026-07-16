// SSE plumbing for the guides routes — adapts the relay controller's Express
// `res.write('data: …\n\n')` event streams to web ReadableStream Responses.

export const SSE_HEADERS = {
    'content-type':  'text/event-stream',
    'cache-control': 'no-cache',
    'connection':    'keep-alive',
};

/**
 * Drive a controller runner (async (send) => {}) against a streaming Response.
 * send(data) writes one `data: <json>\n\n` frame; frames are dropped once the
 * client disconnects (the relay's `!res.writableEnded` guard) and the stream
 * closes when the runner settles (the relay's `res.end()` in finally).
 */
export function sseResponse(run) {
    const encoder = new TextEncoder();
    let closed = false;
    const stream = new ReadableStream({
        start(controller) {
            const send = (data) => {
                if (closed) return;
                try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); }
                catch { closed = true; }
            };
            Promise.resolve(run(send)).finally(() => {
                closed = true;
                try { controller.close(); } catch { /* cancelled */ }
            });
        },
        cancel() { closed = true; },   // client disconnected mid-stream
    });
    return new Response(stream, { headers: SSE_HEADERS });
}
