// Background fetch worker for game page sections.
// Keeps slow network calls off the main thread so the page stays responsive.
//
// Inbound:  { type: 'get',      id, url }
//           { type: 'post_get', id, postUrl, getUrl }
// Outbound: { id, data }   (data is null on any error or non-ok response)

self.onmessage = async ({ data: msg }) => {
    const { type, id } = msg
    try {
        if (type === 'get') {
            const res  = await fetch(msg.url)
            const data = res.ok ? await res.json() : null
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
