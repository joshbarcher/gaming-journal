import { getStoreFile } from '../shared/store-file.js'
import type { Settings } from '../../types.js'

const DEFAULTS: Settings = { showChildLocked: false, showFiltered: false, showSoftware: false, hideUnavailable: false, titleBlocklist: [], discoverFiltersEnabled: true, hideAdultContent: true, guidePinsCollapsed: false }

function getFile() {
    return getStoreFile<Settings>('settings.json', 'settings', () => ({ ...DEFAULTS }))
}

export async function getSettings(): Promise<Settings> {
    const file = await getFile()
    const data = file.get()
    // Fresh object + fresh array: callers must not mutate the shared store (or DEFAULTS).
    return { ...DEFAULTS, ...data, titleBlocklist: [...(data.titleBlocklist ?? DEFAULTS.titleBlocklist)] }
}

export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
    const file = await getFile()
    const data: Settings = { ...DEFAULTS, ...file.get() }
    for (const [k, v] of Object.entries(patch)) {
        const key = k as keyof Settings
        if (key === 'titleBlocklist') {
            if (Array.isArray(v) && v.every(t => typeof t === 'string')) data.titleBlocklist = [...v]
        } else if (Object.hasOwn(DEFAULTS, key) && typeof v === 'boolean') {
            // hasOwn, not `in`: inherited keys like "constructor" must not persist as junk.
            (data as unknown as Record<string, unknown>)[key] = v
        }
    }
    await file.set(data)
    await file.flush()
    return { ...data, titleBlocklist: [...data.titleBlocklist] }
}
