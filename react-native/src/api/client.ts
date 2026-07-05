// Base fetch wrapper — mirrors the web app's src/lib/js/api.ts request() shape, but every read
// is validated through a Zod schema from $contracts (see PLAN.md "Type contracts & verification").
// A schema mismatch throws immediately instead of an `undefined` surfacing three screens later.
import { getApiHost } from './config'

type Schema<T> = { parse: (data: unknown) => T }

async function request<T>(
    method: string,
    path: string,
    schema: Schema<T>,
    body?: unknown,
): Promise<T> {
    const host = await getApiHost()
    const init: RequestInit & { headers: Record<string, string> } = { method, headers: {} }
    if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json'
        init.body = JSON.stringify(body)
    }

    const res = await fetch(`${host}${path}`, init)
    // Matches the web app's src/lib/js/api.ts: a 204 (or any genuinely empty body) has nothing to
    // parse as JSON. Found while building a mutation endpoint (player-counts/filtered) whose real
    // response shape is unknown — the web source itself never reads the body for that one, only
    // checks res.ok — so this must tolerate an empty response rather than assume res.json() always
    // succeeds, which every prior apiPost/apiPut/apiDelete call so far happened to get away with.
    if (res.status === 204) return schema.parse(null)
    const text = await res.text()
    const json = text ? JSON.parse(text) : null
    if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
    return schema.parse(json)
}

export const apiGet = <T>(path: string, schema: Schema<T>) => request('GET', path, schema)
export const apiPost = <T>(path: string, schema: Schema<T>, body?: unknown) => request('POST', path, schema, body)
export const apiPut = <T>(path: string, schema: Schema<T>, body?: unknown) => request('PUT', path, schema, body)
export const apiPatch = <T>(path: string, schema: Schema<T>, body?: unknown) => request('PATCH', path, schema, body)
export const apiDelete = <T>(path: string, schema: Schema<T>) => request('DELETE', path, schema)

// Several endpoints in this app use a real 404 for "no data yet" (e.g. local-reviews for a game
// with no review) rather than a 200 with an empty/null body — confirmed by checking actual HTTP
// status codes across real data, not assuming. This variant returns null for that case instead of
// throwing, since "no review exists" is an expected, valid state, not an error.
export async function apiGetOrNull<T>(path: string, schema: Schema<T>): Promise<T | null> {
    const host = await getApiHost()
    const res = await fetch(`${host}${path}`)
    if (res.status === 404) return null
    const json = await res.json()
    if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
    return schema.parse(json)
}
