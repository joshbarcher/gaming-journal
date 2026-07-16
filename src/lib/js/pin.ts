import type { PinState } from '../types.js'

export async function getPin(): Promise<PinState | null> {
    const res = await fetch('/relay/api/pin')
    if (res.status === 204) return null
    if (!res.ok) return null
    return res.json()
}

export async function pinGame(appid: number, name: string): Promise<PinState | null> {
    const res = await fetch(`/relay/api/pin/${appid}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name }),
    })
    if (!res.ok) return null
    return res.json()
}

export async function unpinGame(): Promise<void> {
    await fetch('/relay/api/pin', { method: 'DELETE' })
}

export function fmtExpiry(expiresAt: string): string {
    const ms  = new Date(expiresAt).getTime() - Date.now()
    // NaN (unparseable/empty date) must not render as "NaNh NaNm".
    if (!Number.isFinite(ms) || ms <= 0) return 'soon'
    const min = Math.floor(ms / 60_000)
    const h   = Math.floor(min / 60)
    const m   = min % 60
    if (h === 0) return `${m}m`
    if (m === 0) return `${h}h`
    return `${h}h ${m}m`
}
