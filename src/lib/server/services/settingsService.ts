import path from 'node:path'
import { ManagedFile } from '../shared/managed-file.js'
import type { Settings } from '../../types.js'

const DEFAULTS: Settings = { showChildLocked: false, showFiltered: false, showSoftware: false, hideUnavailable: false, titleBlocklist: [], discoverFiltersEnabled: true, hideAdultContent: true }

function makeFile(): ManagedFile<Settings> {
    const dataDir = process.env.DATA_DIR
    if (!dataDir) throw new Error('DATA_DIR must be set')
    return new ManagedFile<Settings>({
        filePath:     path.join(dataDir, 'gaming-journal', 'settings.json'),
        name:         'settings',
        defaultValue: () => ({ ...DEFAULTS }),
    })
}

export async function getSettings(): Promise<Settings> {
    const file = makeFile()
    await file.load()
    const data = file.get()
    await file.close()
    return { ...DEFAULTS, ...data }
}

export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
    const file = makeFile()
    await file.load()
    const data: Settings = { ...DEFAULTS, ...file.get() }
    for (const [k, v] of Object.entries(patch)) {
        const key = k as keyof Settings
        if (key === 'titleBlocklist') {
            if (Array.isArray(v) && v.every(t => typeof t === 'string')) data.titleBlocklist = v
        } else if (key in DEFAULTS && typeof v === 'boolean') {
            (data as unknown as Record<string, unknown>)[key] = v
        }
    }
    await file.set(data)
    await file.flush()
    await file.close()
    return data
}
