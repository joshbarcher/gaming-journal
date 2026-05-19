import { escapeHtml } from '../utils.js'

const GENRES = [
    'Action', 'Adventure', 'Casual', 'Free to Play', 'Indie',
    'Massively Multiplayer', 'Racing', 'RPG', 'Simulation', 'Sports', 'Strategy',
]

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

let _mode         = 'browse'  // 'browse' | 'search'
let _featuredTab  = 'new_releases'
let _genre        = ''
let _searchQuery  = ''
let _debounceTimer = null

let _featuredData = null  // sections array from /featured
let _genreData    = null  // tabs array from /genre/:genre
let _genreTabId   = ''

// ── Entry point ───────────────────────────────────────────────────────────────

export async function renderDiscover(container, navigate) {
    _navigate = navigate
    container.innerHTML = _skeleton()
    _bind(container)
    _loadOwnership()
    _loadFeatured(container)
}

// ── Templates ─────────────────────────────────────────────────────────────────

function _skeleton() {
    const genreOptions = GENRES.map(g =>
        `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`
    ).join('')

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
        <div class="disc-browse-header">
            <div id="disc-featured-tabs" class="disc-tabs">
                ${featuredTabsHtml}
            </div>
            <div class="disc-genre-wrap">
                <select id="disc-genre" class="disc-genre">
                    <option value="">Browse by genre…</option>
                    ${genreOptions}
                </select>
            </div>
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
        _renderFeaturedTab(container)
    } catch (err) {
        _showError(container.querySelector('#disc-results'), 'Failed to load featured games.')
    }
}

async function _loadGenre(container, genre) {
    const resultsEl = container.querySelector('#disc-results')
    resultsEl.innerHTML = '<div class="disc-loading">Loading…</div>'
    _genreData  = null
    _genreTabId = ''
    try {
        const res = await fetch(`/relay/api/discover/genre/${encodeURIComponent(genre)}`)
        if (!res.ok) throw new Error(`${res.status}`)
        _genreData  = await res.json()
        _genreTabId = _genreData[0]?.id ?? ''
        _renderGenreResults(container)
    } catch {
        _showError(resultsEl, `Failed to load ${genre} games.`)
    }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function _renderFeaturedTab(container) {
    const resultsEl = container.querySelector('#disc-results')
    if (!_featuredData) return
    const section = _featuredData.find(s => s.id === _featuredTab)
    if (!section) { resultsEl.innerHTML = '<div class="disc-empty">No data for this section.</div>'; return }
    resultsEl.innerHTML = section.items.map(_card).join('')
    _bindCards(resultsEl, container)
}

function _renderGenreResults(container) {
    const resultsEl = container.querySelector('#disc-results')
    if (!_genreData) return
    const tab = _genreData.find(t => t.id === _genreTabId) ?? _genreData[0]
    if (!tab) { resultsEl.innerHTML = '<div class="disc-empty">No results.</div>'; return }

    const subtabsHtml = _genreData.map(t =>
        `<button class="disc-subtab${t.id === tab.id ? ' disc-subtab--active' : ''}" data-subtab="${t.id}">${escapeHtml(t.label)}</button>`
    ).join('')

    resultsEl.innerHTML = `
        <div class="disc-subtabs">${subtabsHtml}</div>
        <div id="disc-genre-items" class="disc-subgrid">${tab.items.map(_card).join('')}</div>`

    resultsEl.querySelectorAll('.disc-subtab').forEach(btn => {
        btn.addEventListener('click', () => {
            _genreTabId = btn.dataset.subtab
            const newTab = _genreData.find(t => t.id === _genreTabId)
            if (!newTab) return
            resultsEl.querySelectorAll('.disc-subtab').forEach(b => b.classList.toggle('disc-subtab--active', b === btn))
            const items = resultsEl.querySelector('#disc-genre-items')
            if (items) {
                items.innerHTML = newTab.items.map(_card).join('')
                _bindCards(items, container)
            }
        })
    })

    _bindCards(resultsEl, container)
}

function _renderSearchResults(container, results) {
    console.log('[discover] _renderSearchResults', results.length)
    const el = container.querySelector('#disc-search-results')
    if (!results.length) {
        el.innerHTML = `<div class="disc-empty">No results for "${escapeHtml(_searchQuery)}".</div>`
        return
    }
    try {
        const html = results.map((item, i) => {
            try {
                return _card(item)
            } catch (err) {
                console.error('[discover] _card failed at index', i, item, err)
                return ''
            }
        }).join('')
        console.log('[discover] html generated, length', html.length)
        el.innerHTML = html
        _bindCards(el, container)
        console.log('[discover] render complete')
    } catch (err) {
        console.error('[discover] render error', err)
        _showError(el, `Render error: ${err.message}`)
    }
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
        console.log('[discover] fetching search', q)
        const res = await fetch(`/relay/api/discover/search?q=${encodeURIComponent(q)}&limit=80`)
        console.log('[discover] search response status', res.status)
        if (res.status === 503) {
            _showError(el, 'Search index is still loading — try again in a moment.')
            return
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const results = await res.json()
        console.log('[discover] search results count', results.length, results[0])
        const resEl = container.querySelector('#disc-search-results')
        console.log('[discover] resEl found', !!resEl)
        if (resEl) {
            console.log('[discover] calling _renderSearchResults')
            _renderSearchResults(container, results)
            console.log('[discover] _renderSearchResults done')
        }
    } catch (err) {
        console.error('[discover] search error', err)
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
            _mode = 'browse'
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
        _genre       = ''
        _genreData   = null
        container.querySelector('#disc-genre').value = ''
        container.querySelectorAll('.disc-tab').forEach(b => b.classList.remove('disc-tab--active'))
        btn.classList.add('disc-tab--active')
        _featuredTab = btn.dataset.tab
        if (_featuredData) _renderFeaturedTab(container)
    })

    // Genre select
    container.querySelector('#disc-genre').addEventListener('change', e => {
        _genre = e.target.value
        if (!_genre) {
            // Back to featured
            container.querySelectorAll('.disc-tab').forEach((b, i) => b.classList.toggle('disc-tab--active', i === 0))
            _featuredTab = FEATURED_TABS[0].id
            if (_featuredData) _renderFeaturedTab(container)
            return
        }
        // Clear featured tab selection when genre is picked
        container.querySelectorAll('.disc-tab').forEach(b => b.classList.remove('disc-tab--active'))
        _loadGenre(container, _genre)
    })
}
