import { api } from './api.js'
import { escapeHtml, progressPercent } from './utils.js'
import { confirmDialog, showError } from './dialog.js'
import { percentToColor } from './views/progress-helpers.js'

const _SVG = (paths) =>
    `<svg class="sidebar-nav-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`

const _ICONS = {
    home:     _SVG(`<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>`),
    toc:      _SVG(`<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>`),
    library:  _SVG(`<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>`),
    wishlist: _SVG(`<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>`),
    account:  _SVG(`<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`),
    calendar:  _SVG(`<rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/><line x1="8" x2="8.01" y1="14" y2="14"/><line x1="12" x2="12.01" y1="14" y2="14"/><line x1="16" x2="16.01" y1="14" y2="14"/>`),
    topGames:  _SVG(`<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>`),
    releases:  _SVG(`<path d="M20 12v10H4V12"/><path d="M2 7h20v5H2z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>`),
    settings: _SVG(`<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>`),
    alerts:   _SVG(`<path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/>`),
}

let _pages = []
let _onNavigate = null
let _activeId = null
let _nowPlayingTimer   = null
let _nowPlayingAppid   = null
let _alertsTimer       = null

export function getPages() {
    return _pages
}

export async function loadSidebar(activeId, onNavigate) {
    _onNavigate = onNavigate
    _activeId = activeId
    _pages = await api.pages.list()
    renderSidebar(activeId)
    _startNowPlayingPoller()
    _startAlertsPoller()
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
    document.querySelectorAll('.sidebar-item, .sidebar-toc-btn, .sidebar-home-btn, .sidebar-library-btn, .sidebar-wishlist-btn, .sidebar-alerts-btn, .sidebar-account-btn, .sidebar-calendar-btn, .sidebar-releases-btn, .sidebar-top-games-btn, .sidebar-settings-btn').forEach(el => {
        const elId = el.dataset.id
        el.classList.toggle('active', elId === id)
    })
    if (id !== 'toc' && id !== 'home') {
        const page = _pages.find(p => p.id === id)
        if (page) refreshSidebarItem(page)
    }
}

// ── Now Playing ───────────────────────────────────────────────────────────────

function _startNowPlayingPoller() {
    _fetchNowPlaying()
    if (_nowPlayingTimer) clearInterval(_nowPlayingTimer)
    _nowPlayingTimer = setInterval(_fetchNowPlaying, 60_000)
}

async function _fetchNowPlaying() {
    try {
        const res = await fetch('/relay/api/steam/now-playing')
        if (!res.ok) return
        const { playing } = await res.json()
        _renderNowPlaying(playing ?? null)
    } catch { /* silent — non-critical */ }
}

function _renderNowPlaying(playing) {
    const nav = document.getElementById('sidebar-nav')
    if (!nav) return
    const existing = nav.querySelector('.now-playing-wrap')

    if (!playing) {
        if (existing) existing.remove()
        _nowPlayingAppid = null
        return
    }

    if (_nowPlayingAppid === playing.appid) return  // no change

    _nowPlayingAppid = playing.appid
    if (existing) existing.remove()

    const wrap = document.createElement('div')
    wrap.className = 'now-playing-wrap'
    wrap.innerHTML = `
        <a class="now-playing-card" href="/game/${playing.appid}">
            <div class="now-playing-bg" style="background-image:url('/relay/images/steam/games/${playing.appid}/header.jpg')"></div>
            <div class="now-playing-scrim"></div>
            <div class="now-playing-body">
                <span class="now-playing-eyebrow">Now Playing</span>
                <span class="now-playing-title">${escapeHtml(playing.name)}</span>
            </div>
        </a>
        <div class="now-playing-orbit">
            <div class="now-playing-particle"></div>
        </div>`

    wrap.querySelector('.now-playing-card').addEventListener('click', e => {
        e.preventDefault()
        _onNavigate(`game/${playing.appid}`)
    })

    nav.insertBefore(wrap, nav.firstChild)
}

// ── Alerts badge poller ───────────────────────────────────────────────────────

function _startAlertsPoller() {
    _fetchAlertsBadge()
    if (_alertsTimer) clearInterval(_alertsTimer)
    _alertsTimer = setInterval(_fetchAlertsBadge, 15 * 60_000)
}

async function _fetchAlertsBadge() {
    try {
        const res = await fetch('/api/alerts')
        if (!res.ok) return
        const { onSale } = await res.json()
        _updateAlertsBadge(onSale?.length ?? 0)
    } catch { /* silent */ }
}

function _updateAlertsBadge(count) {
    const badge = document.querySelector('.sidebar-alerts-badge')
    if (!badge) return
    badge.textContent = count
    badge.style.display = count > 0 ? '' : 'none'
}

// ── Sidebar render ────────────────────────────────────────────────────────────

function renderSidebar(activeId) {
    const nav = document.getElementById('sidebar-nav')
    nav.innerHTML = ''

    nav.appendChild(buildHomeButton(activeId === 'home'))
    nav.appendChild(buildTocButton(activeId === 'toc'))
    nav.appendChild(buildLibraryButton(activeId === 'library'))
    nav.appendChild(buildWishlistButton(activeId === 'wishlist'))
    nav.appendChild(buildAlertsButton(activeId === 'alerts'))
    nav.appendChild(buildCalendarButton(activeId === 'calendar'))
    nav.appendChild(buildReleasesButton(activeId === 'releases'))
    nav.appendChild(buildTopGamesButton(activeId === 'top-games'))

    if (_pages.length === 0) {
        const empty = document.createElement('div')
        empty.className = 'sidebar-empty'
        empty.textContent = 'No pages yet'
        nav.appendChild(empty)
    } else {
        for (const page of _pages) {
            nav.appendChild(buildItem(page, page.id === activeId))
        }
    }

    // Bottom items — account & settings pinned after pages
    const bottomSep = document.createElement('div')
    bottomSep.className = 'sidebar-bottom-sep'
    nav.appendChild(bottomSep)
    nav.appendChild(buildAccountButton(activeId === 'account'))
    nav.appendChild(buildSettingsButton(activeId === 'settings'))
}

function buildHomeButton(isActive) {
    const el = document.createElement('div')
    el.className = 'sidebar-home-btn' + (isActive ? ' active' : '')
    el.dataset.id = 'home'
    el.tabIndex = 0
    el.innerHTML = `${_ICONS.home} Journal`
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
    el.innerHTML = `${_ICONS.library} Steam Library`
    el.addEventListener('click', () => _onNavigate('library'))
    el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _onNavigate('library') }
        _arrowNav(e)
    })
    return el
}

function buildWishlistButton(isActive) {
    const el = document.createElement('div')
    el.className = 'sidebar-wishlist-btn' + (isActive ? ' active' : '')
    el.dataset.id = 'wishlist'
    el.tabIndex = 0
    el.innerHTML = `${_ICONS.wishlist} Wishlist`
    el.addEventListener('click', () => _onNavigate('wishlist'))
    el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _onNavigate('wishlist') }
        _arrowNav(e)
    })
    return el
}

function buildAccountButton(isActive) {
    const el = document.createElement('div')
    el.className = 'sidebar-account-btn' + (isActive ? ' active' : '')
    el.dataset.id = 'account'
    el.tabIndex = 0
    el.innerHTML = `${_ICONS.account} Account`
    el.addEventListener('click', () => _onNavigate('account'))
    el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _onNavigate('account') }
        _arrowNav(e)
    })
    return el
}

function buildAlertsButton(isActive) {
    const el = document.createElement('div')
    el.className = 'sidebar-alerts-btn' + (isActive ? ' active' : '')
    el.dataset.id = 'alerts'
    el.tabIndex = 0
    el.innerHTML = `${_ICONS.alerts} Sale Alerts <span class="sidebar-alerts-badge" style="display:none">0</span>`
    el.addEventListener('click', () => _onNavigate('alerts'))
    el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _onNavigate('alerts') }
        _arrowNav(e)
    })
    return el
}

function buildCalendarButton(isActive) {
    const el = document.createElement('div')
    el.className = 'sidebar-calendar-btn' + (isActive ? ' active' : '')
    el.dataset.id = 'calendar'
    el.tabIndex = 0
    el.innerHTML = `${_ICONS.calendar} Play Calendar`
    el.addEventListener('click', () => _onNavigate('calendar'))
    el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _onNavigate('calendar') }
        _arrowNav(e)
    })
    return el
}

function buildReleasesButton(isActive) {
    const el = document.createElement('div')
    el.className = 'sidebar-releases-btn' + (isActive ? ' active' : '')
    el.dataset.id = 'releases'
    el.tabIndex = 0
    el.innerHTML = `${_ICONS.releases} Release Calendar`
    el.addEventListener('click', () => _onNavigate('releases'))
    el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _onNavigate('releases') }
        _arrowNav(e)
    })
    return el
}

function buildTopGamesButton(isActive) {
    const el = document.createElement('div')
    el.className = 'sidebar-top-games-btn' + (isActive ? ' active' : '')
    el.dataset.id = 'top-games'
    el.tabIndex = 0
    el.innerHTML = `${_ICONS.topGames} Top Games`
    el.addEventListener('click', () => _onNavigate('top-games'))
    el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _onNavigate('top-games') }
        _arrowNav(e)
    })
    return el
}

function buildSettingsButton(isActive) {
    const el = document.createElement('div')
    el.className = 'sidebar-settings-btn' + (isActive ? ' active' : '')
    el.dataset.id = 'settings'
    el.tabIndex = 0
    el.innerHTML = `${_ICONS.settings} Settings`
    el.addEventListener('click', () => _onNavigate('settings'))
    el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _onNavigate('settings') }
        _arrowNav(e)
    })
    return el
}

function buildTocButton(isActive) {
    const el = document.createElement('div')
    el.className = 'sidebar-toc-btn' + (isActive ? ' active' : '')
    el.dataset.id = 'toc'
    el.tabIndex = 0
    el.innerHTML = `${_ICONS.toc} Table of Contents`
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
    const focusable = [...nav.querySelectorAll('.sidebar-home-btn, .sidebar-toc-btn, .sidebar-library-btn, .sidebar-wishlist-btn, .sidebar-alerts-btn, .sidebar-account-btn, .sidebar-calendar-btn, .sidebar-releases-btn, .sidebar-top-games-btn, .sidebar-settings-btn, .sidebar-item')]
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
