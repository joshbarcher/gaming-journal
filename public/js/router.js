import { api } from './api.js'
import { escapeHtml } from './utils.js'
import { loadSidebar, setActiveItem, getPages, addPageToSidebar } from './sidebar.js'
import { renderToc } from './views/toc.js'
import { renderHeatmap } from './views/heatmap.js'
import { renderLibrary } from './views/library.js'
import { renderWishlist } from './views/wishlist.js'
import { renderAccount } from './views/account.js'
import { renderCalendar } from './views/calendar.js'
import { newPageDialog, showError } from './dialog.js'

function _closeMobile() {
    import('./app.js').then(m => m.closeMobileSidebar?.())
}

const _renderers = new Map()

export function registerRenderer(type, fn) {
    _renderers.set(type, fn)
}

const mainEl = () => document.getElementById('main-content')

let _initialized = false

export function parseRoute(path) {
    if (!path || path === '/') return { view: 'home' }
    if (path === 'toc')           return { view: 'toc' }
    if (path === 'library')       return { view: 'library' }
    if (path === 'wishlist')      return { view: 'wishlist' }
    if (path === 'account')       return { view: 'account' }
    if (path === 'calendar')      return { view: 'calendar' }
    if (path.startsWith('game/')) return { view: 'game', appid: path.slice(5) }
    return { view: 'page', pageId: path }
}

export function getRoutePath() {
    // Strip leading slash to get the route key (e.g. "/library" → "library")
    return window.location.pathname.slice(1)
}

export async function navigate(path, { replace = false } = {}) {
    if (typeof path !== 'string') path = ''
    const route = parseRoute(path)

    if (!_initialized) {
        await loadSidebar(null, navigate)
        _initialized = true
    }

    _closeMobile()

    const url = path ? `/${path}` : '/'
    if (replace) {
        history.replaceState(null, '', url)
    } else {
        history.pushState(null, '', url)
    }

    if (route.view === 'home') {
        setActiveItem('home')
        renderHeatmap(getPages(), mainEl())
        return
    }

    if (route.view === 'toc') {
        setActiveItem('toc')
        renderToc(getPages(), mainEl())
        return
    }

    if (route.view === 'library') {
        setActiveItem('library')
        renderLibrary(mainEl())
        return
    }

    if (route.view === 'wishlist') {
        setActiveItem('wishlist')
        renderWishlist(mainEl())
        return
    }

    if (route.view === 'account') {
        setActiveItem('account')
        renderAccount(mainEl())
        return
    }

    if (route.view === 'calendar') {
        setActiveItem('calendar')
        renderCalendar(mainEl())
        return
    }

    if (route.view === 'game') {
        setActiveItem('library')
        const { renderGame } = await import('./views/game.js')
        renderGame(route.appid, mainEl())
        return
    }

    if (route.view === 'page') {
        setActiveItem(route.pageId)
        await renderPageById(route.pageId)
    }
}

export async function addNewPage() {
    const result = await newPageDialog()
    if (!result) return
    try {
        const page = await api.pages.create(result)
        addPageToSidebar(page)
        navigate(page.id)
    } catch (err) {
        showError(`Failed to create page: ${err.message}`)
    }
}

async function renderPageById(id) {
    mainEl().innerHTML = `<p class="page-loading">Loading…</p>`
    let page
    try {
        page = await api.pages.get(id)
    } catch {
        mainEl().innerHTML = `<p class="page-error">Page not found.</p>`
        return
    }
    const renderer = _renderers.get(page.type)
    if (renderer) {
        renderer(page, mainEl())
    } else {
        renderPlaceholder(page)
    }
}

function renderPlaceholder(page) {
    const label = {
        list: 'List', progress: 'Progress Bar', 'progress-bars': 'Multi-Bar Progress', notes: 'Notes', page: 'Page',
    }[page.type] ?? page.type
    mainEl().innerHTML = `
        <div class="page-header">
            <h1 class="page-title">${escapeHtml(page.title)}</h1>
            <p class="page-subtitle">(${label})</p>
        </div>`
}
