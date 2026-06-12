const API = '/api/community-prefs'

export async function loadPrefs(appid) {
    const res  = await fetch(API)
    if (!res.ok) throw new Error(`Failed to load community prefs: ${res.status}`)
    const data = await res.json()
    return {
        filtered:    new Set(data.filtered    ?? []),
        muted:       new Set(data.muted       ?? []),
        favorited:   new Set(data.favorited   ?? []),
        highlighted: new Set(data.highlighted?.[String(appid)] ?? []),
    }
}

async function _toggle(type, username, appid = null) {
    const body = { type, username }
    if (appid != null) body.appid = String(appid)
    const res = await fetch(`${API}/toggle`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`community-prefs toggle failed: ${res.status}`)
    const data = await res.json()
    return data.active  // true = now in the set
}

export const toggleFilter    = username         => _toggle('filter',    username)
export const toggleMute      = username         => _toggle('mute',      username)
export const toggleFavorite  = username         => _toggle('favorite',  username)
export const toggleHighlight = (appid, username) => _toggle('highlight', username, appid)
