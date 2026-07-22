import path from 'node:path'
import { ManagedFile } from '../shared/managed-file.js'

const ALLOWED = new Set(['in-progress', 'backlog', 'playlist'])

function makeFile(name: string): ManagedFile<number[]> {
    const dataDir = process.env.DATA_DIR
    if (!dataDir) throw new Error('DATA_DIR must be set')
    return new ManagedFile<number[]>({
        filePath:     path.join(dataDir, 'gaming-journal', `${name}-order.json`),
        name:         `${name}-order`,
        defaultValue: () => [],
    })
}

export function isValidOrderName(name: string): boolean {
    return ALLOWED.has(name)
}

export async function getOrder(name: string): Promise<number[]> {
    const file = makeFile(name)
    await file.load()
    const data = file.get()
    await file.close()
    return Array.isArray(data) ? data : []
}

export async function setOrder(name: string, appids: number[]): Promise<void> {
    const file = makeFile(name)
    await file.load()
    await file.set(appids)
    await file.flush()
    await file.close()
}
