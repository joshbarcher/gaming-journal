import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
    loadPrefs,
    toggleFilter,
    toggleMute,
    toggleFavorite,
    toggleHighlight,
} from '../lib/js/community-user-prefs.js'

let fetchMock: ReturnType<typeof vi.fn>

function jsonRes(body: unknown, status = 200) {
    return {
        ok:     status >= 200 && status < 300,
        status,
        json:   () => Promise.resolve(body),
    }
}

beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

// ── loadPrefs ─────────────────────────────────────────────────────────────────

describe('loadPrefs', () => {
    it('builds Sets from arrays and scopes highlighted to the given appid', async () => {
        fetchMock.mockResolvedValue(jsonRes({
            filtered:    ['spammer'],
            muted:       ['loud', 'louder'],
            favorited:   ['friend'],
            highlighted: { '440': ['ace'], '570': ['other'] },
        }))
        const prefs = await loadPrefs(440)
        expect(prefs.filtered).toEqual(new Set(['spammer']))
        expect(prefs.muted).toEqual(new Set(['loud', 'louder']))
        expect(prefs.favorited).toEqual(new Set(['friend']))
        expect(prefs.highlighted).toEqual(new Set(['ace']))
        expect(fetchMock).toHaveBeenCalledWith('/api/community-prefs')
    })

    it('accepts a string appid for highlighted lookup (String() normalization)', async () => {
        fetchMock.mockResolvedValue(jsonRes({ highlighted: { '440': ['ace'] } }))
        const prefs = await loadPrefs('440')
        expect(prefs.highlighted).toEqual(new Set(['ace']))
    })

    it('returns empty Sets when every field is missing', async () => {
        fetchMock.mockResolvedValue(jsonRes({}))
        const prefs = await loadPrefs(1)
        expect(prefs.filtered.size).toBe(0)
        expect(prefs.muted.size).toBe(0)
        expect(prefs.favorited.size).toBe(0)
        expect(prefs.highlighted.size).toBe(0)
    })

    it('returns an empty highlighted Set when the appid has no entry', async () => {
        fetchMock.mockResolvedValue(jsonRes({ highlighted: { '570': ['x'] } }))
        const prefs = await loadPrefs(440)
        expect(prefs.highlighted.size).toBe(0)
    })

    it('handles highlighted being null via optional chaining', async () => {
        fetchMock.mockResolvedValue(jsonRes({ highlighted: null }))
        const prefs = await loadPrefs(440)
        expect(prefs.highlighted.size).toBe(0)
    })

    it('deduplicates repeated usernames through Set semantics', async () => {
        fetchMock.mockResolvedValue(jsonRes({ filtered: ['dup', 'dup', 'dup'] }))
        const prefs = await loadPrefs(1)
        expect(prefs.filtered.size).toBe(1)
    })

    it('throws with the status code on a non-ok response', async () => {
        fetchMock.mockResolvedValue(jsonRes({}, 503))
        await expect(loadPrefs(1)).rejects.toThrow('Failed to load community prefs: 503')
    })

    it('rejects when the body is not valid JSON', async () => {
        fetchMock.mockResolvedValue({
            ok: true, status: 200,
            json: () => Promise.reject(new SyntaxError('Unexpected token <')),
        })
        await expect(loadPrefs(1)).rejects.toThrow(SyntaxError)
    })

    // BUG: community-user-prefs.ts:12-17 — the `?? []` guards defend against
    // missing FIELDS but not a null ROOT: a body of JSON `null` throws
    // "TypeError: Cannot read properties of null (reading 'filtered')" instead
    // of degrading to empty sets (or a controlled error).
    it('degrades to empty sets when the body is JSON null', async () => {
        fetchMock.mockResolvedValue(jsonRes(null))
        const prefs = await loadPrefs(1)
        expect(prefs.filtered.size).toBe(0)
    })

    it('propagates network rejections', async () => {
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
        await expect(loadPrefs(1)).rejects.toThrow('Failed to fetch')
    })
})

// ── toggles ───────────────────────────────────────────────────────────────────

describe('toggle helpers', () => {
    it('toggleFilter POSTs { type: "filter", username } without an appid key', async () => {
        fetchMock.mockResolvedValue(jsonRes({ active: true }))
        await expect(toggleFilter('bob')).resolves.toBe(true)
        const [url, opts] = fetchMock.mock.calls[0]
        expect(url).toBe('/api/community-prefs/toggle')
        expect(opts.method).toBe('POST')
        expect(JSON.parse(opts.body)).toEqual({ type: 'filter', username: 'bob' })
    })

    it('toggleMute and toggleFavorite send their own type strings', async () => {
        fetchMock.mockResolvedValue(jsonRes({ active: false }))
        await expect(toggleMute('m')).resolves.toBe(false)
        await expect(toggleFavorite('f')).resolves.toBe(false)
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).type).toBe('mute')
        expect(JSON.parse(fetchMock.mock.calls[1][1].body).type).toBe('favorite')
    })

    it('toggleHighlight stringifies a numeric appid into the body', async () => {
        fetchMock.mockResolvedValue(jsonRes({ active: true }))
        await toggleHighlight(440, 'ace')
        expect(JSON.parse(fetchMock.mock.calls[0][1].body))
            .toEqual({ type: 'highlight', username: 'ace', appid: '440' })
    })

    it('toggleHighlight treats appid 0 as a real appid, not "missing"', async () => {
        fetchMock.mockResolvedValue(jsonRes({ active: true }))
        await toggleHighlight(0, 'ace')
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).appid).toBe('0')
    })

    it('JSON-encodes hostile usernames instead of concatenating them (quotes, unicode)', async () => {
        fetchMock.mockResolvedValue(jsonRes({ active: true }))
        await toggleFilter('"};alert(1);//🎭')
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).username).toBe('"};alert(1);//🎭')
    })

    it('throws with the status on a non-ok toggle response', async () => {
        fetchMock.mockResolvedValue(jsonRes({}, 500))
        await expect(toggleFilter('bob')).rejects.toThrow('community-prefs toggle failed: 500')
    })

    it('returns undefined when the response lacks an active field (contract: no validation)', async () => {
        fetchMock.mockResolvedValue(jsonRes({}))
        await expect(toggleFilter('bob')).resolves.toBeUndefined()
    })

    it('propagates network rejections from toggles', async () => {
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
        await expect(toggleHighlight(1, 'x')).rejects.toThrow('Failed to fetch')
    })
})
