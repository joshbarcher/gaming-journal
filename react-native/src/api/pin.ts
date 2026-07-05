import { apiPost } from './client'
import { getApiHost } from './config'
import { PinStateSchema, type PinState } from 'gaming-journal-contracts/pin'

// GET /relay/api/pin returns a real 204 when nothing is pinned (confirmed live) — apiGetOrNull
// only special-cases 404, not 204, so this needs its own small fetch rather than reusing it
// directly (matches the web's own getPin() which checks `res.status === 204` explicitly).
export async function getPin(): Promise<PinState | null> {
    const host = await getApiHost()
    const res = await fetch(`${host}/relay/api/pin`)
    if (res.status === 204 || !res.ok) return null
    return PinStateSchema.parse(await res.json())
}

export const pinGame = (appid: number, name: string): Promise<PinState> =>
    apiPost(`/relay/api/pin/${appid}`, PinStateSchema, { name })

export async function unpinGame(): Promise<void> {
    const host = await getApiHost()
    await fetch(`${host}/relay/api/pin`, { method: 'DELETE' })
}

export function fmtExpiry(expiresAt: string): string {
    const ms = new Date(expiresAt).getTime() - Date.now()
    if (ms <= 0) return 'soon'
    const min = Math.floor(ms / 60_000)
    const h = Math.floor(min / 60)
    const m = min % 60
    if (h === 0) return `${m}m`
    if (m === 0) return `${h}h`
    return `${h}h ${m}m`
}
