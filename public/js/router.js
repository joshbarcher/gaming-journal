import { api } from './api.js'
import { escapeHtml } from './utils.js'
import { loadSidebar, setActiveItem, getPages, addPageToSidebar } from './sidebar.js'
import { renderToc } from './views/toc.js'
import { renderHome } from './views/home.js'
import { renderHeatmap } from './views/heatmap.js'
import { renderLibrary } from './views/library.js'
import { renderWishlist } from './views/wishlist.js'
import { renderAccount } from './views/account.js'
import { renderCalendar, renderReleases } from './views/calendar.js'
import { renderSettings } from './views/settings.js'
import { renderAlerts } from './views/alerts.js'
import { renderVault } from './views/vault.js'
import { renderAbandoned } from './views/abandoned.js'
import { renderHallOfFame } from './views/hall-of-fame.js'
import { renderFavorites } from './views/favorites.js'
import { renderFranchises } from './views/franchises.js'
import { renderFranchise } from './views/franchise.js'
import { renderOnHold } from './views/on-hold.js'
import { renderMyReviews } from './views/my-reviews.js'
import { renderDiscover } from './views/discover.js'
import { newPageDialog, showError } from './dialog.js'

function _closeMobile() {
    import('./app.js').then(m => m.closeMobileSidebar?.())
}

const _renderers = new Map()

export function registerRenderer(type, fn) {
    _renderers.set(type, fn)
}

const mainEl = () => document.getElementById('main-content')

// ── Scroll persistence ────────────────────────────────────────────────────────

function _scrollKey(path) { return `scroll:${path || '/'}` }

function _saveScroll(path) {
    const el = mainEl()
    const top = el?.scrollTop ?? 0
    console.log('[scroll] save', path, '→', top)
    if (el) localStorage.setItem(_scrollKey(path), top)
}

function _restoreScroll(path) {
    const saved = localStorage.getItem(_scrollKey(path))
    console.log('[scroll] restore requested', path, '→ saved:', saved)
    if (saved === null) return
    requestAnimationFrame(() => {
        const el = mainEl()
        console.log('[scroll] rAF firing, el.scrollHeight:', el?.scrollHeight, 'setting scrollTop to', Number(saved))
        if (el) el.scrollTop = Number(saved)
        console.log('[scroll] scrollTop after set:', el?.scrollTop)
    })
}

let _scrollTimer = null
function _onScroll() {
    clearTimeout(_scrollTimer)
    _scrollTimer = setTimeout(() => _saveScroll(getRoutePath()), 150)
}

let _initialized = false

export function parseRoute(path) {
    if (!path || path === '/') return { view: 'home' }
    if (path === 'toc')           return { view: 'toc' }
    if (path === 'library')       return { view: 'library' }
    if (path === 'wishlist')      return { view: 'wishlist' }
    if (path === 'account')       return { view: 'account' }
    if (path === 'calendar')      return { view: 'calendar' }
    if (path === 'releases')      return { view: 'releases' }
    if (path === 'top-games')     return { view: 'top-games' }
    if (path === 'alerts')        return { view: 'alerts' }
    if (path === 'favorites')     return { view: 'favorites' }
    if (path === 'vault')         return { view: 'vault' }
    if (path === 'abandoned')     return { view: 'abandoned' }
    if (path === 'on-hold')              return { view: 'on-hold' }
    if (path === 'hall-of-fame')         return { view: 'hall-of-fame' }
    if (path === 'settings')             return { view: 'settings' }
    if (path === 'franchises')           return { view: 'franchises' }
    if (path === 'my-reviews')             return { view: 'my-reviews' }
    if (path === 'discover')               return { view: 'discover' }
    if (path.startsWith('franchise/'))   return { view: 'franchise', franchiseId: path.slice(10) }
    if (path.startsWith('game/'))        return { view: 'game', appid: path.slice(5) }
    if (path.startsWith('journal/')) {
        const parts = path.split('/')
        return { view: 'journal', appid: parts[1], sub: parts[2] ?? null }
    }
    return { view: 'page', pageId: path }
}

export function getRoutePath() {
    // Strip leading slash to get the route key (e.g. "/library" → "library")
    return window.location.pathname.slice(1)
}

const FROM_LABELS = {
    library:          'Library',
    wishlist:         'Wishlist',
    discover:         'Discover',
    'top-games':      'Top 100',
    franchise:        'Franchise',
    franchises:       'Franchises',
    favorites:        'Favorites',
    calendar:         'Calendar',
    releases:         'Releases',
    account:          'Account',
    vault:            'Vault',
    'hall-of-fame':   'Hall of Fame',
    abandoned:        'Abandoned',
    'on-hold':        'On Hold',
    'my-reviews':     'My Reviews',
}

export function gameBackLabel() {
    const from = sessionStorage.getItem('gj_game_from')
    return from && FROM_LABELS[from] ? FROM_LABELS[from] : 'Library'
}

export function gameBackPath() {
    const from = sessionStorage.getItem('gj_game_from')
    return from && FROM_LABELS[from] ? `/${from}` : '/library'
}

export async function navigate(path, { replace = false } = {}) {
    if (typeof path !== 'string') path = ''
    const route = parseRoute(path)

    // When navigating to a game, record which view we're leaving so the game
    // page can render a context-aware back button. Don't overwrite if already
    // navigating game-to-game (keeps the original origin view).
    if (route.view === 'game' && _initialized) {
        const prevRoute = parseRoute(getRoutePath())
        if (prevRoute.view !== 'game') {
            sessionStorage.setItem('gj_game_from', prevRoute.view)
        }
    }

    // Save scroll position of the page we're leaving — but not on the initial
    // page load, where scrollTop is 0 and would overwrite a valid stored position
    if (_initialized) _saveScroll(getRoutePath())

    if (!_initialized) {
        await loadSidebar(null, navigate)
        mainEl()?.addEventListener('scroll', _onScroll, { passive: true })
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
        await renderHome(mainEl())
        return
    }

    if (route.view === 'toc') {
        setActiveItem('toc')
        await renderToc(getPages(), mainEl())
        _restoreScroll(path)
        return
    }

    if (route.view === 'library') {
        setActiveItem('library')
        await renderLibrary(mainEl())
        _restoreScroll(path)
        return
    }

    if (route.view === 'wishlist') {
        setActiveItem('wishlist')
        await renderWishlist(mainEl())
        _restoreScroll(path)
        return
    }

    if (route.view === 'account') {
        setActiveItem('account')
        await renderAccount(mainEl())
        _restoreScroll(path)
        return
    }

    if (route.view === 'calendar') {
        setActiveItem('calendar')
        await renderCalendar(mainEl())
        _restoreScroll(path)
        return
    }

    if (route.view === 'releases') {
        setActiveItem('releases')
        await renderReleases(mainEl())
        _restoreScroll(path)
        return
    }

    if (route.view === 'top-games') {
        setActiveItem('top-games')
        const { renderTopGames } = await import('./views/top-games.js')
        await renderTopGames(mainEl())
        _restoreScroll(path)
        return
    }

    if (route.view === 'alerts') {
        setActiveItem('alerts')
        await renderAlerts(mainEl())
        _restoreScroll(path)
        return
    }

    if (route.view === 'favorites') {
        setActiveItem('favorites')
        await renderFavorites(mainEl())
        _restoreScroll(path)
        return
    }

    if (route.view === 'vault') {
        setActiveItem('vault')
        await renderVault(mainEl())
        _restoreScroll(path)
        return
    }

    if (route.view === 'abandoned') {
        setActiveItem('abandoned')
        await renderAbandoned(mainEl())
        _restoreScroll(path)
        return
    }

    if (route.view === 'on-hold') {
        setActiveItem('on-hold')
        await renderOnHold(mainEl())
        _restoreScroll(path)
        return
    }

    if (route.view === 'hall-of-fame') {
        setActiveItem('hall-of-fame')
        await renderHallOfFame(mainEl())
        _restoreScroll(path)
        return
    }

    if (route.view === 'settings') {
        setActiveItem('settings')
        await renderSettings(mainEl())
        _restoreScroll(path)
        return
    }

    if (route.view === 'franchises') {
        setActiveItem('franchises')
        await renderFranchises(mainEl(), navigate)
        _restoreScroll(path)
        return
    }

    if (route.view === 'franchise') {
        setActiveItem('franchises')
        await renderFranchise(route.franchiseId, mainEl(), navigate)
        _restoreScroll(path)
        return
    }

    if (route.view === 'my-reviews') {
        setActiveItem('my-reviews')
        await renderMyReviews(mainEl(), navigate)
        _restoreScroll(path)
        return
    }

    if (route.view === 'discover') {
        setActiveItem('discover')
        await renderDiscover(mainEl(), navigate)
        _restoreScroll(path)
        return
    }

    if (route.view === 'game') {
        setActiveItem('library')
        const { renderGame } = await import('./views/game.js')
        await renderGame(route.appid, mainEl())
        _restoreScroll(path)
        return
    }

    if (route.view === 'journal') {
        setActiveItem(null)
        const { renderGameJournal } = await import('./views/game-journal.js')
        await renderGameJournal(route.appid, route.sub, mainEl(), navigate)
        _restoreScroll(path)
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
