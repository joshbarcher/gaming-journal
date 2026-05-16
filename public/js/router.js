import { api } from './api.js'
import { escapeHtml } from './utils.js'
import { loadSidebar, setActiveItem, getPages, addPageToSidebar } from './sidebar.js'
import { renderToc } from './views/toc.js'
import { renderHeatmap } from './views/heatmap.js'
import { renderLibrary } from './views/library.js'
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

export function parseRoute(hash) {
    if (!hash) return { view: 'home' }
    if (hash === 'toc') return { view: 'toc' }
    if (hash === 'library') return { view: 'library' }
    return { view: 'page', pageId: hash }
}

export function getRouteFromHash() {
    return window.location.hash.slice(1)
}

export async function navigate(hash) {
    if (typeof hash !== 'string') hash = ''
    const route = parseRoute(hash)

    if (!_initialized) {
        await loadSidebar(null, navigate)
        _initialized = true
    }

    _closeMobile()

    if (route.view === 'home') {
        setHash('')
        setActiveItem('home')
        renderHeatmap(getPages(), mainEl())
        return
    }

    if (route.view === 'toc') {
        setHash('toc')
        setActiveItem('toc')
        renderToc(getPages(), mainEl())
        return
    }

    if (route.view === 'library') {
        setHash('library')
        setActiveItem('library')
        renderLibrary(mainEl())
        return
    }

    if (route.view === 'page') {
        setHash(route.pageId)
        setActiveItem(route.pageId)
        await renderPageById(route.pageId)
    }
}

function setHash(hash) {
    const target = hash ? `#${hash}` : location.pathname + location.search
    history.replaceState(null, '', target)
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
