// /relay/api/nexus/session — Nexus website login session (cookies) for the
// adult-mod scraper (ports relay nexus.controller session handlers).
//   GET    — session status (never leaks cookie values)
//   POST   — store captured login cookies ({ cookies: [...] })
//   DELETE — clear the stored session
import { relayRoute, json } from '$lib/server/relay/shared/route-helpers.js'
import { saveSession, sessionStatus, clearSession } from '$lib/server/relay/nexus/session.service.js'

export const GET = relayRoute('nexus', async () => {
    return json(await sessionStatus())
})

export const POST = relayRoute('nexus', async ({ request }) => {
    const body = await request.json().catch(() => null)
    const cookies = (body as { cookies?: unknown } | null)?.cookies
    if (!Array.isArray(cookies) || !cookies.length) return json({ error: 'cookies[] required' }, 400)
    await saveSession(cookies)
    return json(await sessionStatus())   // never echo cookie values back
})

export const DELETE = relayRoute('nexus', async () => {
    await clearSession()
    return json({ ok: true })
})
