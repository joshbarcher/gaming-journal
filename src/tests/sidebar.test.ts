import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { refreshAlertsBadge, refreshSidebarItem, addPageToSidebar } from '../lib/js/sidebar.js'
import { store } from '$lib/sidebar.svelte.js'
import type { Page } from '$lib/types.js'

let fetchMock: ReturnType<typeof vi.fn>

function jsonRes(body: unknown, status = 200) {
    return {
        ok:     status >= 200 && status < 300,
        status,
        json:   () => Promise.resolve(body),
    }
}

// refreshAlertsBadge is fire-and-forget (returns void) — flush its internal
// promise chain before asserting.
async function flush() {
    await new Promise(r => setTimeout(r, 0))
    await new Promise(r => setTimeout(r, 0))
}

beforeEach(() => {
    store.pages = []
    store.alertsCount = 0
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

// ── refreshAlertsBadge ────────────────────────────────────────────────────────

describe('refreshAlertsBadge', () => {
    it('sets alertsCount from onSale length', async () => {
        fetchMock.mockResolvedValue(jsonRes({ onSale: [{ appid: 1 }, { appid: 2 }, { appid: 3 }] }))
        refreshAlertsBadge()
        await flush()
        expect(fetchMock).toHaveBeenCalledWith('/api/alerts')
        expect(store.alertsCount).toBe(3)
    })

    it('sets alertsCount to 0 when onSale is missing', async () => {
        store.alertsCount = 7
        fetchMock.mockResolvedValue(jsonRes({}))
        refreshAlertsBadge()
        await flush()
        expect(store.alertsCount).toBe(0)
    })

    it('sets alertsCount to 0 when onSale is null', async () => {
        store.alertsCount = 7
        fetchMock.mockResolvedValue(jsonRes({ onSale: null }))
        refreshAlertsBadge()
        await flush()
        expect(store.alertsCount).toBe(0)
    })

    it('leaves the previous count untouched on a non-ok response', async () => {
        store.alertsCount = 5
        fetchMock.mockResolvedValue(jsonRes({ onSale: [] }, 500))
        refreshAlertsBadge()
        await flush()
        expect(store.alertsCount).toBe(5)
    })

    it('leaves the previous count untouched when the body is JSON null', async () => {
        store.alertsCount = 5
        fetchMock.mockResolvedValue(jsonRes(null))
        refreshAlertsBadge()
        await flush()
        expect(store.alertsCount).toBe(5)
    })

    it('swallows network failures without an unhandled rejection', async () => {
        store.alertsCount = 5
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
        expect(() => refreshAlertsBadge()).not.toThrow()
        await flush()
        expect(store.alertsCount).toBe(5)
    })

    it('swallows invalid-JSON bodies via the trailing catch', async () => {
        store.alertsCount = 5
        fetchMock.mockResolvedValue({
            ok: true, status: 200,
            json: () => Promise.reject(new SyntaxError('Unexpected token <')),
        })
        refreshAlertsBadge()
        await flush()
        expect(store.alertsCount).toBe(5)
    })

    it('last-completed call wins on rapid repeated invocation (contract: no de-dupe)', async () => {
        fetchMock
            .mockResolvedValueOnce(jsonRes({ onSale: [{ appid: 1 }] }))
            .mockResolvedValueOnce(jsonRes({ onSale: [{ appid: 1 }, { appid: 2 }] }))
        refreshAlertsBadge()
        refreshAlertsBadge()
        await flush()
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(store.alertsCount).toBe(2)
    })
})

// ── refreshSidebarItem ────────────────────────────────────────────────────────

function page(id: string, title: string): Page {
    return { id, title, type: 'notes' } as unknown as Page
}

describe('refreshSidebarItem', () => {
    it('replaces the matching page in place, preserving order', () => {
        store.pages = [page('a', 'A'), page('b', 'B'), page('c', 'C')]
        refreshSidebarItem(page('b', 'B v2'))
        expect(store.pages.map(p => p.title)).toEqual(['A', 'B v2', 'C'])
    })

    it('is a silent no-op for an unknown id', () => {
        store.pages = [page('a', 'A')]
        expect(() => refreshSidebarItem(page('ghost', 'X'))).not.toThrow()
        expect(store.pages).toHaveLength(1)
        expect(store.pages[0].title).toBe('A')
    })

    it('is a no-op on an empty sidebar', () => {
        expect(() => refreshSidebarItem(page('a', 'A'))).not.toThrow()
        expect(store.pages).toHaveLength(0)
    })

    it('updates only the FIRST match when duplicate ids exist (contract)', () => {
        store.pages = [page('dup', 'first'), page('dup', 'second')]
        refreshSidebarItem(page('dup', 'updated'))
        expect(store.pages.map(p => p.title)).toEqual(['updated', 'second'])
    })
})

// ── addPageToSidebar ──────────────────────────────────────────────────────────

describe('addPageToSidebar', () => {
    it('appends the page to the end', () => {
        store.pages = [page('a', 'A')]
        addPageToSidebar(page('b', 'B'))
        expect(store.pages.map(p => p.id)).toEqual(['a', 'b'])
    })

    // The sidebar renders pages in a keyed {#each} — this codebase has already
    // hit svelte's each_key_duplicate crash. addPageToSidebar does not guard
    // against duplicate ids; this contract test documents that the guard is
    // the CALLER's responsibility.
    it('blindly appends a duplicate id (contract: caller must guarantee uniqueness)', () => {
        store.pages = [page('a', 'A')]
        addPageToSidebar(page('a', 'A again'))
        expect(store.pages).toHaveLength(2)
        expect(store.pages[0].id).toBe(store.pages[1].id)
    })
})
