import { apiGet, apiPost } from './client'
import { CommunityPrefsSchema, TogglePrefResponseSchema } from 'gaming-journal-contracts/communityPrefs'

export type LoadedPrefs = {
    filtered:    Set<string>
    muted:       Set<string>
    favorited:   Set<string>
    highlighted: Set<string>
}

// highlighted is scoped to "this game" (keyed by appid server-side) — every other pref is global,
// matching community.md's own description and the real `highlighted: Record<appid, string[]>`
// shape confirmed live.
export async function loadPrefs(appid: string | number): Promise<LoadedPrefs> {
    const data = await apiGet('/api/community-prefs', CommunityPrefsSchema)
    return {
        filtered:    new Set(data.filtered),
        muted:       new Set(data.muted),
        favorited:   new Set(data.favorited),
        highlighted: new Set(data.highlighted[String(appid)] ?? []),
    }
}

async function togglePref(type: string, username: string, appid: string | number | null = null): Promise<boolean> {
    const body: { type: string; username: string; appid?: string } = { type, username }
    if (appid != null) body.appid = String(appid)
    const res = await apiPost('/api/community-prefs/toggle', TogglePrefResponseSchema, body)
    return res.active
}

export const toggleFilter    = (username: string) => togglePref('filter', username)
export const toggleMute      = (username: string) => togglePref('mute', username)
export const toggleFavorite  = (username: string) => togglePref('favorite', username)
export const toggleHighlight = (appid: string | number, username: string) => togglePref('highlight', username, appid)
