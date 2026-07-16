import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setWithTTL, getWithTTL } from '../lib/js/storage.js'

beforeEach(() => {
    localStorage.clear()
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
})

describe('setWithTTL / getWithTTL — roundtrip', () => {
    it('roundtrips an object value before expiry', () => {
        setWithTTL('k', { a: 1, b: 'x' })
        expect(getWithTTL('k')).toEqual({ a: 1, b: 'x' })
    })

    it('roundtrips falsy-but-valid values (0, empty string, false, null)', () => {
        setWithTTL('zero', 0)
        setWithTTL('empty', '')
        setWithTTL('no', false)
        setWithTTL('nil', null)
        expect(getWithTTL('zero', 'fb')).toBe(0)
        expect(getWithTTL('empty', 'fb')).toBe('')
        expect(getWithTTL('no', 'fb')).toBe(false)
        expect(getWithTTL('nil', 'fb')).toBeNull()
    })

    it('roundtrips unicode keys and values', () => {
        setWithTTL('ключ🔑', 'ファイナル 🎮')
        expect(getWithTTL('ключ🔑')).toBe('ファイナル 🎮')
    })

    it('stores the value in the { v, e } envelope with a default 24h TTL', () => {
        vi.useFakeTimers()
        vi.setSystemTime(1_000_000)
        setWithTTL('k', 'v')
        const raw = JSON.parse(localStorage.getItem('k')!)
        expect(raw.v).toBe('v')
        expect(raw.e).toBe(1_000_000 + 24 * 60 * 60 * 1000)
    })
})

describe('getWithTTL — expiry', () => {
    it('returns the value just before the TTL elapses', () => {
        vi.useFakeTimers()
        setWithTTL('k', 'fresh', 1000)
        vi.advanceTimersByTime(999)
        expect(getWithTTL('k', 'fb')).toBe('fresh')
    })

    it('returns the fallback and evicts the key after the TTL elapses', () => {
        vi.useFakeTimers()
        setWithTTL('k', 'stale', 1000)
        vi.advanceTimersByTime(1001)
        expect(getWithTTL('k', 'fb')).toBe('fb')
        expect(localStorage.getItem('k')).toBeNull()
    })

    it('treats exactly-at-expiry as still valid (contract: strict > comparison)', () => {
        vi.useFakeTimers()
        setWithTTL('k', 'edge', 1000)
        vi.advanceTimersByTime(1000)
        expect(getWithTTL('k', 'fb')).toBe('edge')
    })

    it('a non-numeric expiry never expires (contract: NaN comparison is false)', () => {
        localStorage.setItem('k', JSON.stringify({ v: 'immortal', e: 'never' }))
        expect(getWithTTL('k', 'fb')).toBe('immortal')
    })
})

describe('getWithTTL — malformed and legacy data', () => {
    it('returns the fallback for a missing key', () => {
        expect(getWithTTL('missing', 'fb')).toBe('fb')
    })

    it('defaults the fallback to null', () => {
        expect(getWithTTL('missing')).toBeNull()
    })

    it('returns the fallback for malformed JSON', () => {
        localStorage.setItem('k', '{not json')
        expect(getWithTTL('k', 'fb')).toBe('fb')
    })

    it('returns the fallback for the literal string "undefined"', () => {
        localStorage.setItem('k', 'undefined')
        expect(getWithTTL('k', 'fb')).toBe('fb')
    })

    it('returns a legacy plain JSON value as-is (no envelope)', () => {
        localStorage.setItem('k', '42')
        expect(getWithTTL('k', 'fb')).toBe(42)
        localStorage.setItem('l', '{"name":"plain"}')
        expect(getWithTTL('l')).toEqual({ name: 'plain' })
    })

    it('a legacy object that HAPPENS to have v and e keys is treated as an envelope (contract: shape collision)', () => {
        localStorage.setItem('k', JSON.stringify({ v: 'inner', e: Date.now() + 60_000 }))
        // The whole object was the user's value, but the shape check unwraps it.
        expect(getWithTTL('k', 'fb')).toBe('inner')
    })

    // REGRESSION: storage.ts once let JSON.stringify({ v: undefined, e }) drop the
    // `v` key entirely, so the envelope check ('v' in parsed) failed and getWithTTL
    // returned the RAW ENVELOPE { e: <timestamp> } instead of the fallback. Now
    // stored `undefined` degrades to the fallback.
    it('returns the fallback after storing undefined', () => {
        setWithTTL('k', undefined)
        expect(getWithTTL('k', 'fb')).toBe('fb')
    })
})

describe('storage exceptions', () => {
    it('setWithTTL swallows quota-exceeded errors', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('QuotaExceededError')
        })
        expect(() => setWithTTL('k', 'v')).not.toThrow()
    })

    it('getWithTTL returns the fallback when localStorage.getItem throws', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('SecurityError: access denied')
        })
        expect(getWithTTL('k', 'fb')).toBe('fb')
    })

    it('getWithTTL returns the fallback when eviction of an expired key throws', () => {
        vi.useFakeTimers()
        setWithTTL('k', 'v', 1000)
        vi.advanceTimersByTime(2000)
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new Error('nope')
        })
        expect(getWithTTL('k', 'fb')).toBe('fb')
    })

    it('a ttl of 0 expires on the next millisecond, not instantly (contract)', () => {
        vi.useFakeTimers()
        setWithTTL('k', 'v', 0)
        expect(getWithTTL('k', 'fb')).toBe('v') // Date.now() > e is false at the same ms
        vi.advanceTimersByTime(1)
        expect(getWithTTL('k', 'fb')).toBe('fb')
    })
})
