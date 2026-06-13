// Background fetch worker for game page sections.
// Keeps slow network calls off the main thread so the page stays responsive.
//
// Inbound:  { type: 'get',      id, url }
//           { type: 'post_get', id, postUrl, getUrl }
// Outbound: { id, data }   (data is null on any error or non-ok response)

function buildPollUrl(url) {
    // Remove ?fetch=true (or &fetch=true) from the URL, clean up leftover separators
    return url
        .replace(/[?&]fetch=true(?=&|$)/, '')
        .replace(/\?&/, '?')
        .replace(/\?$/, '')
}

async function fetchWithPoll(url, maxRetries = 8, delayMs = 2000) {
    const res = await fetch(url)
    if (res.status !== 202) return res.ok ? await res.json() : null

    // 202 = relay is processing in background — poll without ?fetch=true
    const pollUrl = buildPollUrl(url)
    for (let i = 0; i < maxRetries; i++) {
        await new Promise(r => setTimeout(r, delayMs))
        try {
            const r = await fetch(pollUrl)
            if (r.ok)           return await r.json()
            if (r.status !== 404) break  // unexpected error, stop retrying
        } catch { break }
    }
    return null
}

self.onmessage = async ({ data: msg }) => {
    const { type, id } = msg
    try {
        if (type === 'get') {
            const data = await fetchWithPoll(msg.url)
            self.postMessage({ id, data })
        } else if (type === 'post_get') {
            await fetch(msg.postUrl, { method: 'POST' })
            const res  = await fetch(msg.getUrl)
            const data = res.ok ? await res.json() : null
            self.postMessage({ id, data })
        }
    } catch {
        self.postMessage({ id, data: null })
    }
}
