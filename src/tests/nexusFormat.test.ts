import { describe, it, expect } from 'vitest'
import { fmtCompact, fmtSize, nexusThumb, nexusImage, nexusImgError } from '../lib/js/nexusFormat.js'

// ── fmtCompact ────────────────────────────────────────────────────────────────

describe('fmtCompact', () => {
    it('treats null and undefined as 0', () => {
        expect(fmtCompact(null)).toBe('0')
        expect(fmtCompact(undefined)).toBe('0')
    })

    it('passes small numbers through unchanged', () => {
        expect(fmtCompact(0)).toBe('0')
        expect(fmtCompact(999)).toBe('999')
    })

    it('formats thousands with one decimal below 10K', () => {
        expect(fmtCompact(1_000)).toBe('1K')
        expect(fmtCompact(1_500)).toBe('1.5K')
        expect(fmtCompact(9_990)).toBe('10K') // 9.99 → "10.0" → ".0" stripped
    })

    it('formats thousands with no decimals from 10K', () => {
        expect(fmtCompact(10_000)).toBe('10K')
        expect(fmtCompact(494_469)).toBe('494K') // documented example
    })

    it('strips a trailing .0', () => {
        expect(fmtCompact(2_000)).toBe('2K')
        expect(fmtCompact(3_000_000)).toBe('3M')
    })

    it('formats millions with one decimal below 10M', () => {
        expect(fmtCompact(1_000_000)).toBe('1M')
        expect(fmtCompact(2_450_000)).toBe('2.5M') // toFixed rounds
    })

    // BUG: nexusFormat.ts:6 — the function's own doc comment promises
    // 24669741 → "24.7M", but the >= 10M branch uses toFixed(0), producing
    // "25M". Either the comment or the threshold is wrong; the test asserts
    // the documented behavior.
    it('matches its documented example: 24,669,741 → "24.7M"', () => {
        expect(fmtCompact(24_669_741)).toBe('24.7M')
    })

    // BUG: nexusFormat.ts:7 — values just under 1M land in the K branch and
    // toFixed(0) rounds them UP past the unit boundary: 999,999 → "1000K".
    // Correct display is "1M".
    it('rolls over to "1M" instead of "1000K" just below the boundary', () => {
        expect(fmtCompact(999_999)).toBe('1M')
    })

    it('leaves negative numbers unformatted (contract: no thousands branch for negatives)', () => {
        expect(fmtCompact(-1_500)).toBe('-1500')
    })

    it('stringifies NaN as "NaN" (contract: no guard)', () => {
        expect(fmtCompact(Number.NaN)).toBe('NaN')
    })
})

// ── fmtSize ───────────────────────────────────────────────────────────────────

describe('fmtSize', () => {
    it('returns empty string for null, undefined, 0 and negatives', () => {
        expect(fmtSize(null)).toBe('')
        expect(fmtSize(undefined)).toBe('')
        expect(fmtSize(0)).toBe('')
        expect(fmtSize(-5)).toBe('')
    })

    it('formats KB below 1024', () => {
        expect(fmtSize(512)).toBe('512 KB')
        expect(fmtSize(1)).toBe('1 KB')
    })

    it('rounds fractional KB (contract: sub-1KB shows as "0 KB")', () => {
        expect(fmtSize(0.4)).toBe('0 KB')
        expect(fmtSize(0.6)).toBe('1 KB')
    })

    it('formats MB from 1024 KB', () => {
        expect(fmtSize(1_024)).toBe('1 MB')
        expect(fmtSize(2_048)).toBe('2 MB')       // documented example
        expect(fmtSize(164_895)).toBe('161 MB')   // documented example
    })

    it('rounds MB to the nearest integer', () => {
        expect(fmtSize(1_536)).toBe('2 MB') // 1.5 MB rounds up
    })

    it('formats GB from 1 GiB of KB, stripping trailing .0', () => {
        expect(fmtSize(1_048_576)).toBe('1 GB')
        expect(fmtSize(1_572_864)).toBe('1.5 GB')
    })

    // BUG: nexusFormat.ts:15 — same rounding-past-the-boundary class as
    // fmtCompact: 1,048,575 KB (one KB shy of 1 GiB) rounds to "1024 MB"
    // instead of rolling over to "1 GB".
    it('rolls over to "1 GB" instead of "1024 MB" just below the boundary', () => {
        expect(fmtSize(1_048_575)).toBe('1 GB')
    })
})

// ── nexusThumb / nexusImage ───────────────────────────────────────────────────

describe('nexusThumb', () => {
    it('prefers the relay-mirrored local thumb', () => {
        expect(nexusThumb({ localThumb: '/img/t.webp', thumbUrl: 'https://cdn/x.jpg' }))
            .toBe('/relay/img/t.webp')
    })

    it('falls back to thumbUrl then imageUrl', () => {
        expect(nexusThumb({ thumbUrl: 'https://cdn/t.jpg', imageUrl: 'https://cdn/i.jpg' }))
            .toBe('https://cdn/t.jpg')
        expect(nexusThumb({ thumbUrl: null, imageUrl: 'https://cdn/i.jpg' }))
            .toBe('https://cdn/i.jpg')
    })

    it('returns empty string when nothing is available', () => {
        expect(nexusThumb({})).toBe('')
        expect(nexusThumb({ localThumb: null, thumbUrl: null, imageUrl: null })).toBe('')
    })

    it('treats an empty-string localThumb as absent (falsy check)', () => {
        expect(nexusThumb({ localThumb: '', thumbUrl: 'https://cdn/t.jpg' })).toBe('https://cdn/t.jpg')
    })
})

describe('nexusImage', () => {
    it('prefers localImage, then imageLargeUrl, imageUrl, thumbUrl', () => {
        expect(nexusImage({ localImage: '/img/f.webp', imageLargeUrl: 'x' })).toBe('/relay/img/f.webp')
        expect(nexusImage({ imageLargeUrl: 'L', imageUrl: 'I', thumbUrl: 'T' })).toBe('L')
        expect(nexusImage({ imageUrl: 'I', thumbUrl: 'T' })).toBe('I')
        expect(nexusImage({ thumbUrl: 'T' })).toBe('T')
        expect(nexusImage({})).toBe('')
    })
})

// ── nexusImgError ─────────────────────────────────────────────────────────────

function fakeErrorEvent(img: HTMLImageElement): Event {
    return { currentTarget: img } as unknown as Event
}

describe('nexusImgError', () => {
    it('falls back to the CDN url exactly once', () => {
        const img = document.createElement('img')
        nexusImgError(fakeErrorEvent(img), 'https://cdn.example/full.jpg')
        expect(img.src).toBe('https://cdn.example/full.jpg')
        expect(img.dataset.fellBack).toBe('1')
        expect(img.style.visibility).not.toBe('hidden')
    })

    it('hides the image on the second error (CDN also broken)', () => {
        const img = document.createElement('img')
        nexusImgError(fakeErrorEvent(img), 'https://cdn.example/full.jpg')
        nexusImgError(fakeErrorEvent(img), 'https://cdn.example/full.jpg')
        expect(img.style.visibility).toBe('hidden')
        expect(img.src).toBe('https://cdn.example/full.jpg') // not reassigned again
    })

    it('hides immediately when there is no CDN fallback', () => {
        const img = document.createElement('img')
        nexusImgError(fakeErrorEvent(img), null)
        expect(img.style.visibility).toBe('hidden')
        expect(img.dataset.fellBack).toBeUndefined()
    })

    it('treats an empty-string CDN as no fallback', () => {
        const img = document.createElement('img')
        nexusImgError(fakeErrorEvent(img), '')
        expect(img.style.visibility).toBe('hidden')
    })

    it('does not loop when the fallback equals the original src', () => {
        const img = document.createElement('img')
        img.src = 'https://cdn.example/same.jpg'
        nexusImgError(fakeErrorEvent(img), 'https://cdn.example/same.jpg')
        expect(img.dataset.fellBack).toBe('1')
        nexusImgError(fakeErrorEvent(img), 'https://cdn.example/same.jpg')
        expect(img.style.visibility).toBe('hidden')
    })
})
