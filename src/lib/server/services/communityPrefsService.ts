import path from 'node:path'
import { ManagedFile } from '../shared/managed-file.js'
import type { CommunityPrefs } from '../../types.js'

type PrefType = 'filter' | 'mute' | 'favorite' | 'highlight'

function makeFile(): ManagedFile<CommunityPrefs> {
    const dataDir = process.env.DATA_DIR
    if (!dataDir) throw new Error('DATA_DIR must be set')
    return new ManagedFile<CommunityPrefs>({
        filePath:     path.join(dataDir, 'gaming-journal', 'community-prefs.json'),
        name:         'community-prefs',
        defaultValue: () => ({ filtered: [], muted: [], favorited: [], highlighted: {} }),
    })
}

function _ensure(data: CommunityPrefs): CommunityPrefs {
    data.filtered    ??= []
    data.muted       ??= []
    data.favorited   ??= []
    data.highlighted ??= {}
    return data
}

export async function getPrefs(): Promise<CommunityPrefs> {
    const file = makeFile()
    await file.load()
    const data = _ensure(file.get())
    await file.close()
    return {
        filtered:    data.filtered,
        muted:       data.muted,
        favorited:   data.favorited,
        highlighted: data.highlighted,
    }
}

export async function togglePref(type: PrefType, username: string, appid: string | number | null = null): Promise<boolean> {
    const file = makeFile()
    await file.load()
    const data = _ensure(file.get())

    let active: boolean

    if (type === 'filter' || type === 'mute' || type === 'favorite') {
        const key = type === 'filter' ? 'filtered' : type === 'mute' ? 'muted' : 'favorited'
        const idx = data[key].indexOf(username)
        if (idx >= 0) { data[key].splice(idx, 1); active = false }
        else          { data[key].push(username);  active = true  }
    } else if (type === 'highlight') {
        if (!appid) throw new Error('appid required for highlight')
        const k = String(appid)
        data.highlighted[k] ??= []
        const idx = data.highlighted[k].indexOf(username)
        if (idx >= 0) {
            data.highlighted[k].splice(idx, 1)
            if (data.highlighted[k].length === 0) delete data.highlighted[k]
            active = false
        } else {
            data.highlighted[k].push(username)
            active = true
        }
    } else {
        throw new Error(`Unknown pref type: ${type}`)
    }

    await file.set(data)
    await file.flush()
    await file.close()
    return active
}
