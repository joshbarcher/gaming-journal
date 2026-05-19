import path from 'node:path'
import { ManagedFile } from '../shared/managed-file.js'

function makeFile() {
    const dataDir = process.env.DATA_DIR
    if (!dataDir) throw new Error('DATA_DIR must be set')
    return new ManagedFile({
        filePath:     path.join(dataDir, 'gaming-journal', 'local-wishlist.json'),
        name:         'local-wishlist',
        defaultValue: () => ({ items: {} }),
    })
}

export async function getAll() {
    const file = makeFile()
    await file.load()
    const data = file.get()
    await file.close()
    return data
}

export async function add(appid) {
    const file = makeFile()
    await file.load()
    const data = file.get()
    if (!data.items[String(appid)]) {
        data.items[String(appid)] = { dateAdded: Math.floor(Date.now() / 1000) }
        await file.set(data)
        await file.flush()
    }
    await file.close()
    return data.items[String(appid)]
}

export async function remove(appid) {
    const file = makeFile()
    await file.load()
    const data = file.get()
    delete data.items[String(appid)]
    await file.set(data)
    await file.flush()
    await file.close()
}

// Called on startup — remove any local wishlist items already in the library.
export async function cleanupOwned(ownedAppids) {
    const owned = new Set(ownedAppids.map(String))
    const file  = makeFile()
    await file.load()
    const data    = file.get()
    let   changed = false
    for (const id of Object.keys(data.items)) {
        if (owned.has(id)) { delete data.items[id]; changed = true }
    }
    if (changed) { await file.set(data); await file.flush() }
    await file.close()
    return changed
}
