import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { ManagedFile } from '../shared/managed-file.js'
import type { LocalReview, ReviewNote } from '../../types.js'

type ReviewStore = Record<string, LocalReview>

function makeFile(): ManagedFile<ReviewStore> {
    const dataDir = process.env.DATA_DIR
    if (!dataDir) throw new Error('DATA_DIR must be set')
    return new ManagedFile<ReviewStore>({
        filePath:     path.join(dataDir, 'gaming-journal', 'local-reviews.json'),
        name:         'local-reviews',
        defaultValue: () => ({}),
    })
}

function _noteId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
}

export async function getLocalReview(appid: string | number): Promise<LocalReview | null> {
    const file = makeFile()
    await file.load()
    const data = file.get()
    await file.close()
    return data[String(appid)] ?? null
}

export async function getAllLocalReviews(): Promise<ReviewStore> {
    const file = makeFile()
    await file.load()
    const data = file.get()
    await file.close()
    return data
}

export async function setLocalReview(appid: string | number, reviewData: Omit<LocalReview, 'updatedAt'>): Promise<LocalReview> {
    const file = makeFile()
    await file.load()
    const data = file.get()

    data[String(appid)] = {
        ...reviewData,
        updatedAt: new Date().toISOString(),
    }

    await file.set(data)
    await file.flush()
    await file.close()
    return data[String(appid)]
}

export async function deleteLocalReview(appid: string | number): Promise<void> {
    const file = makeFile()
    await file.load()
    const data = file.get()
    delete data[String(appid)]
    await file.set(data)
    await file.flush()
    await file.close()
}

export async function addNote(appid: string | number, text: string): Promise<ReviewNote> {
    const file = makeFile()
    await file.load()
    const data = file.get()
    const key  = String(appid)

    if (!data[key]) {
        data[key] = {
            stars:     0,
            ratings:   {},
            tags:      [],
            notes:     [],
            review:    '',
            updatedAt: new Date().toISOString(),
        }
    }

    const note: ReviewNote = {
        id:        _noteId(),
        text:      String(text).trim(),
        pinned:    false,
        createdAt: new Date().toISOString(),
    }

    data[key].notes = data[key].notes ?? []
    data[key].notes.push(note)
    data[key].updatedAt = new Date().toISOString()

    await file.set(data)
    await file.flush()
    await file.close()
    return note
}

export async function deleteNote(appid: string | number, noteId: string): Promise<void> {
    const file = makeFile()
    await file.load()
    const data = file.get()
    const key  = String(appid)

    if (!data[key]) return
    data[key].notes     = (data[key].notes ?? []).filter(n => n.id !== noteId)
    data[key].updatedAt = new Date().toISOString()

    await file.set(data)
    await file.flush()
    await file.close()
}

export async function updateNote(appid: string | number, noteId: string, updates: Partial<ReviewNote>): Promise<ReviewNote | null> {
    const file  = makeFile()
    await file.load()
    const data  = file.get()
    const key   = String(appid)
    if (!data[key]) return null
    const notes = data[key].notes ?? []
    const idx   = notes.findIndex(n => n.id === noteId)
    if (idx === -1) return null
    notes[idx] = { ...notes[idx], ...updates }
    data[key].updatedAt = new Date().toISOString()
    await file.set(data)
    await file.flush()
    await file.close()
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
