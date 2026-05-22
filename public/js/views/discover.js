import { escapeHtml } from '../utils.js'

const FEATURED_TABS = [
    { id: 'new_releases', label: 'New Releases' },
    { id: 'top_sellers',  label: 'Top Sellers'  },
    { id: 'coming_soon',  label: 'Coming Soon'  },
    { id: 'specials',     label: 'On Sale'       },
]

const STORAGE_KEY      = 'disc-state'
const SEARCH_PAGE_SIZE = 40

let _navigate = null
let _owned    = new Set()
let _wishlist = new Set()

// ── State ────────────────────────────────────────────────────────────────────

let _mode          = 'browse'        // 'browse' | 'search'
let _featuredTab   = 'new_releases'
let _searchQuery   = ''
let _debounceTimer = null

let _featuredData = null  // sections array from /featured (each has { id, label, items, page, pages, total })
let _tabPages     = {}    // tab → last loaded page
let _lastResults  = null  // cached search results for back-navigation
let _searchPage   = 1     // current page within search results

// ── State persistence ─────────────────────────────────────────────────────────

function _saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            mode:        _mode,
            tab:         _featuredTab,
            tabPages:    _tabPages,
            searchQuery: _searchQuery,
            lastResults: _lastResults,
            searchPage:  _searchPage,
        }))
    } catch { /* storage full / private mode */ }
}

function _restoreState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return
        const s = JSON.parse(raw)
        if (s.mode)                      _mode        = s.mode
        if (s.tab)                       _featuredTab = s.tab
        if (s.tabPages)                  _tabPages    = s.tabPages
        if (s.searchQuery != null)       _searchQuery = s.searchQuery
        if (s.lastResults !== undefined) _lastResults = s.lastResults
        if (s.searchPage)                _searchPage  = s.searchPage
    } catch { /* corrupt storage */ }
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function renderDiscover(container, navigate) {
    _navigate = navigate
    _restoreState()
    container.innerHTML = _skeleton()
    _bind(container)
    _loadOwnership()

    if (_mode === 'search' && _lastResults !== null) {
        // Returning from a game page — restore previous search results immediately
        const browse = container.querySelector('#disc-browse')
        const panel  = container.querySelector('#disc-search-panel')
        browse.style.display = 'none'
        panel.style.display  = ''
        _renderSearchResults(container, _lastResults)
    } else {
        _loadFeatured(container)
    }
}

// ── Templates ─────────────────────────────────────────────────────────────────

function _skeleton() {
    const featuredTabsHtml = FEATURED_TABS.map(t =>
        `<button class="disc-tab${t.id === _featuredTab ? ' disc-tab--active' : ''}" data-tab="${t.id}">${t.label}</button>`
    ).join('')

    return `
<div class="disc-wrap">
    <h1 class="disc-title">Discover</h1>

    <div class="disc-search-wrap">
        <input id="disc-search" class="disc-search" type="search"
               placeholder="Search 160,000+ Steam games…" autocomplete="off"
               value="${escapeHtml(_searchQuery)}">
    </div>

    <div id="disc-browse" class="disc-browse">
        <div class="disc-tabs-bar">
            <div id="disc-featured-tabs" class="disc-tabs">
                ${featuredTabsHtml}
            </div>
            <div id="disc-top-pagination" class="disc-top-pagination"></div>
        </div>
        <div id="disc-results" class="disc-grid">
            <div class="disc-loading">Loading…</div>
        </div>
    </div>

    <div id="disc-search-panel" class="disc-browse" style="display:none">
        <div id="disc-search-meta" class="disc-search-meta"></div>
        <div id="disc-search-results" class="disc-grid"></div>
    </div>
</div>`
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function _loadOwnership() {
    try {
        const res = await fetch('/relay/api/games/ownership')
        if (!res.ok) return
        const games = await res.json()
        _owned    = new Set()
        _wishlist = new Set()
        for (const g of games) {
            if (g.source === 'library' || g.source === 'both') _owned.add(g.appid)
            if (g.source === 'wishlist' || g.source === 'both') _wishlist.add(g.appid)
        }
    } catch { /* non-critical */ }
}

async function _loadFeatured(container) {
    try {
        const res = await fetch('/relay/api/discover/featured')
        if (!res.ok) throw new Error(`${res.status}`)
        _featuredData = await res.json()
        for (const s of _featuredData) {
            if (!_tabPages[s.id]) _tabPages[s.id] = 1
        }
        // If the active tab has a saved page > 1, jump straight to it
        const savedPage = _tabPages[_featuredTab] ?? 1
        if (savedPage > 1) {
            _loadFeaturedTab(container, _featuredTab, savedPage)
        } else {
            _renderFeaturedTab(container)
        }
    } catch {
        _showError(container.querySelector('#disc-results'), 'Failed to load featured games.')
    }
}

async function _loadFeaturedTab(container, tab, page) {
    const resultsEl = container.querySelector('#disc-results')
    resultsEl.innerHTML = '<div class="disc-loading">Loading…</div>'
    try {
        const res = await fetch(`/relay/api/discover/featured?tab=${encodeURIComponent(tab)}&page=${page}`)
        if (!res.ok) throw new Error(`${res.status}`)
        const section = await res.json()
        const idx = _featuredData ? _featuredData.findIndex(s => s.id === tab) : -1
        if (idx >= 0) _featuredData[idx] = section
        _tabPages[tab] = section.page
        _saveState()
        _renderFeaturedTab(container)
    } catch {
        _showError(resultsEl, `Failed to load page ${page}.`)
    }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function _renderFeaturedTab(container) {
    const resultsEl = container.querySelector('#disc-results')
    const topPagEl  = container.querySelector('#disc-top-pagination')
    if (!_featuredData) return
    const section = _featuredData.find(s => s.id === _featuredTab)
    if (!section) {
        resultsEl.innerHTML = '<div class="disc-empty">No data for this section.</div>'
        if (topPagEl) topPagEl.innerHTML = ''
        return
    }

    const { items, page, pages } = section
    if (!items.length) {
        resultsEl.innerHTML = '<div class="disc-empty">No results yet — check back soon.</div>'
        if (topPagEl) topPagEl.innerHTML = ''
        return
    }

    const paginationHtml = pages > 1 ? `
        <div class="disc-pagination">
            <button class="disc-page-btn" data-dir="-1"${page <= 1 ? ' disabled' : ''}>← Prev</button>
            <span class="disc-page-info">Page ${page} of ${pages}</span>
            <button class="disc-page-btn" data-dir="1"${page >= pages ? ' disabled' : ''}>Next →</button>
        </div>` : ''

    resultsEl.innerHTML = items.map(_card).join('') + paginationHtml
    _bindCards(resultsEl, container)

    resultsEl.querySelectorAll('.disc-page-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            _loadFeaturedTab(container, _featuredTab, page + parseInt(btn.dataset.dir, 10))
        })
    })

    // Mirror pagination above the tabs bar (outside the grid, no grid-column needed)
    if (topPagEl) {
        if (pages > 1) {
            topPagEl.innerHTML = `
                <button class="disc-page-btn" data-dir="-1"${page <= 1 ? ' disabled' : ''}>← Prev</button>
                <span class="disc-page-info">Page ${page} of ${pages}</span>
                <button class="disc-page-btn" data-dir="1"${page >= pages ? ' disabled' : ''}>Next →</button>`
            topPagEl.querySelectorAll('.disc-page-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    _loadFeaturedTab(container, _featuredTab, page + parseInt(btn.dataset.dir, 10))
                })
            })
        } else {
            topPagEl.innerHTML = ''
        }
    }
}

function _renderSearchResults(container, results) {
    const metaEl    = container.querySelector('#disc-search-meta')
    const resultsEl = container.querySelector('#disc-search-results')

    if (!results.length) {
        if (metaEl) metaEl.innerHTML = ''
        resultsEl.innerHTML = `<div class="disc-empty">No results for "${escapeHtml(_searchQuery)}".</div>`
        return
    }

    const total = results.length
    const pages = Math.ceil(total / SEARCH_PAGE_SIZE)
    const page  = Math.max(1, Math.min(_searchPage, pages))
    const start = (page - 1) * SEARCH_PAGE_SIZE
    const slice = results.slice(start, start + SEARCH_PAGE_SIZE)

    const _pagHtml = (withClass) => pages > 1 ? `
        <${withClass ? `div class="${withClass}"` : 'div'}>
            <button class="disc-page-btn" data-dir="-1"${page <= 1 ? ' disabled' : ''}>← Prev</button>
            <span class="disc-page-info">Page ${page} of ${pages}</span>
            <button class="disc-page-btn" data-dir="1"${page >= pages ? ' disabled' : ''}>Next →</button>
        </div>` : ''

    const _bindPagBtns = (el) => {
        el.querySelectorAll('.disc-page-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                _searchPage = page + parseInt(btn.dataset.dir, 10)
                _saveState()
                _renderSearchResults(container, results)
                container.querySelector('#disc-search-meta')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
            })
        })
    }

    // Meta bar: result count + top pagination
    if (metaEl) {
        metaEl.innerHTML = `
            <span class="disc-result-count">${total} result${total !== 1 ? 's' : ''}</span>
            ${_pagHtml('disc-top-pagination')}`
        _bindPagBtns(metaEl)
    }

    // Cards + bottom pagination (inside grid so grid-column spans)
    resultsEl.innerHTML = slice.map(_card).join('') + _pagHtml('disc-pagination')
    _bindCards(resultsEl, container)
    _bindPagBtns(resultsEl)
}

function _card(item) {
    const badge = _owned.has(item.appid)
        ? '<span class="disc-badge disc-badge--owned">Owned</span>'
        : _wishlist.has(item.appid)
        ? '<span class="disc-badge disc-badge--wish">Wishlisted</span>'
        : ''

    let priceHtml = ''
    if (item.isFree) {
        priceHtml = '<span class="disc-price disc-price--free">Free</span>'
    } else if (item.price != null) {
        if (item.discount > 0 && item.originalPrice !== null) {
            priceHtml = `
                <span class="disc-discount">-${item.discount}%</span>
                <span class="disc-price disc-price--was">$${item.originalPrice.toFixed(2)}</span>
                <span class="disc-price">$${item.price.toFixed(2)}</span>`
        } else {
            priceHtml = `<span class="disc-price">$${item.price.toFixed(2)}</span>`
        }
    }

    return `
<div class="lib-card disc-card" data-appid="${item.appid}" tabindex="0">
    <div class="lib-card-img-wrap">
        <img class="lib-card-img" src="${escapeHtml(item.headerImage)}"
             alt="${escapeHtml(item.name)}" loading="lazy"
             onerror="this.style.visibility='hidden'">
        ${badge}
    </div>
    <div class="lib-card-info">
        <span class="lib-card-name">${escapeHtml(item.name)}</span>
        <div class="disc-price-row">${priceHtml}</div>
    </div>
</div>`
}

function _bindCards(el, container) {
    el.querySelectorAll('.disc-card').forEach(card => {
        card.addEventListener('click', () => {
            const appid = card.dataset.appid
            if (appid) _navigate(`game/${appid}`)
        })
        card.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                _navigate(`game/${card.dataset.appid}`)
            }
        })
    })
}

function _showError(el, msg) {
    if (el) el.innerHTML = `<div class="disc-empty disc-error">${escapeHtml(msg)}</div>`
}

// ── Search ─────────────────────────────────────────────────────────────────────

async function _doSearch(container) {
    const q = _searchQuery.trim()
    if (!q) return

    _searchPage = 1  // reset to first page on every new search

    const metaEl = container.querySelector('#disc-search-meta')
    const el     = container.querySelector('#disc-search-results')
    if (!el) return
    if (metaEl) metaEl.innerHTML = ''
    el.innerHTML = '<div class="disc-loading">Searching…</div>'

    try {
        const res = await fetch(`/relay/api/discover/search?q=${encodeURIComponent(q)}&limit=200`)
        if (res.status === 503) {
            _showError(el, 'Search index is still loading — try again in a moment.')
            return
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const results = await res.json()
        _lastResults = results
        _saveState()
        const resEl = container.querySelector('#disc-search-results')
        if (resEl) _renderSearchResults(container, results)
    } catch (err) {
        const resEl = container.querySelector('#disc-search-results')
        _showError(resEl, `Search unavailable: ${err.message}`)
    }
}

// ── Binding ───────────────────────────────────────────────────────────────────

function _bind(container) {
    const searchEl = container.querySelector('#disc-search')
    const browse   = container.querySelector('#disc-browse')
    const panel    = container.querySelector('#disc-search-panel')

    searchEl.addEventListener('input', () => {
        _searchQuery = searchEl.value
        clearTimeout(_debounceTimer)

        if (_searchQuery.trim()) {
            _mode = 'search'
            browse.style.display = 'none'
            panel.style.display  = ''
            _debounceTimer = setTimeout(() => _doSearch(container), 350)
        } else {
            _mode        = 'browse'
            _lastResults = null
            _searchPage  = 1
            browse.style.display = ''
            panel.style.display  = 'none'
            _saveState()
        }
    })

    searchEl.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            searchEl.value = ''
            _searchQuery   = ''
            _mode          = 'browse'
            _lastResults   = null
            _searchPage    = 1
            browse.style.display = ''
            panel.style.display  = 'none'
            _saveState()
        }
    })

    // Featured tabs
    container.querySelector('#disc-featured-tabs').addEventListener('click', e => {
        const btn = e.target.closest('.disc-tab')
        if (!btn) return
        container.querySelectorAll('.disc-tab').forEach(b => b.classList.remove('disc-tab--active'))
        btn.classList.add('disc-tab--active')
        _featuredTab = btn.dataset.tab
        _saveState()
        const existing = _featuredData?.find(s => s.id === _featuredTab)
        if (existing) {
            _renderFeaturedTab(container)
        } else {
            _loadFeaturedTab(container, _featuredTab, _tabPages[_featuredTab] ?? 1)
        }
    })
}
