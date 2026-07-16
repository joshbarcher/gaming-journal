import { describe, it, expect } from 'vitest'
import {
    fmtScore,
    fmtTime,
    thumbSrc,
    imgSrc,
    videoSrc,
    countComments,
    flattenComments,
} from '../lib/js/views/community-render.js'
import type { RedditComment, RedditPost } from '../lib/types.js'

const now = () => Math.floor(Date.now() / 1000)
const post = (p: Partial<RedditPost>): RedditPost =>
    ({ id: 'p1', title: 't', score: 0, numComments: 0, createdUtc: 0, ...p }) as RedditPost

// ── fmtScore ──────────────────────────────────────────────────────────────────

describe('fmtScore', () => {
    it('nullish becomes "0"', () => {
        expect(fmtScore(null)).toBe('0')
        expect(fmtScore(undefined)).toBe('0')
    })

    it('thresholds at exactly 1000', () => {
        expect(fmtScore(999)).toBe('999')
        expect(fmtScore(1000)).toBe('1.0k')
        expect(fmtScore(15_540)).toBe('15.5k')
    })

    it('contract: negative (downvoted) scores pass through as plain strings', () => {
        expect(fmtScore(-42)).toBe('-42')
    })
})

// ── fmtTime ───────────────────────────────────────────────────────────────────

describe('fmtTime', () => {
    it('empty string for nullish or zero timestamps', () => {
        expect(fmtTime(null)).toBe('')
        expect(fmtTime(undefined)).toBe('')
        expect(fmtTime(0)).toBe('')
    })

    it('minutes under an hour', () => {
        expect(fmtTime(now() - 125)).toBe('2m ago')
        expect(fmtTime(now() - 5)).toBe('0m ago')
    })

    it('hours under a day', () => {
        expect(fmtTime(now() - 3700)).toBe('1h ago')
        expect(fmtTime(now() - (86_400 - 100))).toBe('23h ago')
    })

    it('days under 30 days', () => {
        expect(fmtTime(now() - 86_400 - 100)).toBe('1d ago')
        expect(fmtTime(now() - 29 * 86_400 - 100)).toBe('29d ago')
    })

    it('falls back to a month + year date at 30 days and beyond', () => {
        const result = fmtTime(now() - 40 * 86_400)
        expect(result).not.toContain('ago')
        const yr = new Date(Date.now() - 40 * 86_400 * 1000).getFullYear()
        expect(result).toContain(String(yr))
    })

    // REGRESSION: community-render.ts — a createdUtc slightly in the future (clock
    // skew) once produced a negative diff that landed in the minutes branch, rendering
    // "-5m ago". Now clamped; this guards against negative relative times returning.
    it('never renders negative relative times for future timestamps (clock skew)', () => {
        const result = fmtTime(now() + 300)
        expect(result.startsWith('-')).toBe(false)
    })
})

// ── thumbSrc / imgSrc / videoSrc ──────────────────────────────────────────────

describe('thumbSrc', () => {
    it('priority: localThumb > localImage > thumbnail > gallery localImage > gallery thumbnail', () => {
        const g = [{ localImage: '/gi.png', thumbnail: 'https://gt.png' }]
        expect(thumbSrc(post({ localThumb: '/t.png', localImage: '/i.png', thumbnail: 'https://x.png', galleryImages: g })))
            .toBe('/relay/t.png')
        expect(thumbSrc(post({ localImage: '/i.png', thumbnail: 'https://x.png', galleryImages: g })))
            .toBe('/relay/i.png')
        expect(thumbSrc(post({ thumbnail: 'https://x.png', galleryImages: g })))
            .toBe('https://x.png')
        expect(thumbSrc(post({ galleryImages: g })))
            .toBe('/relay/gi.png')
        expect(thumbSrc(post({ galleryImages: [{ thumbnail: 'https://gt.png' }] })))
            .toBe('https://gt.png')
    })

    it('returns null for a bare post and for an empty gallery entry', () => {
        expect(thumbSrc(post({}))).toBeNull()
        expect(thumbSrc(post({ galleryImages: [] }))).toBeNull()
        expect(thumbSrc(post({ galleryImages: [{}] }))).toBeNull()
    })

    it('empty-string fields are skipped as missing (falsy), not returned', () => {
        expect(thumbSrc(post({ localThumb: '', thumbnail: 'https://x.png' }))).toBe('https://x.png')
        expect(thumbSrc(post({ thumbnail: '' }))).toBeNull()
    })

    it('contract: Reddit sentinel thumbnails ("self", "default", "nsfw") pass through as-is', () => {
        expect(thumbSrc(post({ thumbnail: 'self' }))).toBe('self')
        expect(thumbSrc(post({ thumbnail: 'nsfw' }))).toBe('nsfw')
    })
})

describe('imgSrc', () => {
    it('priority: localImage > localThumb > thumbnail, with NO gallery fallback (unlike thumbSrc)', () => {
        expect(imgSrc(post({ localImage: '/i.png', localThumb: '/t.png' }))).toBe('/relay/i.png')
        expect(imgSrc(post({ localThumb: '/t.png', thumbnail: 'https://x.png' }))).toBe('/relay/t.png')
        expect(imgSrc(post({ thumbnail: 'https://x.png' }))).toBe('https://x.png')
        expect(imgSrc(post({ galleryImages: [{ localImage: '/gi.png' }] }))).toBeNull()
    })
})

describe('videoSrc', () => {
    it('prefixes /relay or returns null', () => {
        expect(videoSrc(post({ localVideo: '/v.mp4' }))).toBe('/relay/v.mp4')
        expect(videoSrc(post({}))).toBeNull()
        expect(videoSrc(post({ localVideo: '' }))).toBeNull()
    })
})

// ── countComments / flattenComments ───────────────────────────────────────────

const c = (id: string, replies?: RedditComment[]): RedditComment => ({ id, replies })

describe('countComments', () => {
    it('0 for an empty tree, counts nested replies, tolerates missing replies', () => {
        expect(countComments([])).toBe(0)
        expect(countComments([c('a'), c('b', [c('b1'), c('b2', [c('b2a')])])])).toBe(5)
        expect(countComments([{ id: 'x' } as RedditComment])).toBe(1)
    })

    it('survives a very deep (2000-level) reply chain', () => {
        let leaf: RedditComment = c('leaf')
        for (let i = 0; i < 2000; i++) leaf = c(`n${i}`, [leaf])
        expect(countComments([leaf])).toBe(2001)
    })

    it('contract: cyclic reply data blows the stack (no cycle guard)', () => {
        const a = c('a')
        a.replies = [a]
        expect(() => countComments([a])).toThrow(RangeError)
    })
})

describe('flattenComments', () => {
    it('returns [] for empty input', () => {
        expect(flattenComments([])).toEqual([])
    })

    it('flattens depth-first, parents before their replies', () => {
        const tree = [c('a', [c('a1', [c('a1x')]), c('a2')]), c('b')]
        expect(flattenComments(tree).map(x => x.id)).toEqual(['a', 'a1', 'a1x', 'a2', 'b'])
    })

    it('keeps the original comment objects (no cloning)', () => {
        const child = c('child')
        const tree = [c('root', [child])]
        const flat = flattenComments(tree)
        expect(flat[1]).toBe(child)
    })

    it('count and flatten agree on the same tree', () => {
        const tree = [c('a', [c('a1'), c('a2', [c('a2x')])]), c('b')]
        expect(flattenComments(tree)).toHaveLength(countComments(tree))
    })
})
