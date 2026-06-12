import path from 'node:path'
import { ManagedFile } from '../shared/managed-file.js'

function makeFile() {
    const dataDir = process.env.DATA_DIR
    if (!dataDir) throw new Error('DATA_DIR must be set')
    return new ManagedFile({
        filePath:     path.join(dataDir, 'gaming-journal', 'reddit-subreddits.json'),
        name:         'reddit-subreddits',
        defaultValue: () => ({}),
    })
}

export async function getSubreddits(appid) {
    const file = makeFile()
    await file.load()
    const data = file.get()
    await file.close()
    return data[String(appid)] ?? []
}

export async function addSubreddit(appid, name) {
    const file = makeFile()
    await file.load()
    const data    = file.get()
    const key     = String(appid)
    const current = data[key] ?? []
    if (current.some(s => s.toLowerCase() === name.toLowerCase())) {
        await file.close()
        return current
    }
    const updated = [...current, name]
    await file.set({ ...data, [key]: updated })
    await file.flush()
    await file.close()
    return updated
}

export async function removeSubreddit(appid, name) {
    const file = makeFile()
    await file.load()
    const data    = file.get()
    const key     = String(appid)
    const current = data[key] ?? []
    const updated = current.filter(s => s.toLowerCase() !== name.toLowerCase())
    if (updated.length === 0) {
        const { [key]: _, ...rest } = data
        await file.set(rest)
    } else {
        await file.set({ ...data, [key]: updated })
    }
    await file.flush()
    await file.close()
    return updated
}
