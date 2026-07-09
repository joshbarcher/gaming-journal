import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadGameFilter } from '../lib/js/views/game-filter.js'

const FLAGS = {
    '1': { childLock: true },
    '2': { filtered:  true },
    '3': { software:  true },
    '4': {},                       // normal game
}

function mockFetch(settings: Record<string, boolean>) {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
        if (url === '/api/settings') return Promise.resolve({ ok: true, json: () => Promise.resolve(settings) })
        if (url === '/api/flags')    return Promise.resolve({ ok: true, json: () => Promise.resolve(FLAGS) })
        return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
    }))
}

afterEach(() => vi.unstubAllGlobals())

describe('loadGameFilter / shouldShow', () => {
    it('hides childLock, filtered, and software by default; shows normal games', async () => {
        mockFetch({ showChildLocked: false, showFiltered: false, showSoftware: false })
        const shouldShow = await loadGameFilter()
        expect(shouldShow(1)).toBe(false) // childLock
        expect(shouldShow(2)).toBe(false) // filtered
        expect(shouldShow(3)).toBe(false) // software
        expect(shouldShow(4)).toBe(true)  // normal
    })

    it('reveals childLock only when showChildLocked is on', async () => {
        mockFetch({ showChildLocked: true, showFiltered: false, showSoftware: false })
        const shouldShow = await loadGameFilter()
        expect(shouldShow(1)).toBe(true)
        expect(shouldShow(2)).toBe(false)
        expect(shouldShow(3)).toBe(false)
    })

    it('reveals filtered only when showFiltered is on', async () => {
        mockFetch({ showChildLocked: false, showFiltered: true, showSoftware: false })
        const shouldShow = await loadGameFilter()
        expect(shouldShow(2)).toBe(true)
        expect(shouldShow(1)).toBe(false)
        expect(shouldShow(3)).toBe(false)
    })

    it('reveals software only when showSoftware is on', async () => {
        mockFetch({ showChildLocked: false, showFiltered: false, showSoftware: true })
        const shouldShow = await loadGameFilter()
        expect(shouldShow(3)).toBe(true)
        expect(shouldShow(1)).toBe(false)
        expect(shouldShow(2)).toBe(false)
    })

    it('shows every game when all filters are off (unfiltered)', async () => {
        mockFetch({ showChildLocked: true, showFiltered: true, showSoftware: true })
        const shouldShow = await loadGameFilter()
        expect([1, 2, 3, 4].every(id => shouldShow(id))).toBe(true)
    })

    it('fails open (shows everything) when the fetch throws', async () => {
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network'))))
        const shouldShow = await loadGameFilter()
        expect([1, 2, 3, 4].every(id => shouldShow(id))).toBe(true)
    })
})
