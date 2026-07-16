import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { showContextMenu, type ContextMenuItem } from '../lib/js/views/context-menu.js'

// jsdom under vitest normally provides rAF; guarantee it so showContextMenu's
// post-layout clamp callback can never crash the suite on a bare environment.
beforeAll(() => {
    globalThis.requestAnimationFrame ??=
        ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0)) as unknown as typeof requestAnimationFrame
})

const flush = () => new Promise<void>(r => setTimeout(r, 0))

function deferred<T>() {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

function openMenu(items: ContextMenuItem[], x = 100, y = 100): MouseEvent {
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y })
    showContextMenu(e, items)
    return e
}

const menus     = () => [...document.querySelectorAll<HTMLElement>('.ctx-menu')]
const allItems  = () => [...document.querySelectorAll<HTMLElement>('.ctx-menu-item')]
const itemByLabel = (label: string) => allItems().find(el => el.textContent === label)

const rect = (o: Partial<DOMRect>): DOMRect =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}), ...o }) as DOMRect

afterEach(() => {
    // Close anything still open; this also fires the module's document-level
    // keydown listeners so their cleanup() runs and they detach themselves.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

// ── Injection safety ──────────────────────────────────────────────────────────

describe('showContextMenu — injection safety', () => {
    const XSS = '<img src=x onerror="window.__pwned=1">'

    it('renders an HTML-looking label as inert text, not markup', () => {
        openMenu([{ label: XSS, action: () => {} }])
        expect(document.querySelector('.ctx-menu img')).toBeNull()
        expect(itemByLabel(XSS)).toBeTruthy()
        expect((window as any).__pwned).toBeUndefined()
    })

    it('renders a disabled item label as inert text', () => {
        openMenu([{ label: XSS, disabled: true }])
        expect(document.querySelector('.ctx-menu img')).toBeNull()
        expect(itemByLabel(XSS)).toBeTruthy()
    })

    it('renders a checkable item label as inert text', () => {
        openMenu([{ label: XSS, checked: true, action: () => {} }])
        expect(document.querySelector('.ctx-menu img')).toBeNull()
    })

    it('renders an external item label as inert text (only the fixed svg icon is markup)', () => {
        openMenu([{ label: XSS, external: true, action: () => {} }])
        expect(document.querySelector('.ctx-menu img')).toBeNull()
        expect(document.querySelectorAll('.ctx-menu svg')).toHaveLength(1) // the external-link icon only
    })

    it('renders a script-tag label as inert text', () => {
        openMenu([{ label: '<script>window.__pwned=2</script>', action: () => {} }])
        expect(document.querySelector('.ctx-menu script')).toBeNull()
        expect((window as any).__pwned).toBeUndefined()
    })
})

// ── Structure ─────────────────────────────────────────────────────────────────

describe('showContextMenu — structure', () => {
    it('opens an empty menu for an empty item list (no crash)', () => {
        openMenu([])
        expect(menus()).toHaveLength(1)
        expect(menus()[0].children).toHaveLength(0)
    })

    it('renders separators as non-interactive divs', () => {
        openMenu(['separator', { label: 'A', action: () => {} }, 'separator'])
        expect(document.querySelectorAll('.ctx-menu-sep')).toHaveLength(2)
        expect(document.querySelector('.ctx-menu-sep')!.tagName).toBe('DIV')
    })

    it('renders a disabled item as a div, and clicking it does nothing', () => {
        const action = vi.fn()
        openMenu([{ label: 'Nope', disabled: true, action }])
        const el = itemByLabel('Nope')!
        expect(el.tagName).toBe('DIV')
        el.click()
        expect(action).not.toHaveBeenCalled()
        expect(menus()).toHaveLength(1) // menu still open
    })

    it('applies the danger modifier class', () => {
        openMenu([{ label: 'Delete', danger: true, action: () => {} }])
        expect(itemByLabel('Delete')!.classList.contains('ctx-menu-item--danger')).toBe(true)
    })

    it('renders duplicate labels as independent items with independent actions', () => {
        const a = vi.fn(); const b = vi.fn()
        openMenu([{ label: 'Dup', action: a }, { label: 'Dup', action: b }])
        allItems()[0].click()
        expect(a).toHaveBeenCalledTimes(1)
        expect(b).not.toHaveBeenCalled()
    })

    it('renders a huge item list without dropping entries', () => {
        const items: ContextMenuItem[] = Array.from({ length: 1000 }, (_, i) => ({ label: `Item ${i}`, action: () => {} }))
        openMenu(items)
        expect(allItems()).toHaveLength(1000)
        expect(itemByLabel('Item 999')).toBeTruthy()
    })
})

// ── Action items ──────────────────────────────────────────────────────────────

describe('showContextMenu — action items', () => {
    it('closes the whole menu before invoking the action', () => {
        let menusAtActionTime = -1
        openMenu([{ label: 'Go', action: () => { menusAtActionTime = menus().length } }])
        itemByLabel('Go')!.click()
        expect(menusAtActionTime).toBe(0)
    })

    it('invokes the action exactly once per click', () => {
        const action = vi.fn()
        openMenu([{ label: 'Go', action }])
        itemByLabel('Go')!.click()
        expect(action).toHaveBeenCalledTimes(1)
    })

    // REGRESSION: context-menu.ts — closing the menu by selecting an action item once
    // ran _removeAll() without cleanup(), leaving the document-level mousedown/keydown
    // listeners attached until some later event fired (a self-healing listener leak).
    // Now cleanup() runs on item selection; this guards the listeners from leaking again.
    it('detaches its document listeners when the menu closes via item selection', () => {
        const removeSpy = vi.spyOn(document, 'removeEventListener')
        openMenu([{ label: 'Go', action: () => {} }])
        itemByLabel('Go')!.click()
        const removed = removeSpy.mock.calls.map(c => c[0])
        expect(removed).toContain('mousedown')
        expect(removed).toContain('keydown')
    })
})

// ── Checkable items ───────────────────────────────────────────────────────────

describe('showContextMenu — checkable items', () => {
    it('toggles on, passes the new value to the action, and keeps the menu open', async () => {
        const action = vi.fn(async () => {})
        const item = { label: 'Flag', checked: false, action }
        openMenu([item])
        const btn = itemByLabel('Flag')!
        btn.click()
        await flush()
        expect(action).toHaveBeenCalledWith(true)
        expect(btn.classList.contains('ctx-menu-item--checked')).toBe(true)
        expect(item.checked).toBe(true)        // caller's object mutated so reopening reflects it
        expect(menus()).toHaveLength(1)        // menu stays open
    })

    it('toggles back off on a second click', async () => {
        const action = vi.fn(async () => {})
        const item = { label: 'Flag', checked: false, action }
        openMenu([item])
        const btn = itemByLabel('Flag')!
        btn.click(); await flush()
        btn.click(); await flush()
        expect(action).toHaveBeenLastCalledWith(false)
        expect(item.checked).toBe(false)
        expect(btn.classList.contains('ctx-menu-item--checked')).toBe(false)
    })

    it('reverts the toggle when the action rejects', async () => {
        const item = { label: 'Flag', checked: false, action: async () => { throw new Error('http 500') } }
        openMenu([item])
        const btn = itemByLabel('Flag')!
        btn.click()
        await flush()
        expect(item.checked).toBe(false)
        expect(btn.classList.contains('ctx-menu-item--checked')).toBe(false)
    })

    it('reverts the toggle when the action throws synchronously', async () => {
        const item = { label: 'Flag', checked: true, action: (() => { throw new Error('boom') }) as any }
        openMenu([item])
        const btn = itemByLabel('Flag')!
        expect(btn.classList.contains('ctx-menu-item--checked')).toBe(true)
        btn.click()
        await flush()
        expect(item.checked).toBe(true) // reverted back to original
        expect(btn.classList.contains('ctx-menu-item--checked')).toBe(true)
    })

    it('checked: true renders the checked class from the start', () => {
        openMenu([{ label: 'On', checked: true, action: () => {} }])
        expect(itemByLabel('On')!.classList.contains('ctx-menu-item--checked')).toBe(true)
    })
})

// ── Positioning ───────────────────────────────────────────────────────────────

describe('showContextMenu — positioning', () => {
    it('places the root menu at the click point', () => {
        openMenu([{ label: 'X', action: () => {} }], 33, 44)
        const root = menus()[0]
        expect(root.style.left).toBe('33px')
        expect(root.style.top).toBe('44px')
        expect(root.style.position).toBe('fixed')
    })

    it('clamps the root menu into the viewport after layout', () => {
        vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => { cb(0); return 1 }) as any)
        vi.spyOn(Element.prototype, 'getBoundingClientRect')
            .mockReturnValue(rect({ right: 2000, bottom: 1000, width: 300, height: 200 }))
        openMenu([{ label: 'X', action: () => {} }], 900, 700)
        const root = menus()[0]
        expect(root.style.left).toBe(`${window.innerWidth - 300 - 8}px`)
        expect(root.style.top).toBe(`${window.innerHeight - 200 - 8}px`)
    })

    it('flips a submenu to the left of its anchor when it would overflow the right edge', () => {
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect({ width: 200, height: 300 }))
        openMenu([{ label: 'Sub', submenu: [{ label: 'Child', action: () => {} }] }])
        const btn = itemByLabel('Sub')!
        ;(btn as any).getBoundingClientRect = () => rect({ left: 800, right: 1000, top: 100 })
        btn.click()
        const fly = menus()[1]
        expect(fly.style.left).toBe('602px') // 800 - 200 + 2
        expect(fly.style.top).toBe('96px')   // 100 - 4
    })

    it('pushes a submenu up when it would overflow the bottom edge', () => {
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect({ width: 100, height: 300 }))
        openMenu([{ label: 'Sub', submenu: [{ label: 'Child', action: () => {} }] }])
        const btn = itemByLabel('Sub')!
        ;(btn as any).getBoundingClientRect = () => rect({ left: 10, right: 110, top: 700 })
        btn.click()
        const fly = menus()[1]
        expect(fly.style.top).toBe(`${window.innerHeight - 300 - 8}px`)
    })

    it('never positions a submenu off the left edge (floors at 4px)', () => {
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect({ width: 200, height: 50 }))
        openMenu([{ label: 'Sub', submenu: [{ label: 'Child', action: () => {} }] }])
        const btn = itemByLabel('Sub')!
        // right-edge overflow forces the leftward flip; anchor.left is too small so the flip goes negative
        ;(btn as any).getBoundingClientRect = () => rect({ left: 50, right: 900, top: 10 })
        btn.click()
        expect(menus()[1].style.left).toBe('4px')
    })
})

// ── Dismissal / lifecycle ─────────────────────────────────────────────────────

describe('showContextMenu — dismissal and lifecycle', () => {
    it('prevents default and stops propagation of the opening event', () => {
        const e = openMenu([{ label: 'X', action: () => {} }])
        expect(e.defaultPrevented).toBe(true)
    })

    it('Escape closes the menu and every open submenu', () => {
        openMenu([{ label: 'Sub', submenu: [{ label: 'Child', action: () => {} }] }])
        itemByLabel('Sub')!.click()
        expect(menus()).toHaveLength(2)
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        expect(menus()).toHaveLength(0)
    })

    it('a non-Escape key does not close the menu', () => {
        openMenu([{ label: 'X', action: () => {} }])
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
        expect(menus()).toHaveLength(1)
    })

    it('mousedown outside closes the menu', () => {
        openMenu([{ label: 'X', action: () => {} }])
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        expect(menus()).toHaveLength(0)
    })

    it('mousedown inside the menu container does not close it', () => {
        openMenu([{ label: 'X', action: () => {} }])
        menus()[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        expect(menus()).toHaveLength(1)
    })

    it('mousedown on an item button does not close the menu (stopPropagation)', () => {
        openMenu([{ label: 'X', action: () => {} }])
        itemByLabel('X')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        expect(menus()).toHaveLength(1)
    })

    it('mousedown inside an open submenu does not close anything', () => {
        openMenu([{ label: 'Sub', submenu: [{ label: 'Child', action: () => {} }] }])
        itemByLabel('Sub')!.click()
        menus()[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
        expect(menus()).toHaveLength(2)
    })

    it('opening a second context menu replaces the first entirely', () => {
        openMenu([{ label: 'First', action: () => {} }])
        openMenu([{ label: 'Second', action: () => {} }])
        expect(menus()).toHaveLength(1)
        expect(itemByLabel('First')).toBeUndefined()
        expect(itemByLabel('Second')).toBeTruthy()
    })

    it('rapid open/close cycles leave exactly zero or one menu (no orphans)', () => {
        for (let i = 0; i < 10; i++) {
            openMenu([{ label: `M${i}`, action: () => {} }])
            if (i % 2 === 0) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        }
        expect(menus().length).toBeLessThanOrEqual(1)
        // the survivor must be the most recent one
        if (menus().length === 1) expect(itemByLabel('M9')).toBeTruthy()
    })
})

// ── Submenus (sync) ───────────────────────────────────────────────────────────

describe('showContextMenu — sync submenus', () => {
    it('click opens a submenu immediately', () => {
        openMenu([{ label: 'Sub', submenu: [{ label: 'Child', action: () => {} }] }])
        itemByLabel('Sub')!.click()
        expect(menus()).toHaveLength(2)
        expect(itemByLabel('Child')).toBeTruthy()
    })

    it('clicking the same submenu parent twice does not stack duplicate flyouts', () => {
        openMenu([{ label: 'Sub', submenu: [{ label: 'Child', action: () => {} }] }])
        itemByLabel('Sub')!.click()
        allItems().find(el => el.textContent === 'Sub')!.click()
        expect(menus()).toHaveLength(2)
        expect(allItems().filter(el => el.textContent === 'Child')).toHaveLength(1)
    })

    it('hovering a plain sibling item collapses an open submenu', () => {
        openMenu([
            { label: 'Sub', submenu: [{ label: 'Child', action: () => {} }] },
            { label: 'Plain', action: () => {} },
        ])
        itemByLabel('Sub')!.click()
        expect(menus()).toHaveLength(2)
        itemByLabel('Plain')!.dispatchEvent(new MouseEvent('mouseenter'))
        expect(menus()).toHaveLength(1)
    })

    it('opens on hover only after the 120ms delay', () => {
        vi.useFakeTimers()
        openMenu([{ label: 'Sub', submenu: [{ label: 'Child', action: () => {} }] }])
        itemByLabel('Sub')!.dispatchEvent(new MouseEvent('mouseenter'))
        vi.advanceTimersByTime(119)
        expect(menus()).toHaveLength(1)
        vi.advanceTimersByTime(1)
        expect(menus()).toHaveLength(2)
    })

    it('leaving the item before the hover delay cancels the open', () => {
        vi.useFakeTimers()
        openMenu([{ label: 'Sub', submenu: [{ label: 'Child', action: () => {} }] }])
        const btn = itemByLabel('Sub')!
        btn.dispatchEvent(new MouseEvent('mouseenter'))
        vi.advanceTimersByTime(60)
        btn.dispatchEvent(new MouseEvent('mouseleave'))
        vi.advanceTimersByTime(1000)
        expect(menus()).toHaveLength(1)
    })

    it('rapid re-hovers restart the timer and open only one submenu', () => {
        vi.useFakeTimers()
        openMenu([{ label: 'Sub', submenu: [{ label: 'Child', action: () => {} }] }])
        const btn = itemByLabel('Sub')!
        btn.dispatchEvent(new MouseEvent('mouseenter'))
        vi.advanceTimersByTime(60)
        btn.dispatchEvent(new MouseEvent('mouseenter'))
        vi.advanceTimersByTime(119)
        expect(menus()).toHaveLength(1) // restarted timer hasn't elapsed
        vi.advanceTimersByTime(1)
        expect(menus()).toHaveLength(2)
        expect(allItems().filter(el => el.textContent === 'Child')).toHaveLength(1)
    })
})

// ── Submenus (async) ──────────────────────────────────────────────────────────

describe('showContextMenu — async submenus', () => {
    it('shows a disabled Loading… placeholder while the promise is pending', () => {
        const d = deferred<ContextMenuItem[]>()
        openMenu([{ label: 'Sub', submenu: () => d.promise }])
        itemByLabel('Sub')!.click()
        const loading = itemByLabel('Loading…')!
        expect(loading).toBeTruthy()
        expect(loading.classList.contains('ctx-menu-item--disabled')).toBe(true)
    })

    it('replaces the placeholder with the resolved items', async () => {
        const d = deferred<ContextMenuItem[]>()
        openMenu([{ label: 'Sub', submenu: () => d.promise }])
        itemByLabel('Sub')!.click()
        d.resolve([{ label: 'Loaded child', action: () => {} }])
        await flush()
        expect(itemByLabel('Loading…')).toBeUndefined()
        expect(itemByLabel('Loaded child')).toBeTruthy()
        expect(menus()).toHaveLength(2)
    })

    it('shows "Nothing found" when the promise resolves empty', async () => {
        const d = deferred<ContextMenuItem[]>()
        openMenu([{ label: 'Sub', submenu: () => d.promise }])
        itemByLabel('Sub')!.click()
        d.resolve([])
        await flush()
        expect(itemByLabel('Nothing found')).toBeTruthy()
    })

    it('shows "Failed to load" when the promise rejects', async () => {
        const d = deferred<ContextMenuItem[]>()
        openMenu([{ label: 'Sub', submenu: () => d.promise }])
        itemByLabel('Sub')!.click()
        d.reject(new Error('network'))
        await flush()
        expect(itemByLabel('Failed to load')).toBeTruthy()
    })

    it('a load that resolves after Escape closed the menu does not resurrect anything', async () => {
        const d = deferred<ContextMenuItem[]>()
        openMenu([{ label: 'Sub', submenu: () => d.promise }])
        itemByLabel('Sub')!.click()
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        expect(menus()).toHaveLength(0)
        d.resolve([{ label: 'Zombie', action: () => {} }])
        await flush()
        expect(menus()).toHaveLength(0)
        expect(itemByLabel('Zombie')).toBeUndefined()
    })

    it('a stale load cannot inject items into a newer context menu', async () => {
        const d = deferred<ContextMenuItem[]>()
        openMenu([{ label: 'Old', submenu: () => d.promise }])
        itemByLabel('Old')!.click()
        openMenu([{ label: 'New', action: () => {} }]) // replaces menu, bumps generation
        d.resolve([{ label: 'Stale child', action: () => {} }])
        await flush()
        expect(menus()).toHaveLength(1)
        expect(itemByLabel('Stale child')).toBeUndefined()
    })

    it('a slower first submenu load cannot clobber a faster sibling load', async () => {
        const dA = deferred<ContextMenuItem[]>()
        const dB = deferred<ContextMenuItem[]>()
        openMenu([
            { label: 'A', submenu: () => dA.promise },
            { label: 'B', submenu: () => dB.promise },
        ])
        itemByLabel('A')!.click()
        itemByLabel('B')!.click() // collapses A's pending flyout, opens B's
        dB.resolve([{ label: 'B child', action: () => {} }])
        await flush()
        dA.resolve([{ label: 'A child', action: () => {} }])
        await flush()
        expect(itemByLabel('B child')).toBeTruthy()
        expect(itemByLabel('A child')).toBeUndefined()
        expect(menus()).toHaveLength(2)
    })
})
