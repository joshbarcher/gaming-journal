function relayBase() {
    return (process.env.RELAY_URL ?? 'http://localhost:8050').replace(/\/$/, '')
}

async function proxy({ params, request, url }) {
    const targetUrl = `${relayBase()}/${params.path}${url.search}`

    const headers = new Headers()
    if (request.headers.has('content-type')) headers.set('content-type', request.headers.get('content-type'))
    if (request.headers.has('accept')) headers.set('accept', request.headers.get('accept'))

    try {
        const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer()
        const response = await fetch(targetUrl, { method: request.method, headers, body })

        const responseHeaders = new Headers()
        for (const key of ['content-type', 'content-length', 'cache-control']) {
            if (response.headers.has(key)) responseHeaders.set(key, response.headers.get(key))
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
