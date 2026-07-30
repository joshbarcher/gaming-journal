// @ts-nocheck — untyped .js service under test.
//
// The delta-rebuild primitive behind the games / wishlist / community-reviews
// refreshes. Its whole justification is that stat is far cheaper than read on the
// NAS (measured: 12,939 files → 363ms to stat, 54.6s to read), so what matters here
// is that the signatures it produces actually change when a file changes, and that
// an unusable baseline reads as null so callers fall back to a full rebuild.

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'

import { createSourceSignatures, shapeOf, shapeRefKey } from '../../../lib/server/relay/shared/source-signatures.js'

let root: string
let sigs: ReturnType<typeof createSourceSignatures>

const dirA = () => path.join(root, 'a')
const dirB = () => path.join(root, 'b')
const file = () => path.join(root, 'sigs.json')

async function write(dir: string, name: string, body = '{}') {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, name), body)
}

async function touch(p: string, secondsAhead = 10) {
    const t = new Date(Date.now() + secondsAhead * 1000)
    await fs.utimes(p, t, t)
}

beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'gj-sigs-'))
    sigs = createSourceSignatures({ name: 'test', file, dirs: () => ({ a: dirA(), b: dirB() }) })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {})
})

describe('source signatures', () => {
    it('produces one signature per key, combining every directory it appears in', async () => {
        await write(dirA(), '10.json')
        await write(dirB(), '10.json')
        await write(dirA(), '20.json')

        const map = await sigs.scan()
        expect([...map.keys()].sort((x, y) => x - y)).toEqual([10, 20])
        expect(map.get(10)).toMatch(/^a:\d+\|b:\d+\|$/)
        expect(map.get(20)).toMatch(/^a:\d+\|$/)
    })

    it('changes a key signature when its file is touched, and leaves others alone', async () => {
        await write(dirA(), '10.json')
        await write(dirA(), '20.json')
        const before = await sigs.scan()

        await touch(path.join(dirA(), '10.json'))
        const after = await sigs.scan()

        expect(after.get(10)).not.toBe(before.get(10))
        expect(after.get(20)).toBe(before.get(20))
    })

    it('ignores non-numeric filenames (index.json and friends live in these dirs)', async () => {
        await write(dirA(), '10.json')
        await write(dirA(), 'index.json')
        await write(dirA(), 'notes.txt')

        expect([...(await sigs.scan()).keys()]).toEqual([10])
    })

    it('skips a directory that does not exist yet (feature never synced)', async () => {
        await write(dirA(), '10.json')
        const map = await sigs.scan()
        expect([...map.keys()]).toEqual([10])
    })

    it('round-trips a baseline through persist/load', async () => {
        await write(dirA(), '10.json')
        const map = await sigs.scan()
        await sigs.persist(map, 'appid,name')

        const loaded = await sigs.load()
        expect(loaded.v).toBe(1)
        expect(loaded.shape).toBe('appid,name')
        expect(loaded.sigs['10']).toBe(map.get(10))
        expect(loaded.builtAt).toBeTruthy()
    })

    // Callers treat null as "no usable baseline → full rebuild", so these must not throw.
    it('load() returns null when the baseline is absent', async () => {
        expect(await sigs.load()).toBeNull()
    })

    it('load() returns null when the baseline is corrupt', async () => {
        await fs.writeFile(file(), '{ truncated')
        expect(await sigs.load()).toBeNull()
    })

    it('load() returns null when the baseline version is unrecognised', async () => {
        await fs.writeFile(file(), JSON.stringify({ v: 99, sigs: { 10: 'a:1|' } }))
        expect(await sigs.load()).toBeNull()
    })

    it('persist() creates the directory and writes atomically (no .tmp left behind)', async () => {
        const nested = createSourceSignatures({
            name: 'nested', file: () => path.join(root, 'deep', 'nested', 'sigs.json'), dirs: () => ({ a: dirA() }),
        })
        await write(dirA(), '10.json')
        await nested.persist(await nested.scan(), 'x')

        expect(await nested.load()).toBeTruthy()
        expect(await fs.readdir(path.join(root, 'deep', 'nested'))).toEqual(['sigs.json'])
    })

    it('persist() does not throw when the target tree is unwritable', async () => {
        const bad = createSourceSignatures({
            name: 'bad', file: () => path.join(root, 'sigs.json', 'cannot', 'nest.json'), dirs: () => ({ a: dirA() }),
        })
        await fs.writeFile(file(), '{}')          // a FILE where a directory is needed
        await expect(bad.persist(new Map(), 'x')).resolves.toBeUndefined()
    })
})

describe('shapeOf', () => {
    it('describes top-level keys and one level of nesting', () => {
        expect(shapeOf({ appid: 1, store: { a: 1, b: 2 }, name: 'x' })).toBe('appid,name,store{a,b}')
    })

    it('is order-insensitive', () => {
        expect(shapeOf({ b: 1, a: 2 })).toBe(shapeOf({ a: 2, b: 1 }))
    })

    // The trap that turned the games delta off: a null block renders differently from
    // a populated one, so shapes must always be sampled from the SAME entry.
    it('renders a null block differently from a populated one', () => {
        expect(shapeOf({ appid: 1, hltb: null })).not.toBe(shapeOf({ appid: 1, hltb: { matched: true } }))
    })

    it('treats arrays as leaves rather than descending into them', () => {
        expect(shapeOf({ tags: ['a', 'b'] })).toBe('tags')
    })

    it('handles a missing entry', () => {
        expect(shapeOf(null)).toBe('')
        expect(shapeOf(undefined)).toBe('')
    })
})

describe('shapeRefKey', () => {
    it('picks the lowest key so both rebuild paths sample the same entry', () => {
        expect(shapeRefKey([70, 10, 30])).toBe(10)
        expect(shapeRefKey(new Set([70, 10, 30]))).toBe(10)
    })

    it('returns null for an empty key set', () => {
        expect(shapeRefKey([])).toBeNull()
    })
})
