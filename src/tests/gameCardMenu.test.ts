import { describe, it, expect, vi, afterEach, beforeEach, beforeAll } from 'vitest'

vi.mock('$app/navigation', () => ({ goto: vi.fn() }))
vi.mock('../lib/js/sidebar.js', () => ({ refreshAlertsBadge: vi.fn() }))

import { refreshAlertsBadge } from '../lib/js/sidebar.js'
import { onGameCardContextMenu } from '../lib/js/views/game-card-menu.js'
import { GAME_SECTIONS } from '../lib/js/game-sections.js'

beforeAll(() => {
    globalThis.requestAnimationFrame ??=
        ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0)) as unknown as typeof requestAnimationFrame
})

const flush = async () => { await new Promise<void>(r => setTimeout(r, 0)); await new Promise<void>(r => setTimeout(r, 0)) }

const menus       = () => [...document.querySelectorAll<HTMLElement>('.ctx-menu')]
const allItems    = () => [...document.querySelectorAll<HTMLElement>('.ctx-menu-item')]
const itemByLabel = (label: string) => allItems().find(el => el.textContent === label)
const menuLabels  = (menu: HTMLElement) => [...menu.querySelectorAll<HTMLElement>('.ctx-menu-item')].map(el => el.textContent)

// A navigable row renders as a label link + a trailing ⧉ new-tab link inside one .ctx-menu-item.
const navLabel  = (label: string) => [...document.querySelectorAll<HTMLAnchorElement>('a.ctx-menu-nav-label')].find(a => a.textContent === label)
const navNewTab = (label: string) => navLabel(label)?.parentElement?.querySelector<HTMLAnchorElement>('a.ctx-menu-nav-newtab')

// ── fetch harness ─────────────────────────────────────────────────────────────

let flagsRes: Record<string, boolean> | Error
let wlRes: { wishlisted: boolean }
let itadRes: unknown | Error | 'notok'
let guidesRes: unknown | Error
let patchOk: boolean
let wlWriteOk: boolean
const calls: { url: string; method: string; body?: unknown }[] = []

beforeEach(() => {
    flagsRes  = {}
    wlRes     = { wishlisted: false }
    itadRes   = { deals: [] }
    guidesRes = []
    patchOk   = true
    wlWriteOk = true
    calls.length = 0

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET'
        calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined })
        if (url.startsWith('/api/flags/')) {
            if (method === 'PATCH') return { ok: patchOk, status: patchOk ? 200 : 500, json: async () => ({}) }
            if (flagsRes instanceof Error) throw flagsRes
            return { ok: true, status: 200, json: async () => flagsRes }
        }
        if (url.startsWith('/api/local-wishlist/')) {
            if (method !== 'GET') return { ok: wlWriteOk, status: wlWriteOk ? 200 : 500, json: async () => ({}) }
            return { ok: true, status: 200, json: async () => wlRes }
        }
        if (url.startsWith('/relay/api/itad/')) {
            if (itadRes instanceof Error) throw itadRes
            if (itadRes === 'notok') return { ok: false, status: 500, json: async () => null }
            return { ok: true, status: 200, json: async () => itadRes }
        }
        if (url.startsWith('/relay/api/guides/')) {
            if (guidesRes instanceof Error) throw guidesRes
            return { ok: true, status: 200, json: async () => guidesRes }
        }
        return { ok: false, status: 404, json: async () => ({}) }
    }))
    vi.stubGlobal('open', vi.fn())
})

afterEach(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    vi.clearAllMocks()
})

// ── DOM helpers ───────────────────────────────────────────────────────────────

function makeCard(appid: string | null): { card: HTMLElement; inner: HTMLElement } {
    const card = document.createElement('div')
    card.setAttribute('data-game-card', '')
    if (appid !== null) card.dataset.appid = appid
    const inner = document.createElement('span')
    inner.textContent = 'cover art'
    card.appendChild(inner)
    document.body.appendChild(card)
    return { card, inner }
}

function fireCtxMenu(target: Element): MouseEvent {
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })
    target.dispatchEvent(e) // populates e.target the way a real listener would see it
    onGameCardContextMenu(e)
    return e
}

async function openSub(label: string): Promise<void> {
    itemByLabel(label)!.click()
    await flush()
}

// ── Guarding / target resolution ──────────────────────────────────────────────

describe('onGameCardContextMenu — target guarding', () => {
    it('does nothing when the click is not inside a [data-game-card]', () => {
        const plain = document.createElement('div')
        document.body.appendChild(plain)
        const e = fireCtxMenu(plain)
        expect(menus()).toHaveLength(0)
        expect(e.defaultPrevented).toBe(false) // native menu still allowed
    })

    it('does nothing when the card has no data-appid', () => {
        const { inner } = makeCard(null)
        fireCtxMenu(inner)
        expect(menus()).toHaveLength(0)
    })

    it('does nothing when data-appid is not numeric', () => {
        const { inner } = makeCard('not-a-number')
        fireCtxMenu(inner)
        expect(menus()).toHaveLength(0)
    })

    it('treats appid 0 as invalid (contract: falsy appid is rejected)', () => {
        const { inner } = makeCard('0')
        fireCtxMenu(inner)
        expect(menus()).toHaveLength(0)
    })

    it('opens the menu when the event bubbles from a deep child of the card', () => {
        const { inner } = makeCard('570')
        const e = fireCtxMenu(inner)
        expect(menus()).toHaveLength(1)
        expect(e.defaultPrevented).toBe(true)
    })
})

// ── Top-level structure ───────────────────────────────────────────────────────

describe('onGameCardContextMenu — menu structure', () => {
    it('renders the expected top-level items in order', () => {
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        expect(menuLabels(menus()[0])).toEqual([
            'Play status', 'Lists & alerts', 'Visibility',
            'Game info page', 'Steam page', 'ITAD', 'Journal page', 'Community page', 'Game guides',
        ])
        expect(menus()[0].querySelectorAll('.ctx-menu-sep')).toHaveLength(1)
    })

    it('does not fetch any state until a state submenu is opened (lazy load)', () => {
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        expect(calls).toHaveLength(0)
    })
})

// ── Navigation items ──────────────────────────────────────────────────────────

describe('onGameCardContextMenu — navigation', () => {
    it('Steam page opens the store URL in a new tab with noopener', () => {
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        itemByLabel('Steam page')!.click()
        expect(window.open).toHaveBeenCalledWith('https://store.steampowered.com/app/570', '_blank', 'noopener,noreferrer')
        expect(menus()).toHaveLength(0) // menu closed
    })

    it('Journal page is a link to /journal/<appid> with a new-tab affordance', () => {
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        const label = navLabel('Journal page')!
        expect(label.tagName).toBe('A')
        expect(label.getAttribute('href')).toBe('/journal/570')
        const nt = navNewTab('Journal page')!
        expect(nt.getAttribute('href')).toBe('/journal/570')
        expect(nt.getAttribute('target')).toBe('_blank')
        expect(nt.getAttribute('rel')).toBe('noopener noreferrer')
    })

    it('Community page is a link to /community/<appid> with a new-tab affordance', () => {
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        expect(navLabel('Community page')!.getAttribute('href')).toBe('/community/570')
        expect(navNewTab('Community page')!.getAttribute('href')).toBe('/community/570')
        expect(navNewTab('Community page')!.getAttribute('target')).toBe('_blank')
    })

    it('Game info page lists every GAME_SECTIONS entry and links each with the section hash', () => {
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        itemByLabel('Game info page')!.click() // sync submenu — no fetch involved
        const fly = menus()[1]
        expect(menuLabels(fly)).toEqual(GAME_SECTIONS.map(s => s.label))
        expect(navLabel('Trailers')!.getAttribute('href')).toBe('/game/570#game-sec-trailers')
        expect(navNewTab('Trailers')!.getAttribute('href')).toBe('/game/570#game-sec-trailers')
    })

    it('clicking a nav row dismisses the whole menu', async () => {
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        expect(menus()).toHaveLength(1)
        navLabel('Journal page')!.closest<HTMLElement>('.ctx-menu-item')!.click()
        await flush() // dismissal is deferred a frame (rAF)
        expect(menus()).toHaveLength(0)
    })
})

// ── Play status / flags submenus ──────────────────────────────────────────────

describe('onGameCardContextMenu — flag toggles', () => {
    it('Play status shows the five status toggles with fetched state checked', async () => {
        flagsRes = { inProgress: true }
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        await openSub('Play status')
        const fly = menus()[1]
        expect(menuLabels(fly)).toEqual(['Backlog', 'In Progress', 'Completed', 'Dropped', 'Revisit'])
        expect(itemByLabel('In Progress')!.classList.contains('ctx-menu-item--checked')).toBe(true)
        expect(itemByLabel('Backlog')!.classList.contains('ctx-menu-item--checked')).toBe(false)
    })

    it('a failed flags fetch degrades to all-unchecked instead of crashing', async () => {
        flagsRes = new Error('network down')
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        await openSub('Play status')
        const fly = menus()[1]
        expect(fly.querySelectorAll('.ctx-menu-item--checked')).toHaveLength(0)
        expect(menuLabels(fly)).toHaveLength(5)
    })

    it('toggling a status PATCHes the flag and keeps the submenu open', async () => {
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        await openSub('Play status')
        itemByLabel('Backlog')!.click()
        await flush()
        const patch = calls.find(c => c.method === 'PATCH')!
        expect(patch.url).toBe('/api/flags/570')
        expect(patch.body).toEqual({ flag: 'backlog', value: true })
        expect(menus()).toHaveLength(2) // still open for multi-toggling
        expect(itemByLabel('Backlog')!.classList.contains('ctx-menu-item--checked')).toBe(true)
    })

    it('a failed PATCH reverts the checkbox', async () => {
        patchOk = false
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        await openSub('Play status')
        itemByLabel('Backlog')!.click()
        await flush()
        expect(itemByLabel('Backlog')!.classList.contains('ctx-menu-item--checked')).toBe(false)
    })

    it('fetches flag/wishlist state once and reuses it across submenus', async () => {
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        await openSub('Play status')
        await openSub('Lists & alerts')
        await openSub('Visibility')
        expect(calls.filter(c => c.url === '/api/flags/570' && c.method === 'GET')).toHaveLength(1)
        expect(calls.filter(c => c.url === '/api/local-wishlist/570' && c.method === 'GET')).toHaveLength(1)
    })

    it('Visibility shows the three visibility toggles', async () => {
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        await openSub('Visibility')
        expect(menuLabels(menus()[1])).toEqual(['Hide (Child Lock)', 'Filter', 'Software / Tool'])
    })
})

// ── Lists & alerts submenu ────────────────────────────────────────────────────

describe('onGameCardContextMenu — lists & alerts', () => {
    it('shows Favorite / Play List / Wishlist / Sale Alert with wishlist state from the API', async () => {
        wlRes = { wishlisted: true }
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        await openSub('Lists & alerts')
        expect(menuLabels(menus()[1])).toEqual(['Favorite', 'Play List', 'Wishlist', 'Sale Alert'])
        expect(itemByLabel('Wishlist')!.classList.contains('ctx-menu-item--checked')).toBe(true)
    })

    it('turning the wishlist on POSTs, turning it off DELETEs', async () => {
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        await openSub('Lists & alerts')
        itemByLabel('Wishlist')!.click()
        await flush()
        expect(calls.some(c => c.url === '/api/local-wishlist/570' && c.method === 'POST')).toBe(true)
        itemByLabel('Wishlist')!.click()
        await flush()
        expect(calls.some(c => c.url === '/api/local-wishlist/570' && c.method === 'DELETE')).toBe(true)
    })

    it('toggling Sale Alert refreshes the sidebar alerts badge', async () => {
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        await openSub('Lists & alerts')
        itemByLabel('Sale Alert')!.click()
        await flush()
        expect(refreshAlertsBadge).toHaveBeenCalled()
    })

    it('toggling a non-alert flag does not refresh the alerts badge', async () => {
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        await openSub('Lists & alerts')
        itemByLabel('Favorite')!.click()
        await flush()
        expect(refreshAlertsBadge).not.toHaveBeenCalled()
    })
})

// ── ITAD submenu ──────────────────────────────────────────────────────────────

describe('onGameCardContextMenu — ITAD prices', () => {
    it('shows best price first, pulls Steam up second, rest after a separator, hidden stores dropped', async () => {
        itadRes = { deals: [
            { store: 'Fanatical',      price: 5.99, regular: 19.99, cut: 70,  url: 'https://f.example/d' },
            { store: 'GamesPlanet UK', price: 4.99, regular: 19.99, cut: 75,  url: 'https://gp.example/d' },
            { store: 'Steam',          price: 9.99, regular: 19.99, cut: 50,  url: 'https://s.example/d' },
            { store: 'GOG',            price: 0,    regular: 19.99, cut: 100, url: 'https://g.example/d' },
        ] }
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        await openSub('ITAD')
        const fly = menus()[1]
        expect(menuLabels(fly)).toEqual([
            'Best Price: Fanatical — $5.99 (-70%)',
            'Steam — $9.99 (-50%)',
            'GOG — Free (-100%)',
        ])
        expect(fly.querySelectorAll('.ctx-menu-sep')).toHaveLength(1)
        itemByLabel('Best Price: Fanatical — $5.99 (-70%)')!.click()
        expect(window.open).toHaveBeenCalledWith('https://f.example/d', '_blank', 'noopener,noreferrer')
    })

    it('does not duplicate Steam when Steam is already the best price', async () => {
        itadRes = { deals: [
            { store: 'Steam', price: 9.99, regular: 19.99, cut: 50, url: 'u1' },
            { store: 'GOG',   price: 12.5, regular: 19.99, cut: 0,  url: 'u2' },
        ] }
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        await openSub('ITAD')
        const labels = menuLabels(menus()[1])
        expect(labels).toEqual(['Best Price: Steam — $9.99 (-50%)', 'GOG — $12.50'])
        expect(labels.filter(l => l!.includes('Steam'))).toHaveLength(1)
    })

    it('omits the discount suffix when cut is 0 and pads prices to two decimals', async () => {
        itadRes = { deals: [{ store: 'GOG', price: 12.5, regular: 12.5, cut: 0, url: 'u' }] }
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        await openSub('ITAD')
        expect(menuLabels(menus()[1])).toEqual(['Best Price: GOG — $12.50'])
    })

    it('shows the empty state when every deal is from a hidden store', async () => {
        itadRes = { deals: [
            { store: 'GamesPlanet UK', price: 1, regular: 2, cut: 50, url: 'u1' },
            { store: 'GamesPlanet FR', price: 1, regular: 2, cut: 50, url: 'u2' },
            { store: 'GamesPlanet DE', price: 1, regular: 2, cut: 50, url: 'u3' },
        ] }
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        await openSub('ITAD')
        expect(itemByLabel('No price data available')).toBeTruthy()
    })

    it('shows the empty state when the ITAD payload has no deals field', async () => {
        itadRes = {}
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        await openSub('ITAD')
        expect(itemByLabel('No price data available')).toBeTruthy()
    })

    it('shows the empty state on a non-OK response', async () => {
        itadRes = 'notok'
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        await openSub('ITAD')
        expect(itemByLabel('No price data available')).toBeTruthy()
    })

    it('shows the failure state when the fetch throws', async () => {
        itadRes = new Error('relay down')
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        await openSub('ITAD')
        expect(itemByLabel('Failed to load prices')).toBeTruthy()
    })

    it('renders a malicious store name as inert text', async () => {
        itadRes = { deals: [{ store: '<img src=x onerror=alert(1)>', price: 1, regular: 2, cut: 50, url: 'u' }] }
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        await openSub('ITAD')
        expect(document.querySelector('.ctx-menu img')).toBeNull()
        expect(allItems().some(el => el.textContent!.includes('<img src=x onerror=alert(1)>'))).toBe(true)
    })
})

// ── Guides submenu ────────────────────────────────────────────────────────────

describe('onGameCardContextMenu — game guides', () => {
    it('sorts by lastUsedAt desc, then parsedAt desc, and maps source labels', async () => {
        guidesRes = [
            { source: 'gamefaqs', guideId: 'g2', title: 'Old Walkthrough', parsedAt: '2026-06-01T00:00:00Z', lastUsedAt: null },
            { source: 'ign',      guideId: 'g1', title: 'Wiki Guide',      parsedAt: '2026-01-01T00:00:00Z', lastUsedAt: '2026-07-01T00:00:00Z' },
            { source: 'mystery',  guideId: 'g3', title: 'Fan Guide',       parsedAt: '2026-05-01T00:00:00Z', lastUsedAt: null },
        ]
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        await openSub('Game guides')
        expect(menuLabels(menus()[1])).toEqual([
            'IGN — Wiki Guide',          // lastUsedAt wins
            'GameFAQs — Old Walkthrough', // newer parsedAt
            'mystery — Fan Guide',        // unknown source falls back to the raw string
        ])
    })

    it('links each guide to its route with a new-tab affordance', async () => {
        guidesRes = [{ source: 'ign', guideId: 'g1', title: 'Wiki Guide', parsedAt: null, lastUsedAt: null }]
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        await openSub('Game guides')
        expect(navLabel('IGN — Wiki Guide')!.getAttribute('href')).toBe('/journal/570/guides/ign/g1')
        expect(navNewTab('IGN — Wiki Guide')!.getAttribute('href')).toBe('/journal/570/guides/ign/g1')
        expect(navNewTab('IGN — Wiki Guide')!.getAttribute('target')).toBe('_blank')
    })

    it('shows the empty state when no guides are downloaded', async () => {
        guidesRes = []
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        await openSub('Game guides')
        expect(itemByLabel('No guides downloaded')).toBeTruthy()
    })

    it('shows the failure state when the fetch throws', async () => {
        guidesRes = new Error('relay down')
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        await openSub('Game guides')
        expect(itemByLabel('Failed to load guides')).toBeTruthy()
    })

    it('renders a malicious guide title as inert text', async () => {
        guidesRes = [{ source: 'ign', guideId: 'g1', title: '<script>window.__pwn=1</script>', parsedAt: null, lastUsedAt: null }]
        const { inner } = makeCard('570')
        fireCtxMenu(inner)
        await openSub('Game guides')
        expect(document.querySelector('.ctx-menu script')).toBeNull()
        expect((window as any).__pwn).toBeUndefined()
    })
})
