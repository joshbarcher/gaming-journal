const API = '/api/community-prefs'

export async function loadPrefs(appid: string | number): Promise<{
    filtered:    Set<string>
    muted:       Set<string>
    favorited:   Set<string>
    highlighted: Set<string>
}> {
    const res  = await fetch(API)
    if (!res.ok) throw new Error(`Failed to load community prefs: ${res.status}`)
    // A JSON `null` body would defeat the per-field ?? guards below.
    const data = (await res.json()) ?? {}
    return {
        filtered:    new Set(data.filtered    ?? []),
        muted:       new Set(data.muted       ?? []),
        favorited:   new Set(data.favorited   ?? []),
        highlighted: new Set(data.highlighted?.[String(appid)] ?? []),
    }
}

async function _toggle(type: string, username: string, appid: string | number | null = null): Promise<boolean> {
    const body: { type: string; username: string; appid?: string } = { type, username }
    if (appid != null) body.appid = String(appid)
    const res = await fetch(`${API}/toggle`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`community-prefs toggle failed: ${res.status}`)
    const data = await res.json()
    return data.active
}

export const toggleFilter    = (username: string)                         => _toggle('filter',    username)
export const toggleMute      = (username: string)                         => _toggle('mute',      username)
export const toggleFavorite  = (username: string)                         => _toggle('favorite',  username)
export const toggleHighlight = (appid: string | number, username: string) => _toggle('highlight', username, appid)
