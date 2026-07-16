import { getStoreFile, getOwn, setOwn } from '../shared/store-file.js'

type SubredditStore = Record<string, string[]>

function getFile() {
    return getStoreFile<SubredditStore>('reddit-subreddits.json', 'reddit-subreddits', () => ({}))
}

/** Tolerate hand-edited/corrupt entries: anything that isn't an array reads as []. */
function entryFor(data: SubredditStore, key: string): string[] {
    const value = getOwn(data, key)
    return Array.isArray(value) ? value : []
}

export async function getSubreddits(appid: string | number): Promise<string[]> {
    const file = await getFile()
    return [...entryFor(file.get(), String(appid))]
}

export async function addSubreddit(appid: string | number, name: string): Promise<string[]> {
    const file    = await getFile()
    const data    = file.get()
    const key     = String(appid)
    const current = entryFor(data, key)
    if (current.some(s => s.toLowerCase() === name.toLowerCase())) {
        return [...current]
    }
    const updated = [...current, name]
    setOwn(data, key, updated)
    await file.set(data)
    await file.flush()
    return [...updated]
}

export async function removeSubreddit(appid: string | number, name: string): Promise<string[]> {
    const file    = await getFile()
    const data    = file.get()
    const key     = String(appid)
    const updated = entryFor(data, key).filter(s => s.toLowerCase() !== name.toLowerCase())
    if (updated.length === 0) {
        delete data[key]
    } else {
        setOwn(data, key, updated)
    }
    await file.set(data)
    await file.flush()
    return [...updated]
}
