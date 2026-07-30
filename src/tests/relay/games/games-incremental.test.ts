// @ts-nocheck — the service is untyped .js; assertions are runtime-verified.
//
// Incremental games-index refresh. The full rebuild re-read every game's four
// per-appid source files: measured against the NAS, 12,939 files / 50 MB / 54.6s,
// run every 30 minutes to pick up (measured) 2 changed files an hour. readdir+stat
// over the same entries takes 363ms, so the refresh now diffs mtimes and re-merges
// only what moved.
//
// These tests pin the diff, and the cases where reusing an entry would be WRONG:
// a changed source file, a new/removed game, a playtime change that no file mtime
// reflects, a changed merge shape, and any unusable signature baseline.

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'

let tmpDir: string
let mod: typeof import('../../../lib/server/relay/games/games.service.js')

const STEAM = () => path.join(tmpDir, 'relay', 'steam')
const SIG   = () => path.join(STEAM(), 'games-index-sources.json')
const INDEX = () => path.join(STEAM(), 'games-index.json')

async function writeJson(file: string, data: unknown) {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify(data))
}

/** One per-appid store file — the source the merge reads for name/description. */
async function writeStore(appid: number, over: Record<string, unknown> = {}) {
    await writeJson(path.join(STEAM(), 'store', `${appid}.json`), {
        steam_appid: appid, name: `Game ${appid}`, type: 'game',
        short_description: `Desc ${appid}`, ...over,
    })
}

/** The library list, i.e. what Steam reports as owned + playtime. */
async function writeLibrary(games: { appid: number; name?: string; playtime_forever?: number }[]) {
    await writeJson(path.join(STEAM(), 'games.json'), {
        fetchedAt: new Date().toISOString(),
        games: games.map(g => ({ appid: g.appid, name: g.name ?? `Game ${g.appid}`, playtime_forever: g.playtime_forever ?? 0 })),
    })
}

async function writeWishlist(items: Record<string, unknown> = {}) {
    await writeJson(path.join(STEAM(), 'wishlist.json'), { fetchedAt: new Date().toISOString(), items })
}

/** mtime resolution can be coarse; nudge it forward explicitly. */
async function touch(file: string, secondsAhead = 10) {
    const t = new Date(Date.now() + secondsAhead * 1000)
    await fs.utimes(file, t, t)
}

async function refresh() { await mod.build() }

/**
 * Re-import the service so the library/wishlist files are re-read from disk.
 *
 * games.json and wishlist.json are ManagedFile-backed and cached in memory, so a
 * test writing them directly is invisible to the running module. In production the
 * steam sync writes them THROUGH ManagedFile, so the in-process cache is already
 * current — a reload is the faithful stand-in, and it also exercises the delta
 * against the persisted baseline rather than in-memory state.
 */
async function reload() {
    vi.resetModules()
    mod = await import('../../../lib/server/relay/games/games.service.js')
    await mod.ensureBuilt()   // hydrate the index from its sidecar, as boot does
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gj-games-delta-'))
    process.env.DATA_DIR = tmpDir
    delete process.env.RELAY_DATA_ROOT
    await fs.mkdir(path.join(tmpDir, 'gaming-journal'), { recursive: true })
    await fs.mkdir(path.join(STEAM(), 'store'), { recursive: true })
    vi.resetModules()
    mod = await import('../../../lib/server/relay/games/games.service.js')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {})
})

describe('games index — incremental refresh', () => {
    async function seedTwoGames() {
        await writeLibrary([{ appid: 10 }, { appid: 20 }])
        await writeWishlist()
        await writeStore(10)
        await writeStore(20)
        await refresh()                       // full build, records signatures
    }

    it('builds everything on the first refresh and records source signatures', async () => {
        await seedTwoGames()

        expect(mod.getAll().map(g => g.appid).sort((a, b) => a - b)).toEqual([10, 20])
        const sig = JSON.parse(await fs.readFile(SIG(), 'utf8'))
        expect(sig.v).toBe(1)
        expect(Object.keys(sig.sigs).sort()).toEqual(['10', '20'])
        expect(sig.shape).toBeTruthy()
    })

    it('re-merges a game whose source file changed', async () => {
        await seedTwoGames()

        const p = path.join(STEAM(), 'store', '10.json')
        await writeStore(10, { short_description: 'Updated blurb' })
        await touch(p)
        await refresh()

        expect(mod.getOne(10).store.description).toBe('Updated blurb')
        expect(mod.getOne(20).store.description).toBe('Desc 20')   // untouched
    })

    it('leaves an unchanged game byte-identical (its entry is reused, not re-derived)', async () => {
        await seedTwoGames()
        const before = mod.getOne(20)

        await writeStore(10, { short_description: 'Only 10 moved' })
        await touch(path.join(STEAM(), 'store', '10.json'))
        await refresh()

        expect(mod.getOne(20)).toEqual(before)
    })

    it('picks up a newly owned game', async () => {
        await seedTwoGames()

        await writeStore(30)
        await writeLibrary([{ appid: 10 }, { appid: 20 }, { appid: 30 }])
        await reload()
        await refresh()

        expect(mod.getAll().map(g => g.appid).sort((a, b) => a - b)).toEqual([10, 20, 30])
        expect(mod.getOne(30).name).toBe('Game 30')
    })

    it('drops a game that left the library and wishlist', async () => {
        await seedTwoGames()

        await writeLibrary([{ appid: 10 }])
        await reload()
        await refresh()

        expect(mod.getAll().map(g => g.appid)).toEqual([10])
        expect(mod.getOne(20)).toBeNull()
    })

    // No per-appid file changes when you play a game — the library list does. Diffing
    // only mtimes would silently freeze playtime.
    it('re-merges when playtime changed even though no source file did', async () => {
        await seedTwoGames()
        expect(mod.getOne(10).playtimeMinutes).toBe(0)

        await writeLibrary([{ appid: 10, playtime_forever: 425 }, { appid: 20 }])
        await reload()
        await refresh()

        expect(mod.getOne(10).playtimeMinutes).toBe(425)
    })

    it('re-merges when a game gains a wishlist entry (source library -> both)', async () => {
        await seedTwoGames()
        expect(mod.getOne(20).source).toBe('library')

        await writeWishlist({ '20': { priority: 3, date_added: '2026-07-01T00:00:00.000Z' } })
        await reload()
        await refresh()

        expect(mod.getOne(20).source).toBe('both')
        expect(mod.getOne(20).wishlist).toMatchObject({ priority: 3 })
    })

    it('re-merges when the game was renamed in the library', async () => {
        await seedTwoGames()

        await writeLibrary([{ appid: 10, name: 'Renamed Game' }, { appid: 20 }])
        await reload()
        await refresh()

        expect(mod.getOne(10).name).toBe('Renamed Game')
    })

    it('falls back to a full rebuild when the signature file is missing', async () => {
        await seedTwoGames()
        await fs.rm(SIG(), { force: true })

        // Change a file WITHOUT touching mtime forward, so only a full rebuild sees it.
        const p = path.join(STEAM(), 'store', '20.json')
        const { mtime, atime } = await fs.stat(p)
        await writeStore(20, { short_description: 'Rebuilt from scratch' })
        await fs.utimes(p, atime, mtime)      // restore the old mtime

        await refresh()
        expect(mod.getOne(20).store.description).toBe('Rebuilt from scratch')
    })

    it('falls back to a full rebuild when the signature file is corrupt', async () => {
        await seedTwoGames()
        await fs.writeFile(SIG(), '{ not json')

        const p = path.join(STEAM(), 'store', '20.json')
        const { mtime, atime } = await fs.stat(p)
        await writeStore(20, { short_description: 'Recovered' })
        await fs.utimes(p, atime, mtime)

        await refresh()
        expect(mod.getOne(20).store.description).toBe('Recovered')
    })

    it('falls back to a full rebuild when the signature version is unrecognised', async () => {
        await seedTwoGames()
        const sig = JSON.parse(await fs.readFile(SIG(), 'utf8'))
        await writeJson(SIG(), { ...sig, v: 99 })

        const p = path.join(STEAM(), 'store', '20.json')
        const { mtime, atime } = await fs.stat(p)
        await writeStore(20, { short_description: 'Version bumped' })
        await fs.utimes(p, atime, mtime)

        await refresh()
        expect(mod.getOne(20).store.description).toBe('Version bumped')
    })

    // The delta assumes an untouched entry is still correctly shaped. If mergeGame's
    // output changes, that assumption breaks in a way no mtime reveals.
    it('falls back to a full rebuild when the recorded merge shape no longer matches', async () => {
        await seedTwoGames()
        const sig = JSON.parse(await fs.readFile(SIG(), 'utf8'))
        await writeJson(SIG(), { ...sig, shape: 'appid,name,somethingElse' })

        const p = path.join(STEAM(), 'store', '20.json')
        const { mtime, atime } = await fs.stat(p)
        await writeStore(20, { short_description: 'Reshaped' })
        await fs.utimes(p, atime, mtime)

        await refresh()
        expect(mod.getOne(20).store.description).toBe('Reshaped')
    })

    // Preserved from the full-rebuild path: an empty library alongside a non-empty
    // wishlist is a failed read, not a real state, and must not overwrite good data.
    it('keeps the previous index when the library reads empty but a wishlist exists', async () => {
        await seedTwoGames()
        await writeWishlist({ '20': { priority: 1, date_added: '2026-07-01T00:00:00.000Z' } })
        await reload()
        await refresh()

        await writeLibrary([])          // transient failure signature
        await reload()
        await refresh()

        expect(mod.getAll().length).toBeGreaterThan(0)
        expect(mod.getOne(10)).toBeTruthy()
    })

    it('a refresh with nothing changed leaves the index untouched', async () => {
        await seedTwoGames()
        const before = mod.getAll()

        await refresh()
        expect(mod.getAll()).toEqual(before)
    })

    it('persists the merged index so a later boot loads it without re-merging', async () => {
        await seedTwoGames()
        const onDisk = JSON.parse(await fs.readFile(INDEX(), 'utf8'))
        expect(onDisk.index.map((g: { appid: number }) => g.appid).sort((a, b) => a - b)).toEqual([10, 20])
    })
})
