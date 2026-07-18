export interface MenuItem {
    label:     string
    action?:   (checked?: boolean) => void | Promise<void>
    danger?:   boolean
    disabled?: boolean
    external?: boolean // shows a "opens in new tab" affordance
    href?:     string  // renders the row as a link: the label navigates same-tab, a trailing ⧉ opens a new tab
    checked?:  boolean // when a boolean, renders a toggle with a checkmark; clicking flips it and keeps the menu open
    submenu?:  ContextMenuItem[] | (() => Promise<ContextMenuItem[]>)
}

export type ContextMenuItem = MenuItem | 'separator'

// lucide "external-link" icon — fixed markup, never built from untrusted data
const EXTERNAL_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>`

// lucide "check" icon — fixed markup, shown only when a checkable item is on
const CHECK_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`

function _externalIcon(): Element {
    const wrapper = document.createElement('div')
    wrapper.innerHTML = EXTERNAL_ICON_SVG
    return wrapper.firstElementChild!
}

let _levels: HTMLElement[] = []
let _loadGen = 0

// Detaches the current menu's document-level listeners; set by showContextMenu.
// Owned here so EVERY close path (item selection included) releases them — the
// action-item click handler has no access to showContextMenu's closure.
let _detachDoc: (() => void) | null = null

function _removeAll(): void {
    _levels.forEach(m => m.remove())
    _levels = []
    _detachDoc?.()
    _detachDoc = null
}

// Close every level deeper than `depth` (depth is the index of the menu that
// should remain open).
function _collapseTo(depth: number): void {
    while (_levels.length > depth + 1) _levels.pop()!.remove()
}

function _buildLevel(items: ContextMenuItem[], depth: number): HTMLElement {
    const menu = document.createElement('div')
    menu.className = 'ctx-menu'

    for (const item of items) {
        if (item === 'separator') {
            const sep = document.createElement('div')
            sep.className = 'ctx-menu-sep'
            menu.appendChild(sep)
            continue
        }
        if (item.disabled) {
            const row = document.createElement('div')
            row.className = 'ctx-menu-item ctx-menu-item--disabled'
            row.textContent = item.label
            menu.appendChild(row)
            continue
        }

        // A navigable row: the label is a real link (plain click → SvelteKit same-tab nav;
        // ⌘/Ctrl/Shift/middle-click → native new tab/window) and a trailing ⧉ link always opens
        // a new tab. target="_blank" is the escape hatch SvelteKit's router skips, so the ⧉ needs
        // no custom JS. Dismissal is deferred a frame so detaching the anchor can't cancel the
        // browser's native tab-open. Keeps working for both the label and the ⧉.
        if (item.href) {
            const row = document.createElement('div')
            row.className = 'ctx-menu-item ctx-menu-item--nav'
            row.addEventListener('mousedown', e => e.stopPropagation())
            row.addEventListener('mouseenter', () => _collapseTo(depth))
            const dismiss = () => requestAnimationFrame(() => _removeAll())
            row.addEventListener('click', dismiss)
            row.addEventListener('auxclick', dismiss)

            const label = document.createElement('a')
            label.className = 'ctx-menu-nav-label'
            label.href = item.href
            label.textContent = item.label

            const newTab = document.createElement('a')
            newTab.className = 'ctx-menu-nav-newtab'
            newTab.href = item.href
            newTab.target = '_blank'
            newTab.rel = 'noopener noreferrer'
            newTab.title = 'Open in new tab'
            newTab.setAttribute('aria-label', 'Open in new tab')
            newTab.appendChild(_externalIcon())

            row.appendChild(label)
            row.appendChild(newTab)
            menu.appendChild(row)
            continue
        }

        const isCheckable = typeof item.checked === 'boolean'

        const btn = document.createElement('button')
        btn.className = 'ctx-menu-item'
            + (item.danger ? ' ctx-menu-item--danger' : '')
            + (item.submenu ? ' ctx-menu-item--has-submenu' : '')
            + (item.external ? ' ctx-menu-item--external' : '')
            + (isCheckable ? ' ctx-menu-item--checkable' : '')
            + (isCheckable && item.checked ? ' ctx-menu-item--checked' : '')
        if (isCheckable) {
            const check = document.createElement('span')
            check.className = 'ctx-menu-check'
            check.innerHTML = CHECK_ICON_SVG
            const labelSpan = document.createElement('span')
            labelSpan.textContent = item.label
            btn.appendChild(check)
            btn.appendChild(labelSpan)
        } else if (item.external) {
            const labelSpan = document.createElement('span')
            labelSpan.textContent = item.label
            btn.appendChild(labelSpan)
            btn.appendChild(_externalIcon())
        } else {
            btn.textContent = item.label
        }
        btn.addEventListener('mousedown', e => e.stopPropagation())

        if (item.submenu) {
            let openTimer: ReturnType<typeof setTimeout> | null = null
            btn.addEventListener('mouseenter', () => {
                if (openTimer) clearTimeout(openTimer)
                openTimer = setTimeout(() => _openSubmenu(btn, depth, item.submenu!), 120)
            })
            btn.addEventListener('mouseleave', () => { if (openTimer) clearTimeout(openTimer) })
            btn.addEventListener('click', e => { e.stopPropagation(); _openSubmenu(btn, depth, item.submenu!) })
        } else if (isCheckable) {
            // Toggle in place and keep the menu open so several can be set in one pass.
            btn.addEventListener('mouseenter', () => _collapseTo(depth))
            btn.addEventListener('click', async e => {
                e.stopPropagation()
                const next = !item.checked
                item.checked = next
                btn.classList.toggle('ctx-menu-item--checked', next)
                try {
                    await item.action?.(next)
                } catch {
                    item.checked = !next
                    btn.classList.toggle('ctx-menu-item--checked', !next)
                }
            })
        } else if (item.action) {
            btn.addEventListener('mouseenter', () => _collapseTo(depth))
            btn.addEventListener('click', () => { _removeAll(); item.action!() })
        }
        menu.appendChild(btn)
    }
    return menu
}

function _positionFlyout(menu: HTMLElement, anchorRect: DOMRect): void {
    document.body.appendChild(menu)
    const r = menu.getBoundingClientRect()
    let left = anchorRect.right - 2
    let top  = anchorRect.top - 4
    if (left + r.width > window.innerWidth)  left = anchorRect.left - r.width + 2
    if (top + r.height > window.innerHeight) top  = window.innerHeight - r.height - 8
    menu.style.position = 'fixed'
    menu.style.left = `${Math.max(4, left)}px`
    menu.style.top  = `${Math.max(4, top)}px`
}

function _openSubmenu(
    anchorBtn: HTMLElement,
    parentDepth: number,
    src: ContextMenuItem[] | (() => Promise<ContextMenuItem[]>),
): void {
    _collapseTo(parentDepth)
    const rect = anchorBtn.getBoundingClientRect()

    if (Array.isArray(src)) {
        const menu = _buildLevel(src, parentDepth + 1)
        _positionFlyout(menu, rect)
        _levels.push(menu)
        return
    }

    const loadingMenu = _buildLevel([{ label: 'Loading…', disabled: true }], parentDepth + 1)
    _positionFlyout(loadingMenu, rect)
    _levels.push(loadingMenu)
    const myGen = ++_loadGen

    src().then(resolved => {
        if (myGen !== _loadGen || _levels[parentDepth + 1] !== loadingMenu) return
        const real = _buildLevel(resolved.length ? resolved : [{ label: 'Nothing found', disabled: true }], parentDepth + 1)
        _positionFlyout(real, rect)
        loadingMenu.remove()
        _levels[parentDepth + 1] = real
    }).catch(() => {
        if (myGen !== _loadGen || _levels[parentDepth + 1] !== loadingMenu) return
        const err = _buildLevel([{ label: 'Failed to load', disabled: true }], parentDepth + 1)
        _positionFlyout(err, rect)
        loadingMenu.remove()
        _levels[parentDepth + 1] = err
    })
}

export function showContextMenu(event: MouseEvent, items: ContextMenuItem[]): void {
    event.preventDefault()
    event.stopPropagation()
    _removeAll()
    _loadGen++

    const root = _buildLevel(items, 0)
    root.style.position = 'fixed'
    root.style.left = `${event.clientX}px`
    root.style.top = `${event.clientY}px`
    document.body.appendChild(root)
    _levels = [root]

    requestAnimationFrame(() => {
        const r = root.getBoundingClientRect()
        if (r.right  > window.innerWidth)  root.style.left = `${window.innerWidth  - r.width  - 8}px`
        if (r.bottom > window.innerHeight) root.style.top  = `${window.innerHeight - r.height - 8}px`
    })

    const onDown = (e: MouseEvent) => {
        if (_levels.some(m => m.contains(e.target as Node))) return
        _removeAll()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') _removeAll() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown',   onKey)
    _detachDoc = () => {
        document.removeEventListener('mousedown', onDown)
        document.removeEventListener('keydown',   onKey)
    }
}
