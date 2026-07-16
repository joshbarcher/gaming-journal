// Adversarial tests for src/lib/adult-content.svelte.ts
//
// Singleton rune store mirroring the server's `hideAdultContent` setting.
// Focus: fetch failures, malformed payloads, and out-of-order concurrent loads.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { adultContent } from '$lib/adult-content.svelte.js'

function deferred<T>() {
    let resolve!: (v: T) => void
    let reject!:  (e: unknown) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

function jsonResponse(body: unknown, ok = true, status = 200) {
    return { ok, status, json: () => Promise.resolve(body) } as unknown as Response
}

beforeEach(() => {
    // Singleton — reset to the documented default between tests.
    adultContent.hide = true
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('adultContent store', () => {
    it('defaults to hiding (safe direction)', () => {
        expect(adultContent.hide).toBe(true)
    })

    it('unblurs only after the server confirms the toggle is off', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ hideAdultContent: false })))
        await adultContent.load()
        expect(adultContent.hide).toBe(false)
    })

    it('re-hides when the server says hideAdultContent: true', async () => {
        adultContent.hide = false
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ hideAdultContent: true })))
        await adultContent.load()
        expect(adultContent.hide).toBe(true)
    })

    it('missing hideAdultContent key falls back to true (hide)', async () => {
        adultContent.hide = false
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})))
        await adultContent.load()
        expect(adultContent.hide).toBe(true)
    })

    it('null hideAdultContent falls back to true via ??', async () => {
        adultContent.hide = false
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ hideAdultContent: null })))
        await adultContent.load()
        expect(adultContent.hide).toBe(true)
    })

    it('CONTRACT: non-boolean truthy/falsy values pass through raw (?? only catches null/undefined)', async () => {
        // A corrupted settings file returning 0 leaves hide === 0, not false.
        // Downstream blur checks are truthiness-based so this behaves as "show",
        // which is the dangerous direction — documented as actual behavior.
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ hideAdultContent: 0 })))
        await adultContent.load()
        expect(adultContent.hide as unknown).toBe(0)
    })

    it('HTTP error response keeps the last known value', async () => {
        adultContent.hide = false
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ hideAdultContent: true }, false, 500)))
        await adultContent.load()
        expect(adultContent.hide).toBe(false)
    })

    it('network failure keeps the last known value and does not throw', async () => {
        adultContent.hide = false
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')))
        await expect(adultContent.load()).resolves.toBeUndefined()
        expect(adultContent.hide).toBe(false)
    })

    it('malformed JSON body keeps the last known value and does not throw', async () => {
        adultContent.hide = false
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok:   true,
            json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
        } as unknown as Response))
        await expect(adultContent.load()).resolves.toBeUndefined()
        expect(adultContent.hide).toBe(false)
    })

    it('survives a rapid burst of load() calls resolving in order', async () => {
        let n = 0
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
            n++
            return Promise.resolve(jsonResponse({ hideAdultContent: n % 2 === 0 }))
        }))
        await Promise.all([adultContent.load(), adultContent.load(), adultContent.load(), adultContent.load()])
        // Four sequentially-resolving responses; the 4th (n=4 → hide=true) lands last.
        expect(adultContent.hide).toBe(true)
    })

    // REGRESSION: adult-content.svelte.ts load() once had no in-flight superseding, so
    // two concurrent load() calls applied whichever RESPONSE arrived last rather than the
    // latest CALL — a slow stale response could clobber a fresher one (e.g. Settings
    // toggles the flag while a mount-time load is still in flight). Now guarded.
    it('a slow stale response must not clobber the result of a later load() (regression)', async () => {
        const slow = deferred<Response>()
        const fast = deferred<Response>()
        const fetchMock = vi.fn()
            .mockReturnValueOnce(slow.promise)   // first call: stale, resolves LAST
            .mockReturnValueOnce(fast.promise)   // second call: fresh, resolves FIRST
        vi.stubGlobal('fetch', fetchMock)

        const p1 = adultContent.load()
        const p2 = adultContent.load()

        fast.resolve(jsonResponse({ hideAdultContent: true }))
        await p2
        expect(adultContent.hide).toBe(true)

        slow.resolve(jsonResponse({ hideAdultContent: false }))
        await p1
        // Correct behavior: the later call's value (true) wins.
        expect(adultContent.hide).toBe(true)
    })
})
