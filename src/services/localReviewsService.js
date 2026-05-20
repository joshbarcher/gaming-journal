import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { ManagedFile } from '../shared/managed-file.js'

function makeFile() {
    const dataDir = process.env.DATA_DIR
    if (!dataDir) throw new Error('DATA_DIR must be set')
    return new ManagedFile({
        filePath:     path.join(dataDir, 'gaming-journal', 'local-reviews.json'),
        name:         'local-reviews',
        defaultValue: () => ({}),
    })
}

function _noteId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
}

export async function getLocalReview(appid) {
    const file = makeFile()
    await file.load()
    const data = file.get()
    await file.close()
    return data[appid] ?? null
}

export async function getAllLocalReviews() {
    const file = makeFile()
    await file.load()
    const data = file.get()
    await file.close()
    return data
}

export async function setLocalReview(appid, reviewData) {
    const file = makeFile()
    await file.load()
    const data = file.get()

    data[appid] = {
        ...reviewData,
        updatedAt: new Date().toISOString(),
    }

    await file.set(data)
    await file.flush()
    await file.close()
    return data[appid]
}

export async function deleteLocalReview(appid) {
    const file = makeFile()
    await file.load()
    const data = file.get()
    delete data[appid]
    await file.set(data)
    await file.flush()
    await file.close()
}

export async function addNote(appid, text) {
    const file = makeFile()
    await file.load()
    const data = file.get()

    if (!data[appid]) {
        data[appid] = {
            stars:    0,
            ratings:  {},
            tags:     [],
            notes:    [],
            review:   '',
            updatedAt: new Date().toISOString(),
        }
    }

    const note = {
        id:        _noteId(),
        text:      String(text).trim(),
        createdAt: new Date().toISOString(),
    }

    data[appid].notes = data[appid].notes ?? []
    data[appid].notes.push(note)
    data[appid].updatedAt = new Date().toISOString()

    await file.set(data)
    await file.flush()
    await file.close()
    return note
}

export async function deleteNote(appid, noteId) {
    const file = makeFile()
    await file.load()
    const data = file.get()

    if (!data[appid]) return
    data[appid].notes = (data[appid].notes ?? []).filter(n => n.id !== noteId)
    data[appid].updatedAt = new Date().toISOString()

    await file.set(data)
    await file.flush()
    await file.close()
}

// ── Steam review seeding ──────────────────────────────────────────────────────

function _relayReviewsPath() {
    const dataDir = process.env.DATA_DIR
    if (!dataDir) throw new Error('DATA_DIR must be set')
    return path.join(dataDir, 'relay', 'steam', 'reviews.json')
}

function _buildSeed(steamEntry) {
    const r = steamEntry?.review
    if (!r) return null   // no Steam review posted — nothing to seed
    return {
        stars:   r.voted_up ? 3 : 0,
        ratings: {},
        tags:    [],
        notes:   [],
        review:  r.review ?? '',
    }
}

// Returns the local review for appid, creating a seed from the Steam review
// the first time if no local review has been written yet.
export async function getOrSeedLocalReview(appid) {
    const existing = await getLocalReview(appid)
    if (existing !== null) return existing

    try {
        const raw        = await readFile(_relayReviewsPath(), 'utf8')
        const allReviews = JSON.parse(raw)
        const steamEntry = allReviews[String(appid)] ?? allReviews[Number(appid)]
        const seed       = _buildSeed(steamEntry)
        if (!seed) return null
        return await setLocalReview(appid, seed)
    } catch {
        return null   // relay reviews file absent or unreadable — silent fallback
    }
}
