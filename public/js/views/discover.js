import { escapeHtml } from '../utils.js'

const FEATURED_TABS = [
    { id: 'new_releases', label: 'New Releases' },
    { id: 'top_sellers',  label: 'Top Sellers'  },
    { id: 'coming_soon',  label: 'Coming Soon'  },
    { id: 'specials',     label: 'On Sale'       },
]

let _navigate = null
let _owned    = new Set()
let _wishlist = new Set()

// ── State ────────────────────────────────────────────────────────────────────

let _mode          = 'browse'  // 'browse' | 'search'
let _featuredTab   = 'new_releases'
let _searchQuery   = ''
let _debounceTimer = null

let _featuredData = null  // sections array from /featured (each has { id, label, items, page, pages, total })
let _tabPages     = {}    // tab → last loaded page
let _lastResults  = null  // cached search results for back-navigation

// ── Entry point ───────────────────────────────────────────────────────────────

export async function renderDiscover(container, navigate) {
    _navigate = navigate
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
        <div id="disc-featured-tabs" class="disc-tabs">
            ${featuredTabsHtml}
        </div>
        <div id="disc-results" class="disc-grid">
            <div class="disc-loading">Loading…</div>
        </div>
    </div>

    <div id="disc-search-panel" class="disc-browse" style="display:none">
        <div id="disc-search-results" class="disc-grid"></div>
    </div>
</div>`
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function _loadOwnership() {
    try {
        const res = await fetch('/relay/api/games')
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
        _renderFeaturedTab(container)
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
        _renderFeaturedTab(container)
    } catch {
        _showError(resultsEl, `Failed to load page ${page}.`)
    }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function _renderFeaturedTab(container) {
    const resultsEl = container.querySelector('#disc-results')
    if (!_featuredData) return
    const section = _featuredData.find(s => s.id === _featuredTab)
    if (!section) { resultsEl.innerHTML = '<div class="disc-empty">No data for this section.</div>'; return }

    const { items, page, pages } = section
    if (!items.length) {
        resultsEl.innerHTML = '<div class="disc-empty">No results yet — check back soon.</div>'
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
}

function _renderSearchResults(container, results) {
    const el = container.querySelector('#disc-search-results')
    if (!results.length) {
        el.innerHTML = `<div class="disc-empty">No results for "${escapeHtml(_searchQuery)}".</div>`
        return
    }
    el.innerHTML = results.map(_card).join('')
    _bindCards(el, container)
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

    const el = container.querySelector('#disc-search-results')
    if (!el) return
    el.innerHTML = '<div class="disc-loading">Searching…</div>'

    try {
        const res = await fetch(`/relay/api/discover/search?q=${encodeURIComponent(q)}&limit=80`)
        if (res.status === 503) {
            _showError(el, 'Search index is still loading — try again in a moment.')
            return
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const results = await res.json()
        _lastResults = results
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
            browse.style.display = ''
            panel.style.display  = 'none'
        }
    })

    searchEl.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            searchEl.value = ''
            _searchQuery   = ''
            _mode = 'browse'
            browse.style.display = ''
            panel.style.display  = 'none'
        }
    })

    // Featured tabs
    container.querySelector('#disc-featured-tabs').addEventListener('click', e => {
        const btn = e.target.closest('.disc-tab')
        if (!btn) return
        container.querySelectorAll('.disc-tab').forEach(b => b.classList.remove('disc-tab--active'))
        btn.classList.add('disc-tab--active')
        _featuredTab = btn.dataset.tab
        const existing = _featuredData?.find(s => s.id === _featuredTab)
        if (existing) {
            _renderFeaturedTab(container)
        } else {
            _loadFeaturedTab(container, _featuredTab, _tabPages[_featuredTab] ?? 1)
        }
    })
}
