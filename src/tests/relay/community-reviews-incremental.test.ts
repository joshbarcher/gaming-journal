// @ts-nocheck — untyped .js service under test.
//
// Incremental community-reviews index. The full scan read all ~3100 per-appid files
// (43s against the NAS — the largest single scan of a cold start) to pick up a
// handful of changes. A row here is a pure function of one file, so there is no
// row-diff to do: mtimes describe it completely.

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'

let tmpDir: string
let mod: typeof import('../../lib/server/relay/community-reviews/community-reviews.service.js')

const DIR = () => path.join(tmpDir, 'relay', 'steam', 'community-reviews')
const SIG = () => path.join(tmpDir, 'relay', 'steam', 'community-reviews-index-sources.json')

async function writeEntry(appid: number, over: Record<string, unknown> = {}) {
    await fs.mkdir(DIR(), { recursive: true })
    await fs.writeFile(path.join(DIR(), `${appid}.json`), JSON.stringify({
        appid, checkedAt: '2026-07-01T00:00:00.000Z', totalReviews: 100,
        reviewCount: 10, summary: 'Positive', reviews: [], ...over,
    }))
}

async function touch(appid: number, secondsAhead = 10) {
    const t = new Date(Date.now() + secondsAhead * 1000)
    await fs.utimes(path.join(DIR(), `${appid}.json`), t, t)
}

function row(appid: number) {
    return mod.getIndex().find(e => e.appid === appid) ?? null
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gj-cr-delta-'))
    process.env.DATA_DIR = tmpDir
    delete process.env.RELAY_DATA_ROOT
    vi.resetModules()
    mod = await import('../../lib/server/relay/community-reviews/community-reviews.service.js')
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }).catch(() => {})
})

describe('community-reviews index — incremental refresh', () => {
    async function seed() {
        await writeEntry(10)
        await writeEntry(20)
        await mod.build()
    }

    it('scans everything on the first refresh and records signatures', async () => {
        await seed()
        expect(mod.getIndex().map(e => e.appid).sort((a, b) => a - b)).toEqual([10, 20])
        const sig = JSON.parse(await fs.readFile(SIG(), 'utf8'))
        expect(Object.keys(sig.sigs).sort()).toEqual(['10', '20'])
    })

    it('re-reads only the entry whose file changed', async () => {
        await seed()
        const untouched = row(20)

        await writeEntry(10, { summary: 'Overwhelmingly Positive', totalReviews: 5000 })
        await touch(10)
        await mod.build()

        expect(row(10)).toMatchObject({ summary: 'Overwhelmingly Positive', totalReviews: 5000 })
        expect(row(20)).toBe(untouched)   // identity: reused, not re-derived
    })

    it('picks up a newly synced game', async () => {
        await seed()
        await writeEntry(30)
        await mod.build()
        expect(mod.getIndex().map(e => e.appid).sort((a, b) => a - b)).toEqual([10, 20, 30])
    })

    it('drops an entry whose file was deleted', async () => {
        await seed()
        await fs.rm(path.join(DIR(), '20.json'))
        await mod.build()
        expect(mod.getIndex().map(e => e.appid)).toEqual([10])
    })

    it('a refresh with nothing changed leaves the index untouched', async () => {
        await seed()
        const before = mod.getIndex()
        await mod.build()
        expect(mod.getIndex()).toEqual(before)
    })

    it('falls back to a full scan when the baseline is missing', async () => {
        await seed()
        await fs.rm(SIG(), { force: true })

        // Change content but restore the old mtime, so only a full scan can see it.
        const p = path.join(DIR(), '20.json')
        const { mtime, atime } = await fs.stat(p)
        await writeEntry(20, { summary: 'Rebuilt' })
        await fs.utimes(p, atime, mtime)

        await mod.build()
        expect(row(20).summary).toBe('Rebuilt')
    })

    it('falls back to a full scan when the baseline is corrupt', async () => {
        await seed()
        await fs.writeFile(SIG(), '{ nope')

        const p = path.join(DIR(), '20.json')
        const { mtime, atime } = await fs.stat(p)
        await writeEntry(20, { summary: 'Recovered' })
        await fs.utimes(p, atime, mtime)

        await mod.build()
        expect(row(20).summary).toBe('Recovered')
    })

    it('falls back to a full scan when the recorded row shape no longer matches', async () => {
        await seed()
        const sig = JSON.parse(await fs.readFile(SIG(), 'utf8'))
        await fs.writeFile(SIG(), JSON.stringify({ ...sig, shape: 'appid,unexpectedField' }))

        const p = path.join(DIR(), '20.json')
        const { mtime, atime } = await fs.stat(p)
        await writeEntry(20, { summary: 'Reshaped' })
        await fs.utimes(p, atime, mtime)

        await mod.build()
        expect(row(20).summary).toBe('Reshaped')
    })

    it('keeps only the index fields, not the full review payload', async () => {
        await seed()
        expect(Object.keys(row(10)).sort()).toEqual(['appid', 'checkedAt', 'reviewCount', 'summary', 'totalReviews'])
    })
})
