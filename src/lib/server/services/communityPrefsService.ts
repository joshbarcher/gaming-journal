import { getStoreFile, getOwn, setOwn } from '../shared/store-file.js'
import type { CommunityPrefs } from '../../types.js'

type PrefType = 'filter' | 'mute' | 'favorite' | 'highlight'

function getFile() {
    return getStoreFile<CommunityPrefs>('community-prefs.json', 'community-prefs',
        () => ({ filtered: [], muted: [], favorited: [], highlighted: {} }))
}

/** Repair missing OR wrong-typed fields — a hand-edited string where an array
 *  belongs must not reach `.push`/`.indexOf`. */
function _ensure(data: CommunityPrefs): CommunityPrefs {
    if (!Array.isArray(data.filtered))  data.filtered  = []
    if (!Array.isArray(data.muted))     data.muted     = []
    if (!Array.isArray(data.favorited)) data.favorited = []
    if (!data.highlighted || typeof data.highlighted !== 'object' || Array.isArray(data.highlighted)) {
        data.highlighted = {}
    }
    return data
}

export async function getPrefs(): Promise<CommunityPrefs> {
    const file = await getFile()
    const data = _ensure(file.get())
    // Copies — callers must not mutate the shared in-memory store.
    const highlighted: Record<string, string[]> = {}
    for (const key of Object.keys(data.highlighted)) setOwn(highlighted, key, [...data.highlighted[key]])
    return {
        filtered:    [...data.filtered],
        muted:       [...data.muted],
        favorited:   [...data.favorited],
        highlighted,
    }
}

export async function togglePref(type: PrefType, username: string, appid: string | number | null = null): Promise<boolean> {
    const file = await getFile()
    const data = _ensure(file.get())

    let active: boolean

    if (type === 'filter' || type === 'mute' || type === 'favorite') {
        const key = type === 'filter' ? 'filtered' : type === 'mute' ? 'muted' : 'favorited'
        if (data[key].includes(username)) {
            // filter() rather than splice-first: duplicated entries (hand edits, old
            // concurrency bugs) must ALL clear, or "unmute" reports false while still muted.
            data[key] = data[key].filter(u => u !== username)
            active = false
        } else {
            data[key].push(username)
            active = true
        }
    } else if (type === 'highlight') {
        if (!appid) throw new Error('appid required for highlight')
        const k = String(appid)
        let users = getOwn(data.highlighted, k)
        if (!Array.isArray(users)) {
            users = []
            setOwn(data.highlighted, k, users)
        }
        if (users.includes(username)) {
            const remaining = users.filter(u => u !== username)
            if (remaining.length === 0) delete data.highlighted[k]
            else setOwn(data.highlighted, k, remaining)
            active = false
        } else {
            users.push(username)
            active = true
        }
    } else {
        throw new Error(`Unknown pref type: ${type}`)
    }

    await file.set(data)
    await file.flush()
    return active
}
