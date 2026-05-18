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
    franchises: {
        list:           ()               => request('GET',    '/franchises'),
        get:            (id)             => request('GET',    `/franchises/${id}`),
        create:         (body)           => request('POST',   '/franchises', body),
        update:         (id, body)       => request('PUT',    `/franchises/${id}`, body),
        delete:         (id)             => request('DELETE', `/franchises/${id}`),
        addEntry:       (id, body)       => request('POST',   `/franchises/${id}/entries`, body),
        removeEntry:    (id, appid)      => request('DELETE', `/franchises/${id}/entries/${appid}`),
        reorderEntries: (id, appids)     => request('PUT',    `/franchises/${id}/entries/order`, { appids }),
    },
}
