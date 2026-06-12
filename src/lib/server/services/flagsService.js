import path from 'node:path'
import { ManagedFile } from '../shared/managed-file.js'

const FLAGS = [
    'software', 'childLock', 'filtered', 'alert',
    'favorite', 'revisit',
    'completed', 'dropped', 'inProgress', 'backlog',
]

function makeFile() {
    const dataDir = process.env.DATA_DIR
    if (!dataDir) throw new Error('DATA_DIR must be set')
    return new ManagedFile({
        filePath:     path.join(dataDir, 'gaming-journal', 'flags.json'),
        name:         'flags',
        defaultValue: () => ({}),
    })
}

export async function getFlags(appid) {
    const file = makeFile()
    await file.load()
    const data = file.get()
    await file.close()
    return data[appid] ?? {}
}

export async function setFlag(appid, flag, value) {
    if (!FLAGS.includes(flag)) throw new Error(`Unknown flag: ${flag}`)

    const file = makeFile()
    await file.load()
    const data = file.get()

    if (!data[appid]) data[appid] = {}
    if (value) {
        data[appid][flag] = true
    } else {
        delete data[appid][flag]
        if (Object.keys(data[appid]).length === 0) delete data[appid]
    }

    await file.set(data)
    await file.flush()
    await file.close()
    return data[appid] ?? {}
}

export async function getAllFlags() {
    const file = makeFile()
    await file.load()
    const data = file.get()
    await file.close()
    return data
}
