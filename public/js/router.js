import { api } from './api.js'
import { escapeHtml } from './utils.js'
import { setWithTTL, getWithTTL } from './storage.js'
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
import { renderBacklog } from './views/backlog.js'
import { renderAbandoned } from './views/abandoned.js'
import { renderHallOfFame } from './views/hall-of-fame.js'
import { renderFavorites } from './views/favorites.js'
import { renderFranchises } from './views/franchises.js'
import { renderFranchise } from './views/franchise.js'
import { renderInProgress } from './views/in-progress.js'
import { renderHistory } from './views/history.js'
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
    if (el) setWithTTL(_scrollKey(path), top)
}

function _restoreScroll(path) {
    const saved = getWithTTL(_scrollKey(path))
    if (saved === null) return
    requestAnimationFrame(() => {
        const el = mainEl()
        if (el) el.scrollTop = Number(saved)
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
    if (path === 'backlog')         return { view: 'backlog' }
    if (path === 'abandoned')     return { view: 'abandoned' }
    if (path === 'history')                  return { view: 'history' }
    if (path === 'in-progress')              return { view: 'in-progress' }
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
    if (path.startsWith('community/')) {
        // Split path and inline query string cleanly
        const [pathOnly, queryOnly] = path.split('?')
        const parts = pathOnly.split('/')
        if (parts[2] === 'thread' && parts[3]) {
            // Parse sub from inline query string first, fall back to current location
            const sub = new URLSearchParams(queryOnly ?? window.location.search).get('sub') ?? ''
            return { view: 'community-thread', appid: parts[1], postId: parts[3], sub }
        }
        return { view: 'community', appid: parts[1] }
    }
    return { view: 'page', pageId: path }
}

export function getRoutePath() {
    // Strip leading slash; preserve query string so thread ?sub= survives back/forward
    const p = window.location.pathname.slice(1)
    return window.location.search ? `${p}${window.location.search}` : p
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
    backlog:          'Backlog',
    'hall-of-fame':   'Hall of Fame',
    abandoned:        'Abandoned',
    'history':         'History',
    'in-progress':     'In Progress',
    'my-reviews':     'My Reviews',
    'community':      'Community',
}

export function gameBackLabel() {
    const from = sessionStorage.getItem('gj_game_from')
    return from && FROM_LABELS[from] ? FROM_LABELS[from] : 'Library'
}

export function gameBackPath() {
    const from = sessionStorage.getItem('gj_game_from')
    if (from === 'community') {
        const communityAppid = sessionStorage.getItem('gj_community_appid') ?? ''
        return communityAppid ? `/community/${communityAppid}` : '/library'
    }
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
            if (prevRoute.view === 'community' || prevRoute.view === 'community-thread') {
                sessionStorage.setItem('gj_game_from', 'community')
                sessionStorage.setItem('gj_community_appid', prevRoute.appid ?? '')
            }
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

    if (route.view === 'backlog') {
        setActiveItem('backlog')
        await renderBacklog(mainEl())
        _restoreScroll(path)
        return
    }

    if (route.view === 'abandoned') {
        setActiveItem('abandoned')
        await renderAbandoned(mainEl())
        _restoreScroll(path)
        return
    }

    if (route.view === 'history') {
        setActiveItem('history')
        await renderHistory(mainEl())
        _restoreScroll(path)
        return
    }

    if (route.view === 'in-progress') {
        setActiveItem('in-progress')
        await renderInProgress(mainEl())
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

    if (route.view === 'community') {
        setActiveItem(null)
        const { renderCommunity } = await import('./views/community.js')
        await renderCommunity(route.appid, mainEl())
        _restoreScroll(path)
        return
    }

    if (route.view === 'community-thread') {
        setActiveItem(null)
        const { renderCommunityThread } = await import('./views/community.js')
        await renderCommunityThread(route.appid, route.postId, mainEl(), route.sub)
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
        list: 'List', progress: 'Progress Bar', 'progress-bars': 'Multi-Bar Progress', notes: 'Notes', page: 'Page', counter: 'Counter', 'multi-counter': 'Multi-Counter',
    }[page.type] ?? page.type
    mainEl().innerHTML = `
        <div class="page-header">
            <h1 class="page-title">${escapeHtml(page.title)}</h1>
            <p class="page-subtitle">(${label})</p>
        </div>`
}
