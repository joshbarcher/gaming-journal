import path from 'node:path'
import { ManagedFile } from '../shared/managed-file.js'
import type { StickyNote } from '../../types.js'

type JournalNotesStore = Record<string, StickyNote[]>

function makeFile(): ManagedFile<JournalNotesStore> {
    const dataDir = process.env.DATA_DIR
    if (!dataDir) throw new Error('DATA_DIR must be set')
    return new ManagedFile<JournalNotesStore>({
        filePath:     path.join(dataDir, 'gaming-journal', 'journal-notes.json'),
        name:         'journal-notes',
        defaultValue: () => ({}),
    })
}

export async function getJournalNotes(appid: string | number): Promise<StickyNote[]> {
    const file = makeFile()
    await file.load()
    const data = file.get()
    await file.close()
    return data[String(appid)] ?? []
}

export async function setJournalNotes(appid: string | number, notes: StickyNote[]): Promise<StickyNote[]> {
    const file = makeFile()
    await file.load()
    const data = file.get()
    data[String(appid)] = notes
    await file.set(data)
    await file.flush()
    await file.close()
    return notes
}
