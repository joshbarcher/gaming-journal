const BASE = '/api'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function request(method: string, path: string, body?: unknown): Promise<any> {
    const opts: RequestInit & { headers: Record<string, string> } = { method, headers: {} }
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
        list:        ()                         => request('GET',    '/pages'),
        listByGame:  (appid: string | number)   => request('GET',    `/pages?appid=${appid}`),
        get:         (id: string)               => request('GET',    `/pages/${id}`),
        create:      (body: unknown)            => request('POST',   '/pages', body),
        update:      (id: string, body: unknown) => request('PUT',   `/pages/${id}`, body),
        remove:      (id: string)               => request('DELETE', `/pages/${id}`),
        reorder:     (ids: string[])            => request('PUT',    '/pages/order', { ids }),
    },
    localReviews: {
        get:        (appid: string | number)                            => request('GET',   `/local-reviews/${appid}`),
        set:        (appid: string | number, body: unknown)             => request('PUT',   `/local-reviews/${appid}`, body),
        addNote:    (appid: string | number, text: string)              => request('POST',  `/local-reviews/${appid}/notes`, { text }),
        updateNote: (appid: string | number, noteId: string, body: unknown) => request('PATCH', `/local-reviews/${appid}/notes/${noteId}`, body),
        deleteNote: (appid: string | number, noteId: string)           => request('DELETE', `/local-reviews/${appid}/notes/${noteId}`),
    },
    franchises: {
        list:           ()                                   => request('GET',    '/franchises'),
        get:            (id: string)                         => request('GET',    `/franchises/${id}`),
        create:         (body: unknown)                      => request('POST',   '/franchises', body),
        update:         (id: string, body: unknown)          => request('PUT',    `/franchises/${id}`, body),
        delete:         (id: string)                         => request('DELETE', `/franchises/${id}`),
        addEntry:       (id: string, body: unknown)          => request('POST',   `/franchises/${id}/entries`, body),
        removeEntry:    (id: string, appid: number)          => request('DELETE', `/franchises/${id}/entries/${appid}`),
        reorderEntries: (id: string, appids: number[])       => request('PUT',    `/franchises/${id}/entries/order`, { appids }),
    },
}
