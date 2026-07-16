import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// $app/navigation only exists inside a SvelteKit build — mock it.
vi.mock('$app/navigation', () => ({ goto: vi.fn() }))

import { goto } from '$app/navigation'
import { navigate, gameBackLabel, gameBackPath, addNewPage } from '../lib/js/router.js'
import { store } from '$lib/sidebar.svelte.js'

const gotoMock = vi.mocked(goto)

let fetchMock: ReturnType<typeof vi.fn>

function jsonRes(body: unknown, status = 200) {
    return {
        ok:     status >= 200 && status < 300,
        status,
        json:   () => Promise.resolve(body),
    }
}

beforeEach(() => {
    document.body.innerHTML = ''
    sessionStorage.clear()
    store.pages = []
    gotoMock.mockReset()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
    // Close any dialog a failed assertion left open.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    vi.unstubAllGlobals()
})

// ── navigate ──────────────────────────────────────────────────────────────────

describe('navigate', () => {
    it('prefixes the path with a slash', () => {
        navigate('library')
        expect(gotoMock).toHaveBeenCalledWith('/library', { replaceState: false })
    })

    it('maps an empty path to the root', () => {
        navigate('')
        expect(gotoMock).toHaveBeenCalledWith('/', { replaceState: false })
    })

    it('passes replace: true through as replaceState', () => {
        navigate('wishlist', { replace: true })
        expect(gotoMock).toHaveBeenCalledWith('/wishlist', { replaceState: true })
    })

    it('keeps multi-segment paths intact', () => {
        navigate('game/440')
        expect(gotoMock).toHaveBeenCalledWith('/game/440', { replaceState: false })
    })

    it('does NOT URL-encode special characters (contract: "#" and "?" reach goto raw)', () => {
        navigate('page#frag')
        expect(gotoMock).toHaveBeenCalledWith('/page#frag', { replaceState: false })
        navigate('a b?x=1')
        expect(gotoMock).toHaveBeenCalledWith('/a b?x=1', { replaceState: false })
    })
})

// ── gameBackLabel / gameBackPath ──────────────────────────────────────────────

describe('gameBackLabel / gameBackPath', () => {
    it('defaults to Library when nothing is stored', () => {
        expect(gameBackLabel()).toBe('Library')
        expect(gameBackPath()).toBe('/library')
    })

    it('maps a known origin to its label and path', () => {
        sessionStorage.setItem('gj_game_from', 'wishlist')
        expect(gameBackLabel()).toBe('Wishlist')
        expect(gameBackPath()).toBe('/wishlist')
    })

    it('maps hyphenated origins', () => {
        sessionStorage.setItem('gj_game_from', 'hall-of-fame')
        expect(gameBackLabel()).toBe('Hall of Fame')
        expect(gameBackPath()).toBe('/hall-of-fame')
    })

    it('falls back to Library for an unknown origin', () => {
        sessionStorage.setItem('gj_game_from', 'not-a-page')
        expect(gameBackLabel()).toBe('Library')
        expect(gameBackPath()).toBe('/library')
    })

    it('falls back to Library for an empty string origin', () => {
        sessionStorage.setItem('gj_game_from', '')
        expect(gameBackLabel()).toBe('Library')
        expect(gameBackPath()).toBe('/library')
    })

    // REGRESSION: FROM_LABELS is a plain object literal, so the lookup once walked the
    // prototype chain — a stored "toString" made FROM_LABELS['toString'] return
    // Object.prototype.toString (a function) instead of a label. Now falls back to "Library".
    it('ignores Object.prototype keys stored as the origin (gameBackLabel)', () => {
        sessionStorage.setItem('gj_game_from', 'toString')
        expect(gameBackLabel()).toBe('Library')
    })

    // REGRESSION: same prototype-chain hole once let "constructor" resolve truthy, so
    // gameBackPath returned "/constructor". Now falls back to "/library".
    it('ignores Object.prototype keys stored as the origin (gameBackPath)', () => {
        sessionStorage.setItem('gj_game_from', 'constructor')
        expect(gameBackPath()).toBe('/library')
    })
})

// ── addNewPage (integration: real dialog DOM + real api + real sidebar store) ─

function fillAndCreate(title: string) {
    const input = document.querySelector<HTMLInputElement>('.dialog-input')!
    input.value = title
    document.querySelector<HTMLButtonElement>('.dialog-btn--create')!.click()
}

describe('addNewPage', () => {
    it('cancelling the dialog neither calls the API nor navigates', async () => {
        const p = addNewPage()
        expect(document.querySelector('.dialog-overlay')).not.toBeNull()
        document.querySelector<HTMLButtonElement>('.dialog-btn--cancel')!.click()
        await p
        expect(fetchMock).not.toHaveBeenCalled()
        expect(gotoMock).not.toHaveBeenCalled()
        expect(store.pages.length).toBe(0)
    })

    it('creates the page, adds it to the sidebar, and navigates to it', async () => {
        const created = { id: 'p9', title: 'Quest Log', type: 'progress' }
        fetchMock.mockResolvedValue(jsonRes(created))
        const p = addNewPage()
        fillAndCreate('Quest Log')
        await p
        const [url, opts] = fetchMock.mock.calls[0]
        expect(url).toBe('/api/pages')
        expect(opts.method).toBe('POST')
        expect(JSON.parse(opts.body)).toEqual({ title: 'Quest Log', type: 'progress' })
        expect(store.pages).toEqual([created])
        expect(gotoMock).toHaveBeenCalledWith('/p9')
    })

    it('shows an error toast (and does not navigate) when the API rejects', async () => {
        fetchMock.mockResolvedValue(jsonRes({ error: 'db is down' }, 500))
        const p = addNewPage()
        fillAndCreate('Doomed')
        await p
        const toast = document.querySelector('.error-toast')
        expect(toast?.textContent).toBe('Failed to create page: db is down')
        expect(gotoMock).not.toHaveBeenCalled()
        expect(store.pages.length).toBe(0)
    })

    it('shows an error toast on a network-level failure', async () => {
        fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
        const p = addNewPage()
        fillAndCreate('Offline')
        await p
        expect(document.querySelector('.error-toast')?.textContent)
            .toBe('Failed to create page: Failed to fetch')
        expect(gotoMock).not.toHaveBeenCalled()
    })

    it('renders a hostile page title as plain text in the toast path (no XSS)', async () => {
        fetchMock.mockResolvedValue(jsonRes({ error: '<img src=x onerror="window.__pwned5=1">' }, 400))
        const p = addNewPage()
        fillAndCreate('anything')
        await p
        expect(document.querySelector('.error-toast img')).toBeNull()
        expect((window as unknown as Record<string, unknown>).__pwned5).toBeUndefined()
    })
})
