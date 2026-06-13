import path from 'node:path'
import { ManagedFile } from '../shared/managed-file.js'
import logger from '../logger.js'
import type { WishlistItem, WishlistStore } from '../../types.js'

function makeFile(): ManagedFile<WishlistStore> {
    const dataDir = process.env.DATA_DIR
    if (!dataDir) throw new Error('DATA_DIR must be set')
    return new ManagedFile<WishlistStore>({
        filePath:     path.join(dataDir, 'gaming-journal', 'local-wishlist.json'),
        name:         'local-wishlist',
        defaultValue: () => ({ items: {} }),
    })
}

export async function getAll(): Promise<WishlistStore> {
    logger.info('[local-wishlist-svc] getAll called')
    const file = makeFile()
    await file.load()
    const data = file.get()
    const count = Object.keys(data.items ?? {}).length
    logger.info('[local-wishlist-svc] getAll result', { count })
    await file.close()
    return data
}

export async function add(appid: number | string): Promise<WishlistItem> {
    logger.info('[local-wishlist-svc] add called', { appid })
    const file = makeFile()
    await file.load()
    const data = file.get()
    const key  = String(appid)
    if (!data.items[key]) {
        data.items[key] = { dateAdded: Math.floor(Date.now() / 1000) }
        await file.set(data)
        await file.flush()
        logger.info('[local-wishlist-svc] add flushed to disk', { appid })
    } else {
        logger.info('[local-wishlist-svc] add skipped (already exists)', { appid })
    }
    await file.close()
    return data.items[key]
}

export async function remove(appid: number | string): Promise<void> {
    logger.info('[local-wishlist-svc] remove called', { appid })
    const file   = makeFile()
    await file.load()
    const data   = file.get()
    const existed = !!data.items[String(appid)]
    delete data.items[String(appid)]
    await file.set(data)
    await file.flush()
    logger.info('[local-wishlist-svc] remove flushed to disk', { appid, existed })
    await file.close()
}

export async function cleanupOwned(ownedAppids: (number | string)[]): Promise<boolean> {
    const owned   = new Set(ownedAppids.map(String))
    const file    = makeFile()
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
