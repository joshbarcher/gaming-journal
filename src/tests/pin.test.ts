import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getPin, pinGame, unpinGame, fmtExpiry } from '../lib/js/pin.js'

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
    vi.useRealTimers()
})

// ── getPin ────────────────────────────────────────────────────────────────────

describe('getPin', () => {
    it('returns the pin state on 200', async () => {
        const pin = { appid: 440, name: 'TF2', expiresAt: '2026-07-16T00:00:00Z' }
        fetchMock.mockResolvedValue(jsonRes(pin))
        await expect(getPin()).resolves.toEqual(pin)
        expect(fetchMock).toHaveBeenCalledWith('/relay/api/pin')
    })

    it('returns null on 204 without reading the body', async () => {
        const json = vi.fn(() => Promise.reject(new Error('should not read body')))
        fetchMock.mockResolvedValue({ ok: true, status: 204, json })
        await expect(getPin()).resolves.toBeNull()
        expect(json).not.toHaveBeenCalled()
    })

    it('returns null (not a throw) on a 500', async () => {
        fetchMock.mockResolvedValue(jsonRes({ error: 'x' }, 500))
        await expect(getPin()).resolves.toBeNull()
    })

    it('rejects when a 200 body is not valid JSON (contract: SyntaxError propagates)', async () => {
        fetchMock.mockResolvedValue({
            ok: true, status: 200,
            json: () => Promise.reject(new SyntaxError('Unexpected end of JSON input')),
        })
        await expect(getPin()).rejects.toThrow(SyntaxError)
    })

    it('propagates network rejections (contract: no internal catch)', async () => {
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
        await expect(getPin()).rejects.toThrow('Failed to fetch')
    })
})

// ── pinGame ───────────────────────────────────────────────────────────────────

describe('pinGame', () => {
    it('POSTs the name as a JSON body to /relay/api/pin/<appid>', async () => {
        fetchMock.mockResolvedValue(jsonRes({ appid: 440, name: 'TF2' }))
        await pinGame(440, 'TF2')
        const [url, opts] = fetchMock.mock.calls[0]
        expect(url).toBe('/relay/api/pin/440')
        expect(opts.method).toBe('POST')
        expect(opts.headers['Content-Type']).toBe('application/json')
        expect(opts.body).toBe('{"name":"TF2"}')
    })

    it('preserves unicode and quote characters in the name (JSON-encoded, not string-concatenated)', async () => {
        fetchMock.mockResolvedValue(jsonRes({}))
        await pinGame(1, '"quoted" — ファイナル🎮')
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: '"quoted" — ファイナル🎮' })
    })

    it('returns null on a non-ok response', async () => {
        fetchMock.mockResolvedValue(jsonRes({ error: 'conflict' }, 409))
        await expect(pinGame(440, 'TF2')).resolves.toBeNull()
    })

    it('returns the parsed pin state on success', async () => {
        const pin = { appid: 570, name: 'Dota 2', expiresAt: 'x' }
        fetchMock.mockResolvedValue(jsonRes(pin))
        await expect(pinGame(570, 'Dota 2')).resolves.toEqual(pin)
    })
})

// ── unpinGame ─────────────────────────────────────────────────────────────────

describe('unpinGame', () => {
    it('issues DELETE /relay/api/pin and resolves undefined', async () => {
        fetchMock.mockResolvedValue(jsonRes({}))
        await expect(unpinGame()).resolves.toBeUndefined()
        expect(fetchMock).toHaveBeenCalledWith('/relay/api/pin', { method: 'DELETE' })
    })

    it('ignores a non-ok status (contract: fire and forget)', async () => {
        fetchMock.mockResolvedValue(jsonRes({}, 500))
        await expect(unpinGame()).resolves.toBeUndefined()
    })

    it('rejects on network failure (contract: callers must catch)', async () => {
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
        await expect(unpinGame()).rejects.toThrow('Failed to fetch')
    })
})

// ── fmtExpiry ─────────────────────────────────────────────────────────────────

describe('fmtExpiry', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-07-15T12:00:00Z'))
    })

    function inMinutes(min: number): string {
        return new Date(Date.now() + min * 60_000).toISOString()
    }

    it('returns "soon" for a past expiry', () => {
        expect(fmtExpiry(inMinutes(-5))).toBe('soon')
    })

    it('returns "soon" for an expiry of exactly now', () => {
        expect(fmtExpiry(new Date(Date.now()).toISOString())).toBe('soon')
    })

    it('returns "0m" for under a minute remaining (contract)', () => {
        expect(fmtExpiry(new Date(Date.now() + 30_000).toISOString())).toBe('0m')
    })

    it('returns minutes-only under an hour', () => {
        expect(fmtExpiry(inMinutes(59))).toBe('59m')
    })

    it('returns hours-only on exact hours', () => {
        expect(fmtExpiry(inMinutes(120))).toBe('2h')
    })

    it('returns combined hours and minutes', () => {
        expect(fmtExpiry(inMinutes(90))).toBe('1h 30m')
    })

    it('floors partial minutes (89.9 minutes → 1h 29m)', () => {
        expect(fmtExpiry(new Date(Date.now() + 89.9 * 60_000).toISOString())).toBe('1h 29m')
    })

    // REGRESSION: pin.ts once let an unparseable date make `ms` NaN; `NaN <= 0` is
    // false so the guard was skipped and it returned "NaNh NaNm". Now degrades to "soon".
    it('never renders NaN for an unparseable expiry string', () => {
        expect(fmtExpiry('not-a-date')).toBe('soon')
    })

    // REGRESSION: same root cause via empty string — new Date('').getTime() is NaN;
    // now guarded so no NaN is rendered.
    it('never renders NaN for an empty expiry string', () => {
        expect(fmtExpiry('')).not.toContain('NaN')
    })
})
