import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'

import { getGuideCard, invalidateGuideCard } from '../../../lib/server/relay/home/guide-card.service.js'

// Resolving a guide card walks the game's guides tree: a readdir per source, then a
// stat + two readFiles per guide. That tree lives on the NAS and the home payload
// resolves six games' worth per rebuild, so the result is memoized. These tests pin
// the memo and its invalidation — a stale card here means the landing page shows the
// wrong "most recently used" guide.

function tmpRoot() {
    return path.join(os.tmpdir(), `guide-card-${Date.now()}-${Math.random().toString(36).slice(2)}`)
}

describe('guide card resolution + memo', () => {
    let root: string
    let prevRelayRoot: string | undefined

    /** Lay down guides/<appid>/<source>/<guideId>/_meta.json (+ optional _usage.json). */
    async function writeGuide(appid: number, source: string, guideId: string, meta: unknown, usage?: unknown) {
        const dir = path.join(root, 'guides', String(appid), source, guideId)
        await fsp.mkdir(dir, { recursive: true })
        await fsp.writeFile(path.join(dir, '_meta.json'), JSON.stringify(meta))
        if (usage) await fsp.writeFile(path.join(dir, '_usage.json'), JSON.stringify(usage))
    }

    beforeEach(async () => {
        root = tmpRoot()
        prevRelayRoot = process.env.RELAY_DATA_ROOT
        process.env.RELAY_DATA_ROOT = root
        invalidateGuideCard()   // module-level memo — would otherwise leak between tests
        await fsp.mkdir(root, { recursive: true })
    })

    afterEach(async () => {
        vi.restoreAllMocks()
        if (prevRelayRoot === undefined) delete process.env.RELAY_DATA_ROOT
        else process.env.RELAY_DATA_ROOT = prevRelayRoot
        await fsp.rm(root, { recursive: true, force: true }).catch(() => {})
    })

    it('returns null for a game with no downloaded guides', async () => {
        expect(await getGuideCard(999)).toBeNull()
    })

    it('resolves the guide title, page count and source url', async () => {
        await writeGuide(1, 'ign', 'g1', {
            title: 'Elden Ring Walkthrough by Someone (PC)',
            sourceUrl: 'https://ign.com/wikis/elden-ring',
            pages: [{}, {}, {}],
            coverImages: [],
        })
        const card = await getGuideCard(1)
        expect(card).toMatchObject({ source: 'ign', guideId: 'g1', pageCount: 3, sourceUrl: 'https://ign.com/wikis/elden-ring' })
    })

    it('prefers the most-recently-used guide over a richer one', async () => {
        await writeGuide(2, 'ign', 'older', { title: 'Older', coverImages: [{ src: 'img/a.png', section: 's' }, { src: 'img/b.png', section: 's' }] })
        await writeGuide(2, 'ign', 'used',  { title: 'Used',  coverImages: [] }, { lastUsedAt: new Date().toISOString() })
        expect((await getGuideCard(2))?.guideId).toBe('used')
    })

    it('falls back to the guide with the most cover images when none has been used', async () => {
        await writeGuide(3, 'ign', 'thin',  { title: 'Thin',  coverImages: [] })
        await writeGuide(3, 'ign', 'rich',  { title: 'Rich',  coverImages: [{ src: 'img/a.png', section: 's' }] })
        expect((await getGuideCard(3))?.guideId).toBe('rich')
    })

    // The point of the memo: the second read must not touch the filesystem at all.
    // Proven by deleting the tree — a re-walk would return null.
    it('memoizes a resolved card so the tree is not walked again', async () => {
        await writeGuide(4, 'ign', 'g1', { title: 'Cached', pages: [{}] })
        const first = await getGuideCard(4)
        expect(first?.guideId).toBe('g1')

        await fsp.rm(path.join(root, 'guides', '4'), { recursive: true, force: true })
        expect(await getGuideCard(4)).toEqual(first)
    })

    // "no guides" is the common answer across a large library and still costs a
    // readdir to reach, so misses are cached too.
    it('memoizes the null answer as well', async () => {
        expect(await getGuideCard(5)).toBeNull()

        await writeGuide(5, 'ign', 'late', { title: 'Added Later', pages: [{}] })
        expect(await getGuideCard(5)).toBeNull()   // still the cached miss

        invalidateGuideCard(5)
        expect((await getGuideCard(5))?.guideId).toBe('late')
    })

    it('invalidateGuideCard(appid) re-walks only that game', async () => {
        await writeGuide(6, 'ign', 'six', { title: 'Six', pages: [{}] })
        await writeGuide(7, 'ign', 'seven', { title: 'Seven', pages: [{}] })
        await getGuideCard(6)
        await getGuideCard(7)

        // Change 6 on disk and invalidate only 6.
        await fsp.rm(path.join(root, 'guides', '6'), { recursive: true, force: true })
        await fsp.rm(path.join(root, 'guides', '7'), { recursive: true, force: true })
        invalidateGuideCard(6)

        expect(await getGuideCard(6)).toBeNull()          // re-walked, now gone
        expect((await getGuideCard(7))?.guideId).toBe('seven')  // still memoized
    })

    it('invalidateGuideCard() with no argument clears every game', async () => {
        await writeGuide(8, 'ign', 'eight', { title: 'Eight', pages: [{}] })
        await getGuideCard(8)
        await fsp.rm(path.join(root, 'guides', '8'), { recursive: true, force: true })

        invalidateGuideCard()
        expect(await getGuideCard(8)).toBeNull()
    })

    it('prefers the title from _search.json over the guide meta title', async () => {
        await writeGuide(9, 'ign', 'slug-here', { title: 'Meta Title', pages: [{}] })
        await fsp.writeFile(
            path.join(root, 'guides', '9', '_search.json'),
            JSON.stringify({ sources: { ign: { guides: [{ title: 'Search Title by Author', url: 'https://ign.com/wikis/slug-here' }] } } }),
        )
        expect((await getGuideCard(9))?.title).toBe('Search Title')
    })

    it('skips underscore-prefixed entries (they are metadata, not sources or guides)', async () => {
        await writeGuide(10, 'ign', 'real', { title: 'Real', pages: [{}] })
        await fsp.mkdir(path.join(root, 'guides', '10', '_maps'), { recursive: true })
        expect((await getGuideCard(10))?.guideId).toBe('real')
    })

    it('builds screenshot urls from cover images', async () => {
        await writeGuide(11, 'ign', 'g1', {
            title: 'Shots',
            coverImages: [{ src: 'img/shot one.png', section: 'Chapter 1' }],
        })
        const card = await getGuideCard(11)
        expect(card?.screenshot).toBe('/relay/guides-img/11/ign/g1/Chapter%201/img/shot one.webp')
    })
})
