export interface MenuItem {
    label: string
    action: () => void
    danger?: boolean
}

export type ContextMenuItem = MenuItem | 'separator'

let _active: HTMLElement | null = null

function _remove(): void {
    if (_active) { _active.remove(); _active = null }
}

export function showContextMenu(event: MouseEvent, items: ContextMenuItem[]): void {
    event.preventDefault()
    event.stopPropagation()
    _remove()

    const menu = document.createElement('div')
    menu.className = 'ctx-menu'
    _active = menu

    for (const item of items) {
        if (item === 'separator') {
            const sep = document.createElement('div')
            sep.className = 'ctx-menu-sep'
            menu.appendChild(sep)
            continue
        }
        const btn = document.createElement('button')
        btn.className = 'ctx-menu-item' + (item.danger ? ' ctx-menu-item--danger' : '')
        btn.textContent = item.label
        btn.addEventListener('mousedown', e => e.stopPropagation())
        btn.addEventListener('click', () => { _remove(); item.action() })
        menu.appendChild(btn)
    }

    menu.style.position = 'fixed'
    menu.style.left = `${event.clientX}px`
    menu.style.top = `${event.clientY}px`
    document.body.appendChild(menu)

    requestAnimationFrame(() => {
        const r = menu.getBoundingClientRect()
        if (r.right  > window.innerWidth)  menu.style.left = `${window.innerWidth  - r.width  - 8}px`
        if (r.bottom > window.innerHeight) menu.style.top  = `${window.innerHeight - r.height - 8}px`
    })

    const onDown = (e: MouseEvent) => { if (!menu.contains(e.target as Node)) { _remove(); cleanup() } }
    const onKey  = (e: KeyboardEvent) => { if (e.key === 'Escape') { _remove(); cleanup() } }
    const cleanup = () => {
        document.removeEventListener('mousedown', onDown)
        document.removeEventListener('keydown',   onKey)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown',   onKey)
}
