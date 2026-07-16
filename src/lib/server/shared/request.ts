import { json } from '@sveltejs/kit'

/**
 * Route-level request hygiene shared by the JSON API endpoints.
 *
 * Every handler that destructures a request body was 500ing (or worse, throwing
 * uncaught) on malformed JSON / JSON `null` — a client error, not a server one.
 * And `Number(params.appid)` without validation collapsed every non-numeric appid
 * into one shared "NaN" bucket. These helpers make 400 the easy path.
 */

export function badRequest(message: string): Response {
    return json({ error: message }, { status: 400 })
}

/**
 * Parse a JSON object body. Returns undefined for malformed JSON or a root that
 * is not a plain object (null, array, string, number) — callers reply 400.
 */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | undefined> {
    let body: unknown
    try { body = await request.json() } catch { return undefined }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined
    return body as Record<string, unknown>
}

/** Parse any JSON body (object or array). Undefined only on malformed JSON. */
export async function readJson(request: Request): Promise<unknown | undefined> {
    try { return await request.json() } catch { return undefined }
}

/**
 * Validate an appid route param: a positive integer (Number coercion, so "440"
 * and even "44e1" pass; "abc", "", "-1", "12.5" are rejected with null).
 */
export function parseAppid(param: string | undefined): number | null {
    const n = Number(param)
    return Number.isInteger(n) && n > 0 ? n : null
}
