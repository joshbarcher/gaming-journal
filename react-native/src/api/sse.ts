// SSE client — RN has no native EventSource. This reads a fetch() response body as a stream and
// parses `data: <json>\n\n` frames as they arrive, which covers both of the relay's SSE shapes:
// GET-based (guides/jobs/stream, progress-suggest/jobs/stream) and POST-based (guide
// search/download — the request body carries params, the response is still SSE).
//
// Verified (this environment) against a local mock SSE server on the web target — Chromium's
// fetch/ReadableStream supports incremental delivery, confirmed events arrive with real gaps
// between them (~400ms apart), not batched at the end. NOT YET verified on native iOS/Android —
// RN's fetch streaming-body support varies by version/engine (Hermes/JSC) and needs an actual
// device/simulator to confirm. If it doesn't work reliably on-device, `react-native-sse` (XHR-based,
// more battle-tested for native) is the documented fallback — swap the implementation inside
// `readSseStream` below without changing the public `subscribeSSE` signature.
export type SseHandlers<T> = {
    onEvent: (data: T) => void
    onError?: (err: Error) => void
    onDone?:  () => void
}

export function subscribeSSE<T = unknown>(
    url: string,
    handlers: SseHandlers<T>,
    init?: RequestInit,
): () => void {
    const controller = new AbortController()

    readSseStream(url, handlers, { ...init, signal: controller.signal })

    return () => controller.abort()
}

async function readSseStream<T>(url: string, handlers: SseHandlers<T>, init: RequestInit): Promise<void> {
    try {
        const res = await fetch(url, {
            ...init,
            headers: { ...init.headers, Accept: 'text/event-stream' },
        })
        if (!res.body) throw new Error('Response has no readable body (streaming not supported here)')

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        for (;;) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const frames = buffer.split('\n\n')
            buffer = frames.pop() ?? '' // last element may be an incomplete frame — keep it buffered

            for (const frame of frames) {
                const line = frame.split('\n').find(l => l.startsWith('data: '))
                if (!line) continue
                try {
                    handlers.onEvent(JSON.parse(line.slice('data: '.length)) as T)
                } catch {
                    // malformed frame — skip rather than crash the whole stream
                }
            }
        }

        handlers.onDone?.()
    } catch (err) {
        if ((err as Error).name === 'AbortError') return // caller unsubscribed — not a real error
        handlers.onError?.(err as Error)
    }
}
