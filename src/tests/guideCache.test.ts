import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getCachedFulltext, type FtEntry } from '../lib/guide-cache'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ENTRIES: FtEntry[] = [
    { slug: 'p1', label: 'Page 1', text: 'hello world', blockPath: [0] },
    { slug: 'p2', label: 'Page 2', text: 'second entry' },
]

function okFetch(data: unknown = ENTRIES) {
    return vi.fn(async () => ({ ok: true, status: 200, json: async () => data }))
}

function key(steamId = '440', source = 'ign', guideId = 'g1') {
    return `gft:${steamId}:${source}:${guideId}`
}

beforeEach(() => {
    localStorage.clear()
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    localStorage.clear()
})

// ── Basic fetch/caching contract ──────────────────────────────────────────────

describe('getCachedFulltext — fetch and cache', () => {
    it('cache miss fetches and writes the cache keyed by parsedAt', async () => {
        const fetchMock = okFetch()
        vi.stubGlobal('fetch', fetchMock)

        const out = await getCachedFulltext('440', 'ign', 'g1', '2026-01-01')
        expect(out).toEqual(ENTRIES)
        expect(fetchMock).toHaveBeenCalledTimes(1)

        const raw = localStorage.getItem(key())
        expect(raw).not.toBeNull()
        expect(JSON.parse(raw!)).toEqual({ parsedAt: '2026-01-01', entries: ENTRIES })
    })

    it('cache hit returns cached entries without any fetch', async () => {
        localStorage.setItem(key(), JSON.stringify({ parsedAt: 'p1', entries: ENTRIES }))
        const fetchMock = okFetch([{ slug: 'x', label: 'x', text: 'should not be used' }])
        vi.stubGlobal('fetch', fetchMock)

        const out = await getCachedFulltext('440', 'ign', 'g1', 'p1')
        expect(out).toEqual(ENTRIES)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('stale parsedAt invalidates the cache and refetches', async () => {
        localStorage.setItem(key(), JSON.stringify({ parsedAt: 'old', entries: [{ slug: 's', label: 'l', text: 'stale' }] }))
        const fetchMock = okFetch()
        vi.stubGlobal('fetch', fetchMock)

        const out = await getCachedFulltext('440', 'ign', 'g1', 'new')
        expect(out).toEqual(ENTRIES)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(JSON.parse(localStorage.getItem(key())!).parsedAt).toBe('new')
    })

    it('parsedAt null skips the cache entirely — no read, no write', async () => {
        localStorage.setItem(key(), JSON.stringify({ parsedAt: 'p', entries: [{ slug: 's', label: 'l', text: 'cached' }] }))
        const fetchMock = okFetch()
        vi.stubGlobal('fetch', fetchMock)
        const setSpy = vi.spyOn(Storage.prototype, 'setItem')

        const out = await getCachedFulltext('440', 'ign', 'g1', null)
        expect(out).toEqual(ENTRIES)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(setSpy).not.toHaveBeenCalled()
    })

    it('non-ok response returns [] and caches nothing', async () => {
        const fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }))
        vi.stubGlobal('fetch', fetchMock)

        const out = await getCachedFulltext('440', 'ign', 'g1', 'p')
        expect(out).toEqual([])
        expect(localStorage.getItem(key())).toBeNull()
    })

    it('empty entries from the server are returned but never cached', async () => {
        vi.stubGlobal('fetch', okFetch([]))
        const out = await getCachedFulltext('440', 'ign', 'g1', 'p')
        expect(out).toEqual([])
        expect(localStorage.getItem(key())).toBeNull()
    })

    it('network failure propagates to the caller (contract: no internal swallow)', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down') }))
        await expect(getCachedFulltext('440', 'ign', 'g1', 'p')).rejects.toThrow('network down')
    })

    it('invalid JSON body (res.json rejects) propagates to the caller', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true, status: 200, json: async () => { throw new SyntaxError('bad json') },
        })))
        await expect(getCachedFulltext('440', 'ign', 'g1', 'p')).rejects.toThrow('bad json')
    })

    it('non-array JSON from the server is returned verbatim and not cached', async () => {
        vi.stubGlobal('fetch', okFetch({ unexpected: 'shape' }))
        const out = await getCachedFulltext('440', 'ign', 'g1', 'p')
        expect(out).toEqual({ unexpected: 'shape' })
        // .length is undefined → falsy → no cache write
        expect(localStorage.getItem(key())).toBeNull()
    })
})

// ── URL construction ──────────────────────────────────────────────────────────

describe('getCachedFulltext — URL encoding', () => {
    it('encodes guideId (slashes, spaces, plus) via encodeURIComponent', async () => {
        const fetchMock = okFetch()
        vi.stubGlobal('fetch', fetchMock)

        await getCachedFulltext('440', 'gamefaqs', 'faqs/76912 c++', null)
        expect(fetchMock).toHaveBeenCalledWith(
            '/relay/api/guides/440/gamefaqs/faqs%2F76912%20c%2B%2B/fulltext'
        )
    })

    it('steamId and source are NOT encoded (contract: caller passes clean tokens)', async () => {
        const fetchMock = okFetch()
        vi.stubGlobal('fetch', fetchMock)

        await getCachedFulltext('4 40', 'i/gn', 'g', null)
        expect(fetchMock).toHaveBeenCalledWith('/relay/api/guides/4 40/i/gn/g/fulltext')
    })

    it('cache keys with ":" in inputs can collide (contract: raw ":"-joined key)', async () => {
        // ('a', 'b:c', 'd') and ('a:b', 'c', 'd') both produce key "gft:a:b:c:d".
        vi.stubGlobal('fetch', okFetch())
        await getCachedFulltext('a', 'b:c', 'd', 'p')

        const collided = [{ slug: 'z', label: 'z', text: 'from the colliding guide' }]
        vi.stubGlobal('fetch', okFetch(collided))
        const out = await getCachedFulltext('a:b', 'c', 'd', 'p')
        // Same key + same parsedAt → the first guide's entries are served for the second.
        expect(out).toEqual(ENTRIES)
    })
})

// ── Corrupt cache entries ─────────────────────────────────────────────────────

describe('getCachedFulltext — corrupt cache', () => {
    it.each([
        ['malformed JSON',        '{not json'],
        ['JSON null',             'null'],
        ['JSON number',           '42'],
        ['JSON string',           '"hello"'],
        ['object missing fields', '{"parsedAt":"p"}'],
    ])('falls back to fetch when the cached value is %s', async (_desc, raw) => {
        localStorage.setItem(key(), raw)
        const fetchMock = okFetch()
        vi.stubGlobal('fetch', fetchMock)

        const out = await getCachedFulltext('440', 'ign', 'g1', 'p')
        expect(out).toEqual(ENTRIES)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        // and the corrupt entry is overwritten with a good one
        expect(JSON.parse(localStorage.getItem(key())!)).toEqual({ parsedAt: 'p', entries: ENTRIES })
    })

    it('an externally-written empty entries array is served as a cache hit (contract)', async () => {
        localStorage.setItem(key(), JSON.stringify({ parsedAt: 'p', entries: [] }))
        const fetchMock = okFetch()
        vi.stubGlobal('fetch', fetchMock)

        const out = await getCachedFulltext('440', 'ign', 'g1', 'p')
        expect(out).toEqual([])
        expect(fetchMock).not.toHaveBeenCalled()
    })
})

// ── Quota exceeded & eviction ─────────────────────────────────────────────────

describe('getCachedFulltext — quota and eviction', () => {
    it('evicts the oldest gft: entry and retries when setItem throws once', async () => {
        localStorage.setItem('gft:1:s:old',  JSON.stringify({ parsedAt: '2020-01-01', entries: ENTRIES }))
        localStorage.setItem('gft:1:s:mid',  JSON.stringify({ parsedAt: '2023-06-15', entries: ENTRIES }))
        localStorage.setItem('gft:1:s:new',  JSON.stringify({ parsedAt: '2025-12-31', entries: ENTRIES }))
        localStorage.setItem('unrelated',    'keep me')

        vi.stubGlobal('fetch', okFetch())
        const setSpy = vi.spyOn(Storage.prototype, 'setItem')
        setSpy.mockImplementationOnce(() => { throw new DOMException('quota', 'QuotaExceededError') })

        const out = await getCachedFulltext('440', 'ign', 'g1', 'p')
        expect(out).toEqual(ENTRIES)

        // oldest gft entry evicted; other gft entries and unrelated keys intact
        expect(localStorage.getItem('gft:1:s:old')).toBeNull()
        expect(localStorage.getItem('gft:1:s:mid')).not.toBeNull()
        expect(localStorage.getItem('gft:1:s:new')).not.toBeNull()
        expect(localStorage.getItem('unrelated')).toBe('keep me')
        // the retry succeeded
        expect(JSON.parse(localStorage.getItem(key())!).entries).toEqual(ENTRIES)
    })

    it('eviction skips corrupt gft: entries when choosing the oldest', async () => {
        localStorage.setItem('gft:corrupt', '{broken')
        localStorage.setItem('gft:1:s:old', JSON.stringify({ parsedAt: '2019-01-01', entries: [] }))

        vi.stubGlobal('fetch', okFetch())
        vi.spyOn(Storage.prototype, 'setItem')
            .mockImplementationOnce(() => { throw new DOMException('quota', 'QuotaExceededError') })

        await getCachedFulltext('440', 'ign', 'g1', 'p')
        expect(localStorage.getItem('gft:corrupt')).toBe('{broken')
        expect(localStorage.getItem('gft:1:s:old')).toBeNull()
    })

    it('gives up silently and still returns entries when setItem always throws', async () => {
        vi.stubGlobal('fetch', okFetch())
        vi.spyOn(Storage.prototype, 'setItem')
            .mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })

        const out = await getCachedFulltext('440', 'ign', 'g1', 'p')
        expect(out).toEqual(ENTRIES)
        expect(localStorage.getItem(key())).toBeNull()
    })

    it('quota failure with zero gft: entries present does not evict unrelated keys', async () => {
        localStorage.setItem('theme',   'dark')
        localStorage.setItem('gj:pins', '[1,2]')

        vi.stubGlobal('fetch', okFetch())
        vi.spyOn(Storage.prototype, 'setItem')
            .mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })

        await getCachedFulltext('440', 'ign', 'g1', 'p')
        expect(localStorage.getItem('theme')).toBe('dark')
        expect(localStorage.getItem('gj:pins')).toBe('[1,2]')
    })

    it('localStorage.getItem throwing is swallowed and falls back to fetch', async () => {
        const fetchMock = okFetch()
        vi.stubGlobal('fetch', fetchMock)
        vi.spyOn(Storage.prototype, 'getItem')
            .mockImplementation(() => { throw new Error('storage disabled') })

        const out = await getCachedFulltext('440', 'ign', 'g1', 'p')
        expect(out).toEqual(ENTRIES)
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
})

// ── Concurrency ───────────────────────────────────────────────────────────────

describe('getCachedFulltext — concurrency', () => {
    it('concurrent calls for the same key both fetch (contract: no in-flight dedup)', async () => {
        let resolveFirst!: (v: unknown) => void
        const gate = new Promise(r => { resolveFirst = r })
        const fetchMock = vi.fn(async () => {
            await gate
            return { ok: true, status: 200, json: async () => ENTRIES }
        })
        vi.stubGlobal('fetch', fetchMock)

        const p1 = getCachedFulltext('440', 'ign', 'g1', 'p')
        const p2 = getCachedFulltext('440', 'ign', 'g1', 'p')
        expect(fetchMock).toHaveBeenCalledTimes(2)

        resolveFirst(null)
        const [a, b] = await Promise.all([p1, p2])
        expect(a).toEqual(ENTRIES)
        expect(b).toEqual(ENTRIES)
        // last writer wins; cache is consistent
        expect(JSON.parse(localStorage.getItem(key())!)).toEqual({ parsedAt: 'p', entries: ENTRIES })
    })

    it('a call started after the first one completes hits the cache', async () => {
        const fetchMock = okFetch()
        vi.stubGlobal('fetch', fetchMock)

        await getCachedFulltext('440', 'ign', 'g1', 'p')
        await getCachedFulltext('440', 'ign', 'g1', 'p')
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
})
