import path from 'node:path'
import { ManagedFile } from '../shared/managed-file.js'
import type { StickyNote } from '../../types.js'

type JournalNotesStore = Record<string, StickyNote[]>

// One ManagedFile per store path, held for the process lifetime — a fresh instance per
// call meant concurrent setJournalNotes calls did read-modify-write against separate
// copies and the last flush silently dropped the other. See localReviewsService.
const _files = new Map<string, ManagedFile<JournalNotesStore>>()

async function getFile(): Promise<ManagedFile<JournalNotesStore>> {
    const dataDir = process.env.DATA_DIR
    if (!dataDir) throw new Error('DATA_DIR must be set')
    const filePath = path.join(dataDir, 'gaming-journal', 'journal-notes.json')
    let file = _files.get(filePath)
    if (!file) {
        file = new ManagedFile<JournalNotesStore>({
            filePath,
            name:         'journal-notes',
            defaultValue: () => ({}),
        })
        _files.set(filePath, file)
    }
    await file.load()
    return file
}

export async function getJournalNotes(appid: string | number): Promise<StickyNote[]> {
    const file = await getFile()
    const data = file.get()
    const key  = String(appid)
    // Own-property read: "__proto__"/"constructor" must return [] — not Object.prototype.
    return Object.hasOwn(data, key) ? data[key] : []
}

export async function setJournalNotes(appid: string | number, notes: StickyNote[]): Promise<StickyNote[]> {
    const file = await getFile()
    const data = file.get()
    // defineProperty stores "__proto__" as inert data instead of swapping the prototype.
    Object.defineProperty(data, String(appid), { value: notes, writable: true, enumerable: true, configurable: true })
    await file.set(data)
    await file.flush()
    return notes
}
