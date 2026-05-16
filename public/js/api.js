const BASE = '/api'

async function request(method, path, body) {
    const opts = { method, headers: {} }
    if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json'
        opts.body = JSON.stringify(body)
    }
    const res = await fetch(BASE + path, opts)
    if (res.status === 204) return null
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
    return data
}

export const api = {
    pages: {
        list:    ()         => request('GET',    '/pages'),
        get:     (id)       => request('GET',    `/pages/${id}`),
        create:  (body)     => request('POST',   '/pages', body),
        update:  (id, body) => request('PUT',    `/pages/${id}`, body),
        remove:  (id)       => request('DELETE', `/pages/${id}`),
        reorder: (ids)      => request('PUT',    '/pages/order', { ids }),
    },
}
