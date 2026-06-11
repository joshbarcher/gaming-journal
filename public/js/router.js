import { mount, unmount } from 'svelte'
import { api } from './api.js'
import { escapeHtml } from './utils.js'
import { setWithTTL, getWithTTL } from './storage.js'
import { loadSidebar, setActiveItem, getPages, addPageToSidebar } from './sidebar.js'
import { newPageDialog, showError } from './dialog.js'

// ── Named-route components ────────────────────────────────────────────────────
import Toc          from '../svelte/toc/Toc.svelte'
import Home         from '../svelte/home/Home.svelte'
import LibraryPage  from '../svelte/library/LibraryPage.svelte'
import WishlistPage from '../svelte/wishlist/WishlistPage.svelte'
import Account      from '../svelte/account/Account.svelte'
import Calendar     from '../svelte/calendar/Calendar.svelte'
import Alerts       from '../svelte/alerts/Alerts.svelte'
import Favorites    from '../svelte/favorites/Favorites.svelte'
import Backlog      from '../svelte/backlog/Backlog.svelte'
import Abandoned    from '../svelte/abandoned/Abandoned.svelte'
import History      from '../svelte/history/History.svelte'
import InProgress   from '../svelte/in-progress/InProgress.svelte'
import HallOfFame   from '../svelte/hall-of-fame/HallOfFame.svelte'
import Settings     from '../svelte/settings/Settings.svelte'
import Franchises   from '../svelte/franchises/Franchises.svelte'
import Franchise    from '../svelte/franchise/Franchise.svelte'
import MyReviews    from '../svelte/my-reviews/MyReviews.svelte'
import Discover     from '../svelte/discover/Discover.svelte'

// ── Page-type components ──────────────────────────────────────────────────────
import ListPage     from '../svelte/list/ListPage.svelte'
import Progress     from '../svelte/progress-tracker/Progress.svelte'
import ProgressBars from '../svelte/progress/ProgressBars.svelte'
import Notes        from '../svelte/notes/Notes.svelte'
import PageEditor   from '../svelte/page-editor/PageEditor.svelte'
import Counter      from '../svelte/counter/Counter.svelte'
import MultiCounter from '../svelte/multi-counter/MultiCounter.svelte'

const PAGE_COMPONENTS = new Map([
    ['list',           ListPage    ],
    ['progress',       Progress    ],
    ['progress-bars',  ProgressBars],
    ['notes',          Notes       ],
    ['page',           PageEditor  ],
    ['counter',        Counter     ],
    ['multi-counter',  MultiCounter],
])

// ── Mount helpers ─────────────────────────────────────────────────────────────

let _mounted = null
const mainEl = () => document.getElementById('main-content')

function _cleanup() {
    if (_mounted) { unmount(_mounted); _mounted = null }
}

function _mount(Component, props = {}) {
    _cleanup()
    mainEl().innerHTML = ''
    _mounted = mount(Component, { target: mainEl(), props })
}

function _closeMobile() {
    import('./app.js').then(m => m.closeMobileSidebar?.())
}

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
    if (path === 'backlog')       return { view: 'backlog' }
    if (path === 'abandoned')     return { view: 'abandoned' }
    if (path === 'history')       return { view: 'history' }
    if (path === 'in-progress')   return { view: 'in-progress' }
    if (path === 'hall-of-fame')  return { view: 'hall-of-fame' }
    if (path === 'settings')      return { view: 'settings' }
    if (path === 'franchises')    return { view: 'franchises' }
    if (path === 'my-reviews')    return { view: 'my-reviews' }
    if (path === 'discover')      return { view: 'discover' }
    if (path.startsWith('franchise/'))  return { view: 'franchise', franchiseId: path.slice(10) }
    if (path.startsWith('game/'))       return { view: 'game', appid: path.slice(5) }
    if (path.startsWith('journal/')) {
        const parts = path.split('/')
        return { view: 'journal', appid: parts[1], sub: parts[2] ?? null }
    }
    if (path.startsWith('community/')) {
        const [pathOnly, queryOnly] = path.split('?')
        const parts = pathOnly.split('/')
        if (parts[2] === 'thread' && parts[3]) {
            const sub = new URLSearchParams(queryOnly ?? window.location.search).get('sub') ?? ''
            return { view: 'community-thread', appid: parts[1], postId: parts[3], sub }
        }
        return { view: 'community', appid: parts[1] }
    }
    return { view: 'page', pageId: path }
}

export function getRoutePath() {
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
    history:          'History',
    'in-progress':    'In Progress',
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

    if (route.view === 'game' && _initialized) {
        const prevRoute = parseRoute(getRoutePath())
        const isGameSubPage = prevRoute.view === 'community' || prevRoute.view === 'community-thread'
        if (prevRoute.view !== 'game' && !isGameSubPage) {
            sessionStorage.setItem('gj_game_from', prevRoute.view)
        }
    }

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
        _mount(Home)
        return
    }

    if (route.view === 'toc') {
        setActiveItem('toc')
        _mount(Toc, { pages: getPages() })
        _restoreScroll(path)
        return
    }

    if (route.view === 'library') {
        setActiveItem('library')
        _mount(LibraryPage)
        _restoreScroll(path)
        return
    }

    if (route.view === 'wishlist') {
        setActiveItem('wishlist')
        _mount(WishlistPage)
        _restoreScroll(path)
        return
    }

    if (route.view === 'account') {
        setActiveItem('account')
        _mount(Account)
        _restoreScroll(path)
        return
    }

    if (route.view === 'calendar') {
        setActiveItem('calendar')
        _mount(Calendar, { mode: 'play' })
        _restoreScroll(path)
        return
    }

    if (route.view === 'releases') {
        setActiveItem('releases')
        _mount(Calendar, { mode: 'releases' })
        _restoreScroll(path)
        return
    }

    if (route.view === 'top-games') {
        setActiveItem('top-games')
        const { default: TopGames } = await import('../svelte/top-games/TopGames.svelte')
        _mount(TopGames)
        _restoreScroll(path)
        return
    }

    if (route.view === 'alerts') {
        setActiveItem('alerts')
        _mount(Alerts)
        _restoreScroll(path)
        return
    }

    if (route.view === 'favorites') {
        setActiveItem('favorites')
        _mount(Favorites)
        _restoreScroll(path)
        return
    }

    if (route.view === 'backlog') {
        setActiveItem('backlog')
        _mount(Backlog)
        _restoreScroll(path)
        return
    }

    if (route.view === 'abandoned') {
        setActiveItem('abandoned')
        _mount(Abandoned)
        _restoreScroll(path)
        return
    }

    if (route.view === 'history') {
        setActiveItem('history')
        _mount(History)
        _restoreScroll(path)
        return
    }

    if (route.view === 'in-progress') {
        setActiveItem('in-progress')
        _mount(InProgress)
        _restoreScroll(path)
        return
    }

    if (route.view === 'hall-of-fame') {
        setActiveItem('hall-of-fame')
        _mount(HallOfFame)
        _restoreScroll(path)
        return
    }

    if (route.view === 'settings') {
        setActiveItem('settings')
        _mount(Settings)
        _restoreScroll(path)
        return
    }

    if (route.view === 'franchises') {
        setActiveItem('franchises')
        _mount(Franchises)
        _restoreScroll(path)
        return
    }

    if (route.view === 'franchise') {
        setActiveItem('franchises')
        _mount(Franchise, { franchiseId: route.franchiseId })
        _restoreScroll(path)
        return
    }

    if (route.view === 'my-reviews') {
        setActiveItem('my-reviews')
        _mount(MyReviews)
        _restoreScroll(path)
        return
    }

    if (route.view === 'discover') {
        setActiveItem('discover')
        _mount(Discover)
        _restoreScroll(path)
        return
    }

    if (route.view === 'game') {
        setActiveItem('library')
        const { default: GamePage } = await import('../svelte/game/GamePage.svelte')
        _mount(GamePage, { appid: route.appid })
        _restoreScroll(path)
        return
    }

    if (route.view === 'community') {
        setActiveItem(null)
        const { default: CommunityPage } = await import('../svelte/community/CommunityPage.svelte')
        _mount(CommunityPage, { appid: route.appid })
        _restoreScroll(path)
        return
    }

    if (route.view === 'community-thread') {
        setActiveItem(null)
        const { default: CommunityThread } = await import('../svelte/community/CommunityThread.svelte')
        _mount(CommunityThread, { appid: route.appid, postId: route.postId, sub: route.sub })
        _restoreScroll(path)
        return
    }

    if (route.view === 'journal') {
        setActiveItem(null)
        const { default: GameJournal } = await import('../svelte/journal/GameJournal.svelte')
        _mount(GameJournal, { appid: route.appid, sub: route.sub })
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
    _cleanup()
    mainEl().innerHTML = `<p class="page-loading">Loading…</p>`
    let page
    try {
        page = await api.pages.get(id)
    } catch {
        mainEl().innerHTML = `<p class="page-error">Page not found.</p>`
        return
    }
    const Component = PAGE_COMPONENTS.get(page.type)
    if (Component) {
        _mount(Component, { page })
    } else {
        _renderPlaceholder(page)
    }
}

function _renderPlaceholder(page) {
    const label = {
        list: 'List', progress: 'Progress Bar', 'progress-bars': 'Multi-Bar Progress',
        notes: 'Notes', page: 'Page', counter: 'Counter', 'multi-counter': 'Multi-Counter',
    }[page.type] ?? page.type
    mainEl().innerHTML = `
        <div class="page-header">
            <h1 class="page-title">${escapeHtml(page.title)}</h1>
            <p class="page-subtitle">(${label})</p>
        </div>`
}
