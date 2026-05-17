import path from 'node:path'
import { ManagedFile } from '../shared/managed-file.js'

const DEFAULTS = { showChildLocked: false, showFiltered: false }

function makeFile() {
    const dataDir = process.env.DATA_DIR
    if (!dataDir) throw new Error('DATA_DIR must be set')
    return new ManagedFile({
        filePath:     path.join(dataDir, 'gaming-journal', 'settings.json'),
        name:         'settings',
        defaultValue: () => ({ ...DEFAULTS }),
    })
}

export async function getSettings() {
    const file = makeFile()
    await file.load()
    const data = file.get()
    await file.close()
    return { ...DEFAULTS, ...data }
}

export async function patchSettings(patch) {
    const allowed = Object.keys(DEFAULTS)
    const file = makeFile()
    await file.load()
    const data = file.get()
    for (const [k, v] of Object.entries(patch)) {
        if (allowed.includes(k) && typeof v === 'boolean') data[k] = v
    }
    await file.set(data)
    await file.flush()
    await file.close()
    return { ...DEFAULTS, ...data }
}
