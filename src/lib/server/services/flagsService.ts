import { getStoreFile, getOwn, setOwn } from '../shared/store-file.js'
import type { FlagKey, Flags, FlagsStore } from '../../types.js'

const FLAGS: FlagKey[] = [
    'software', 'childLock', 'filtered', 'alert',
    'favorite', 'revisit', 'playlist',
    'completed', 'dropped', 'inProgress', 'backlog',
]

function getFile() {
    return getStoreFile<FlagsStore>('flags.json', 'flags', () => ({}))
}

export async function getFlags(appid: string | number): Promise<Flags> {
    const file = await getFile()
    // Copy so callers can't mutate the shared in-memory store.
    return { ...(getOwn(file.get(), String(appid)) ?? {}) }
}

export async function setFlag(appid: string | number, flag: string, value: boolean): Promise<Flags> {
    if (!FLAGS.includes(flag as FlagKey)) throw new Error(`Unknown flag: ${flag}`)

    const file = await getFile()
    const data = file.get()
    const key  = String(appid)

    let flags = getOwn(data, key)
    if (!flags) {
        flags = {}
        setOwn(data, key, flags)
    }
    if (value) {
        flags[flag as FlagKey] = true
    } else {
        delete flags[flag as FlagKey]
        if (Object.keys(flags).length === 0) delete data[key]
    }

    await file.set(data)
    await file.flush()
    return { ...(getOwn(data, key) ?? {}) }
}

export async function getAllFlags(): Promise<FlagsStore> {
    const file = await getFile()
    const data = file.get()
    // Shallow-clone each entry — callers must not reach the live store.
    const out: FlagsStore = {}
    for (const key of Object.keys(data)) setOwn(out, key, { ...data[key] })
    return out
}
