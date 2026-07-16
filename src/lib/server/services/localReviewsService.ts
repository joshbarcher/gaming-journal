import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { ManagedFile } from '../shared/managed-file.js'
import type { LocalReview, ReviewNote } from '../../types.js'

type ReviewStore = Record<string, LocalReview>

// One ManagedFile per store path, held for the process lifetime. A fresh instance
// per call (the old shape) meant every mutator did read-modify-write against its own
// copy — two concurrent mutations silently lost one. Sharing the instance serializes
// them through the same in-memory object. Keyed by path so tests (and any future
// DATA_DIR change) get the right file.
const _files = new Map<string, ManagedFile<ReviewStore>>()

async function getFile(): Promise<ManagedFile<ReviewStore>> {
    const dataDir = process.env.DATA_DIR
    if (!dataDir) throw new Error('DATA_DIR must be set')
    const filePath = path.join(dataDir, 'gaming-journal', 'local-reviews.json')
    let file = _files.get(filePath)
    if (!file) {
        file = new ManagedFile<ReviewStore>({
            filePath,
            name:         'local-reviews',
            defaultValue: () => ({}),
        })
        _files.set(filePath, file)
    }
    await file.load()
    return file
}

// Appids are attacker-adjacent input (route params). Plain `data[key]` reads walk the
// prototype chain ("__proto__" → Object.prototype!) and plain assignment to "__proto__"
// swaps the prototype instead of storing. Own-property access + defineProperty treat
// every key as inert data.
function getOwn(data: ReviewStore, key: string): LocalReview | null {
    return Object.hasOwn(data, key) ? data[key] : null
}

function setOwn(data: ReviewStore, key: string, value: LocalReview): void {
    Object.defineProperty(data, key, { value, writable: true, enumerable: true, configurable: true })
}

function _noteId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
}

export async function getLocalReview(appid: string | number): Promise<LocalReview | null> {
    const file = await getFile()
    return getOwn(file.get(), String(appid))
}

export async function getAllLocalReviews(): Promise<ReviewStore> {
    const file = await getFile()
    return file.get()
}

export async function setLocalReview(appid: string | number, reviewData: Omit<LocalReview, 'updatedAt'>): Promise<LocalReview> {
    const file = await getFile()
    const data = file.get()
    const key  = String(appid)

    const review: LocalReview = {
        ...reviewData,
        updatedAt: new Date().toISOString(),
    }
    setOwn(data, key, review)

    await file.set(data)
    await file.flush()
    return review
}

export async function deleteLocalReview(appid: string | number): Promise<void> {
    const file = await getFile()
    const data = file.get()
    if (!Object.hasOwn(data, String(appid))) return
    delete data[String(appid)]
    await file.set(data)
    await file.flush()
}

export async function addNote(appid: string | number, text: string): Promise<ReviewNote> {
    const file = await getFile()
    const data = file.get()
    const key  = String(appid)

    let entry = getOwn(data, key)
    if (!entry) {
        entry = {
            stars:     0,
            ratings:   {},
            tags:      [],
            notes:     [],
            review:    '',
            updatedAt: new Date().toISOString(),
        }
        setOwn(data, key, entry)
    }

    const note: ReviewNote = {
        id:        _noteId(),
        text:      String(text).trim(),
        pinned:    false,
        createdAt: new Date().toISOString(),
    }

    entry.notes = entry.notes ?? []
    entry.notes.push(note)
    entry.updatedAt = new Date().toISOString()

    await file.set(data)
    await file.flush()
    return note
}

export async function deleteNote(appid: string | number, noteId: string): Promise<void> {
    const file  = await getFile()
    const data  = file.get()
    const entry = getOwn(data, String(appid))

    if (!entry) return
    entry.notes     = (entry.notes ?? []).filter(n => n.id !== noteId)
    entry.updatedAt = new Date().toISOString()

    await file.set(data)
    await file.flush()
}

export async function updateNote(appid: string | number, noteId: string, updates: Partial<ReviewNote>): Promise<ReviewNote | null> {
    const file  = await getFile()
    const data  = file.get()
    const entry = getOwn(data, String(appid))
    if (!entry) return null
    const notes = entry.notes ?? []
    const idx   = notes.findIndex(n => n.id === noteId)
    if (idx === -1) return null
    // Strip identity fields like JournalService.update — callers may only edit content.
    const { id: _id, createdAt: _created, ...safe } = updates
    notes[idx] = { ...notes[idx], ...safe }
    entry.updatedAt = new Date().toISOString()
    await file.set(data)
    await file.flush()
    return notes[idx]
}

// ── Steam review seeding ──────────────────────────────────────────────────────

function _relayReviewsPath(): string {
    const dataDir = process.env.DATA_DIR
    if (!dataDir) throw new Error('DATA_DIR must be set')
    return path.join(dataDir, 'relay', 'steam', 'reviews.json')
}

interface SteamReview {
    voted_up: boolean
    review?:  string
}

interface SteamEntry {
    review?: SteamReview
}

function _buildSeed(steamEntry: SteamEntry | undefined | null): Omit<LocalReview, 'updatedAt'> | null {
    const r = steamEntry?.review
    if (!r) return null
    return {
        stars:   r.voted_up ? 3 : 0,
        ratings: {},
        tags:    [],
        notes:   [],
        review:  r.review ?? '',
    }
}

export async function getOrSeedLocalReview(appid: string | number): Promise<LocalReview | null> {
    const existing = await getLocalReview(appid)
    if (existing !== null) return existing

    try {
        const raw        = await readFile(_relayReviewsPath(), 'utf8')
        const allReviews = JSON.parse(raw) as Record<string, SteamEntry>
        const steamEntry = allReviews[String(appid)] ?? allReviews[Number(appid)]
        const seed       = _buildSeed(steamEntry)
        if (!seed) return null
        return await setLocalReview(appid, seed)
    } catch {
        return null
    }
}
