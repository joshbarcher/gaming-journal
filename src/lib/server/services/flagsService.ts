import path from 'node:path'
import { ManagedFile } from '../shared/managed-file.js'
import type { FlagKey, Flags, FlagsStore } from '../../types.js'

const FLAGS: FlagKey[] = [
    'software', 'childLock', 'filtered', 'alert',
    'favorite', 'revisit',
    'completed', 'dropped', 'inProgress', 'backlog',
]

function makeFile(): ManagedFile<FlagsStore> {
    const dataDir = process.env.DATA_DIR
    if (!dataDir) throw new Error('DATA_DIR must be set')
    return new ManagedFile<FlagsStore>({
        filePath:     path.join(dataDir, 'gaming-journal', 'flags.json'),
        name:         'flags',
        defaultValue: () => ({}),
    })
}

export async function getFlags(appid: string | number): Promise<Flags> {
    const file = makeFile()
    await file.load()
    const data = file.get()
    await file.close()
    return data[String(appid)] ?? {}
}

export async function setFlag(appid: string | number, flag: string, value: boolean): Promise<Flags> {
    if (!FLAGS.includes(flag as FlagKey)) throw new Error(`Unknown flag: ${flag}`)

    const file = makeFile()
    await file.load()
    const data = file.get()
    const key  = String(appid)

    if (!data[key]) data[key] = {}
    if (value) {
        data[key][flag as FlagKey] = true
    } else {
        delete data[key][flag as FlagKey]
        if (Object.keys(data[key]).length === 0) delete data[key]
    }

    await file.set(data)
    await file.flush()
    await file.close()
    return data[key] ?? {}
}

export async function getAllFlags(): Promise<FlagsStore> {
    const file = makeFile()
    await file.load()
    const data = file.get()
    await file.close()
    return data
}
