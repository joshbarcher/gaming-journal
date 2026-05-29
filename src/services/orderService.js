import path from 'node:path'
import { ManagedFile } from '../shared/managed-file.js'

const ALLOWED = new Set(['on-hold', 'vault'])

function makeFile(name) {
    const dataDir = process.env.DATA_DIR
    if (!dataDir) throw new Error('DATA_DIR must be set')
    return new ManagedFile({
        filePath:     path.join(dataDir, 'gaming-journal', `${name}-order.json`),
        name:         `${name}-order`,
        defaultValue: () => [],
    })
}

export function isValidOrderName(name) {
    return ALLOWED.has(name)
}

export async function getOrder(name) {
    const file = makeFile(name)
    await file.load()
    const data = file.get()
    await file.close()
    return Array.isArray(data) ? data : []
}

export async function setOrder(name, appids) {
    const file = makeFile(name)
    await file.load()
    await file.set(appids)
    await file.flush()
    await file.close()
}
