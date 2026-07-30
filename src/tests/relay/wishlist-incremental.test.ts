// @ts-nocheck — untyped .js service under test.
//
// Incremental wishlist index. The full scan re-read every entry's store + itad file
// (~2200 files, 17s against the NAS) to pick up a handful of price changes. Unlike
// community-reviews, a row here is NOT a pure function of those files: priority,
// dateAdded, local and the alert flag come from the wishlist meta and flags.json,
// and changing any of them moves no file mtime at all.

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'

let tmpDir: string
let mod: typeof import('../../lib/server/relay/wishlist/wishlist.service.js')

const STEAM = () => path.join(tmpDir, 'relay', 'steam')
const ITAD  = () => path.join(tmpDir, 'relay', 'itad')
const GJ    = () => path.join(tmpDir, 'gaming-journal')
const SIG   = () => path.join(STEAM(), 'wishlist-index-sources.json')

async function writeJson(file: string, data: unknown) {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify(data))
}

const storePath = (appid: number) => path.join(STEAM(), 'store', `${appid}.json`)
const itadPath  = (appid: number) => path.join(ITAD(), `${appid}.json`)

async function writeStore(appid: number, over: Record<string, unknown> = {}) {
    await writeJson(storePath(appid), { steam_appid: appid, name: `Game ${appid}`, ...over })
}
async function writeItad(appid: number, deals: unknown[] = []) {
    await writeJson(itadPath(appid), { deals })
}
async function writeSteamWishlist(items: Record<string, unknown>) {
    await writeJson(path.join(STEAM(), 'wishlist.json'), { fetchedAt: new Date().toISOString(), items })
}
async function writeFlags(flags: Record<string, unknown>) {
    await writeJson(path.join(GJ(), 'flags.json'), flags)
}

async function touch(p: string, secondsAhead = 10) {
    const t = new Date(Date.now() + secondsAhead * 1000)
    await fs.utimes(p, t, t)
}

function item(appid: number) {
    return mod.get().find(i => i.appid === appid) ?? null
}

/** Re-import so wishlist.json (a ManagedFile) is re-read; in production the sync
 *  writes it through ManagedFile so the in-process cache is already current. */
async function reload() {
    vi.resetModules()
    mod = await import('../../lib/server/relay/wishlist/wishlist.service.js')
    await mod.ensureBuilt()
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gj-wl-delta-'))
    process.env.DATA_DIR = tmpDir
    delete process.env.RELAY_DATA_ROOT
    await fs.mkdir(GJ(), { recursive: true })
    await writeFlags({})
    vi.resetModules()
    mod = await import('../../lib/server/relay/wishlist/wishlist.service.js')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {})
})

describe('wishlist index — incremental refresh', () => {
    async function seed() {
        await writeSteamWishlist({
            '10': { priority: 1, date_added: '2026-07-01T00:00:00.000Z' },
            '20': { priority: 2, date_added: '2026-07-02T00:00:00.000Z' },
        })
        await writeStore(10, { price_overview: { final: 1999, final_formatted: '$19.99' } })
        await writeStore(20)
        await writeItad(10)
        await writeItad(20)
        await mod.build()
    }

    it('scans everything on the first refresh and records signatures', async () => {
        await seed()
        expect(mod.get().map(i => i.appid).sort((a, b) => a - b)).toEqual([10, 20])
        const sig = JSON.parse(await fs.readFile(SIG(), 'utf8'))
        expect(sig.sigs['10']).toBeTruthy()
    })

    it('re-shapes only the entry whose price file changed', async () => {
        await seed()
        const untouched = item(20)

        await writeItad(10, [{ price: 4.99, cut: 75, store: 'Steam', url: 'u' }])
        await touch(itadPath(10))
        await mod.build()

        expect(item(10).itad.bestPrice).toMatchObject({ price: 4.99, cut: 75 })
        expect(item(20)).toBe(untouched)   // identity: reused, not re-derived
    })

    it('re-shapes when the store price changed', async () => {
        await seed()
        await writeStore(10, { price_overview: { final: 999, final_formatted: '$9.99' } })
        await touch(storePath(10))
        await mod.build()
        expect(item(10).store.price).toMatchObject({ amount: 9.99 })
    })

    // No file mtime moves when you toggle an alert — flags.json is a separate list.
    it('re-shapes when the alert flag changed even though no source file did', async () => {
        await seed()
        expect(item(10).flags.alert).toBe(false)

        await writeFlags({ '10': { alert: true } })
        await mod.build()

        expect(item(10).flags.alert).toBe(true)
    })

    it('re-shapes when the wishlist priority changed', async () => {
        await seed()
        await writeSteamWishlist({
            '10': { priority: 9, date_added: '2026-07-01T00:00:00.000Z' },
            '20': { priority: 2, date_added: '2026-07-02T00:00:00.000Z' },
        })
        await reload()
        await mod.build()

        expect(item(10).wishlist.priority).toBe(9)
        // ...and the array stays priority-sorted, so 20 now comes first.
        expect(mod.get().map(i => i.appid)).toEqual([20, 10])
    })

    it('picks up a newly wishlisted game', async () => {
        await seed()
        await writeStore(30)
        await writeItad(30)
        await writeSteamWishlist({
            '10': { priority: 1, date_added: '2026-07-01T00:00:00.000Z' },
            '20': { priority: 2, date_added: '2026-07-02T00:00:00.000Z' },
            '30': { priority: 3, date_added: '2026-07-03T00:00:00.000Z' },
        })
        await reload()
        await mod.build()

        expect(mod.get().map(i => i.appid)).toEqual([10, 20, 30])
    })

    it('drops a game removed from the wishlist', async () => {
        await seed()
        await writeSteamWishlist({ '10': { priority: 1, date_added: '2026-07-01T00:00:00.000Z' } })
        await reload()
        await mod.build()

        expect(mod.get().map(i => i.appid)).toEqual([10])
    })

    it('a refresh with nothing changed leaves the index untouched', async () => {
        await seed()
        const before = mod.get()
        await mod.build()
        expect(mod.get()).toEqual(before)
    })

    it('falls back to a full scan when the baseline is missing', async () => {
        await seed()
        await fs.rm(SIG(), { force: true })

        const { mtime, atime } = await fs.stat(storePath(20))
        await writeStore(20, { name: 'Rebuilt Name' })
        await fs.utimes(storePath(20), atime, mtime)

        await mod.build()
        expect(item(20).name).toBe('Rebuilt Name')
    })

    it('falls back to a full scan when the baseline is corrupt', async () => {
        await seed()
        await fs.writeFile(SIG(), '{ nope')

        const { mtime, atime } = await fs.stat(storePath(20))
        await writeStore(20, { name: 'Recovered Name' })
        await fs.utimes(storePath(20), atime, mtime)

        await mod.build()
        expect(item(20).name).toBe('Recovered Name')
    })

    // Preserved from the full scan: an empty Steam wishlist alongside local items is a
    // failed read, not a real state, and must not wipe the index.
    it('keeps the previous index when the steam wishlist reads empty but local items exist', async () => {
        await seed()
        await writeJson(path.join(GJ(), 'local-wishlist.json'), { items: { '99': { dateAdded: '2026-07-05T00:00:00.000Z' } } })
        await writeSteamWishlist({})
        await reload()
        await mod.build()

        expect(mod.get().some(i => i.appid === 10)).toBe(true)
    })
})
