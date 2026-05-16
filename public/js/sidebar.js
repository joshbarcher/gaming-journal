import { api } from './api.js'
import { escapeHtml, progressPercent } from './utils.js'
import { confirmDialog, showError } from './dialog.js'
import { percentToColor } from './views/progress-helpers.js'

let _pages = []
let _onNavigate = null
let _activeId = null

export function getPages() {
    return _pages
}

export async function loadSidebar(activeId, onNavigate) {
    _onNavigate = onNavigate
    _activeId = activeId
    _pages = await api.pages.list()
    renderSidebar(activeId)
}

export function addPageToSidebar(page) {
    _pages.push(page)
    const nav = document.getElementById('sidebar-nav')
    const emptyEl = nav.querySelector('.sidebar-empty')
    if (emptyEl) emptyEl.remove()
    nav.appendChild(buildItem(page, false))
}

export function refreshSidebarItem(updatedPage) {
    const idx = _pages.findIndex(p => p.id === updatedPage.id)
    if (idx !== -1) _pages[idx] = updatedPage
    const el = document.querySelector(`.sidebar-item[data-id="${updatedPage.id}"]`)
    if (!el) return
    const isActive = el.classList.contains('active')
    el.replaceWith(buildItem(updatedPage, isActive))
}

export function setActiveItem(id) {
    _activeId = id
    document.querySelectorAll('.sidebar-item, .sidebar-toc-btn, .sidebar-home-btn, .sidebar-library-btn').forEach(el => {
        const elId = el.dataset.id
        el.classList.toggle('active', elId === id)
    })
    if (id !== 'toc' && id !== 'home') {
        const page = _pages.find(p => p.id === id)
        if (page) refreshSidebarItem(page)
    }
}

function renderSidebar(activeId) {
    const nav = document.getElementById('sidebar-nav')
    nav.innerHTML = ''

    nav.appendChild(buildHomeButton(activeId === 'home'))
    nav.appendChild(buildTocButton(activeId === 'toc'))
    nav.appendChild(buildLibraryButton(activeId === 'library'))

    if (_pages.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'sidebar-empty'
        empty.textContent = 'No pages yet'
        nav.appendChild(empty)
        return
    }

    for (const page of _pages) {
        nav.appendChild(buildItem(page, page.id === activeId))
    }
}

function buildHomeButton(isActive) {
    const el = document.createElement('div')
    el.className = 'sidebar-home-btn' + (isActive ? ' active' : '')
    el.dataset.id = 'home'
    el.tabIndex = 0
    el.innerHTML = `<span class="sidebar-toc-icon">⌂</span> Journal`
    el.addEventListener('click', () => _onNavigate(''))
    el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _onNavigate('') }
        _arrowNav(e)
    })
    return el
}

function buildLibraryButton(isActive) {
    const el = document.createElement('div')
    el.className = 'sidebar-library-btn' + (isActive ? ' active' : '')
    el.dataset.id = 'library'
    el.tabIndex = 0
    el.innerHTML = `<span class="sidebar-toc-icon">&#9881;</span> Steam Library`
    el.addEventListener('click', () => _onNavigate('library'))
    el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _onNavigate('library') }
        _arrowNav(e)
    })
    return el
}

function buildTocButton(isActive) {
    const el = document.createElement('div')
    el.className = 'sidebar-toc-btn' + (isActive ? ' active' : '')
    el.dataset.id = 'toc'
    el.tabIndex = 0
    el.innerHTML = `<span class="sidebar-toc-icon">&#9776;</span> Table of Contents`
    el.addEventListener('click', () => _onNavigate('toc'))
    el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _onNavigate('toc') }
        _arrowNav(e)
    })
    return el
}

function buildItem(page, isActive) {
    const el = document.createElement('div')
    el.className = 'sidebar-item' + (isActive ? ' active' : '')
    el.dataset.id = page.id
    el.draggable = true
    el.tabIndex = 0
    el.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); _onNavigate(page.id) }
        _arrowNav(e)
    })

    const handle = document.createElement('span')
    handle.className = 'sidebar-drag-handle'
    handle.textContent = '⠿'
    handle.title = 'Drag to reorder'
    el.appendChild(handle)

    const content = document.createElement('div')
    content.className = 'sidebar-item-content'
    el.appendChild(content)

    if (page.type === 'list') {
        const items = page.items ?? []
        const done  = items.filter(i => i.done).length
        const pct   = items.length ? Math.round((done / items.length) * 100) : 0
        content.innerHTML = `
            <span class="sidebar-item-title">${escapeHtml(page.title)}</span>
            <div class="sidebar-progress-track">
                <div class="sidebar-progress-fill" style="width:${pct}%;background:${percentToColor(pct)}"></div>
            </div>`
    } else if (page.type === 'progress' || page.type === 'progress-bars') {
        const pct = progressPercent(page)
        content.innerHTML = `
            <span class="sidebar-item-title">${escapeHtml(page.title)}</span>
            <div class="sidebar-progress-track">
                <div class="sidebar-progress-fill" style="width:${pct}%;background:${percentToColor(pct)}"></div>
            </div>`
    } else if (page.type === 'notes') {
        const count = page.notes?.length ?? 0
        content.innerHTML = `
            <div class="sidebar-item-row">
                <span class="sidebar-item-title">${escapeHtml(page.title)}</span>
                ${count > 0 ? `<span class="sidebar-badge">${count}</span>` : ''}
            </div>`
    } else {
        content.innerHTML = `
            <div class="sidebar-item-row">
                <span class="sidebar-item-title">${escapeHtml(page.title)}</span>
            </div>`
    }

    content.addEventListener('click', () => _onNavigate(page.id))

    const dupBtn = document.createElement('button')
    dupBtn.className = 'sidebar-item-dup'
    dupBtn.textContent = '⧉'
    dupBtn.title = 'Duplicate page'
    dupBtn.addEventListener('click', async (e) => {
        e.stopPropagation()
        try {
            const { id: _id, createdAt: _c, updatedAt: _u, ...data } = page
            const copy = await api.pages.create({ ...data, title: `${page.title} (copy)` })
            const idx = _pages.findIndex(p => p.id === page.id)
            _pages.splice(idx + 1, 0, copy)
            el.after(buildItem(copy, false))
            _onNavigate(copy.id)
        } catch (err) {
            showError(`Failed to duplicate: ${err.message}`)
        }
    })
    el.appendChild(dupBtn)

    const delBtn = document.createElement('button')
    delBtn.className = 'sidebar-item-delete'
    delBtn.textContent = '×'
    delBtn.title = 'Delete page'
    delBtn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const confirmed = await confirmDialog(`Delete "${page.title}"?`, 'This will permanently remove this page.', 'Delete')
        if (!confirmed) return
        try {
            await api.pages.remove(page.id)
            _pages = _pages.filter(p => p.id !== page.id)
            el.remove()
            if (_activeId === page.id) _onNavigate('toc')
        } catch (err) {
            showError(`Failed to delete: ${err.message}`)
        }
    })
    el.appendChild(delBtn)

    _attachDrag(el)
    return el
}

// ── Drag-to-reorder ───────────────────────────────────────────────────────────

let _dragSrc = null

function _attachDrag(el) {
    el.addEventListener('dragstart', (e) => {
        _dragSrc = el
        el.classList.add('sidebar-item--dragging')
        e.dataTransfer.effectAllowed = 'move'
    })

    el.addEventListener('dragend', () => {
        el.classList.remove('sidebar-item--dragging')
        document.querySelectorAll('.sidebar-item--drag-over').forEach(x => x.classList.remove('sidebar-item--drag-over'))
        _dragSrc = null
        _persistOrder()
    })

    el.addEventListener('dragover', (e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (_dragSrc && _dragSrc !== el) {
            document.querySelectorAll('.sidebar-item--drag-over').forEach(x => x.classList.remove('sidebar-item--drag-over'))
            el.classList.add('sidebar-item--drag-over')
        }
    })

    el.addEventListener('dragleave', () => {
        el.classList.remove('sidebar-item--drag-over')
    })

    el.addEventListener('drop', (e) => {
        e.preventDefault()
        if (!_dragSrc || _dragSrc === el) return
        el.classList.remove('sidebar-item--drag-over')
        const nav = document.getElementById('sidebar-nav')
        const items = [...nav.querySelectorAll('.sidebar-item')]
        const srcIdx = items.indexOf(_dragSrc)
        const tgtIdx = items.indexOf(el)
        if (srcIdx < tgtIdx) {
            el.after(_dragSrc)
        } else {
            el.before(_dragSrc)
        }
    })
}

function _arrowNav(e) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const nav = document.getElementById('sidebar-nav')
    const focusable = [...nav.querySelectorAll('.sidebar-home-btn, .sidebar-toc-btn, .sidebar-library-btn, .sidebar-item')]
    const idx = focusable.indexOf(document.activeElement)
    if (idx === -1) return
    if (e.key === 'ArrowDown' && idx < focusable.length - 1) focusable[idx + 1].focus()
    if (e.key === 'ArrowUp'   && idx > 0)                    focusable[idx - 1].focus()
}

async function _persistOrder() {
    const nav = document.getElementById('sidebar-nav')
    const ids = [...nav.querySelectorAll('.sidebar-item')].map(el => el.dataset.id)
    const map = new Map(_pages.map(p => [p.id, p]))
    _pages = ids.map(id => map.get(id)).filter(Boolean)
    try {
        await api.pages.reorder(ids)
    } catch (err) {
        console.error('Failed to persist reorder', err)
    }
}
