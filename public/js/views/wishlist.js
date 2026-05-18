import { escapeHtml } from '../utils.js'
import { loadGameFilter } from './game-filter.js'

const PAGE_SIZE     = 48
const STORAGE_SORT  = 'gj_wl_sort'
const STORAGE_DIR   = 'gj_wl_dir'
const STORAGE_PAGE  = 'gj_wl_page'
const STORAGE_SCROLL = 'gj_wl_scroll'

let _all           = []
let _filtered      = []
let _query         = ''
let _sort          = 'priority'
let _dir           = 'asc'
let _page          = 1
let _container     = null
let _debounce      = null
let _scrollDebounce = null
let _scrollAbort   = null

export async function renderWishlist(container) {
    // Abort any previous scroll listener FIRST — before innerHTML is touched.
    // Without this, the old listener fires when the page collapses and saves scrollTop=0.
    if (_scrollAbort) { _scrollAbort.abort(); _scrollAbort = null }

    _container = container

    // Read persisted state BEFORE touching innerHTML — setting innerHTML collapses
    // the page height, which fires a scroll event on the still-attached listener
    // from the previous visit, which would overwrite STORAGE_SCROLL with 0.
    const restoredPage   = parseInt(localStorage.getItem(STORAGE_PAGE)   ?? '1', 10) || 1
    const restoredScroll = parseInt(localStorage.getItem(STORAGE_SCROLL) ?? '0', 10)


    container.innerHTML = `<p class="page-loading">Loading wishlist…</p>`

    try {
        const [res, shouldShow] = await Promise.all([
            fetch('/relay/api/wishlist'),
            loadGameFilter(),
        ])
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const raw = await res.json()
        _all = raw.filter(g => shouldShow(g.appid))
    } catch (err) {
        container.innerHTML = `<p class="page-error">Failed to load wishlist: ${escapeHtml(err.message)}</p>`
        return
    }

    _query = ''
    _sort  = localStorage.getItem(STORAGE_SORT) ?? 'priority'
    _dir   = localStorage.getItem(STORAGE_DIR)  ?? 'asc'
    _applyFilter()
    // Restore page after _applyFilter (which resets _page to 1)
    _page = restoredPage
    _draw()

    if (restoredScroll > 0) {
        requestAnimationFrame(() => { _container.scrollTop = restoredScroll })
    }
}

function _applyFilter() {
    const q = _query.toLowerCase()
    _filtered = q
        ? _all.filter(g => g.name.toLowerCase().includes(q))
        : [..._all]

    const flip = _dir === 'asc' ? 1 : -1

    _filtered.sort((a, b) => {
        switch (_sort) {
            case 'price': {
                const pa = a.itad?.bestPrice?.price ?? Infinity
                const pb = b.itad?.bestPrice?.price ?? Infinity
                return flip * (pa - pb)
            }
            case 'discount': {
                const da = a.itad?.bestPrice?.cut ?? 0
                const db = b.itad?.bestPrice?.cut ?? 0
                return flip * (da - db)
            }
            case 'added': {
                const ta = a.wishlist?.dateAdded ?? 0
                const tb = b.wishlist?.dateAdded ?? 0
                return flip * (ta - tb)
            }
            case 'priority': {
                const pa = a.wishlist?.priority ?? 9999
                const pb = b.wishlist?.priority ?? 9999
                return flip * (pa - pb)
            }
            default: // name
                return flip * a.name.localeCompare(b.name)
        }
    })

    _page = 1
    localStorage.setItem(STORAGE_PAGE, '1')
    localStorage.removeItem(STORAGE_SCROLL)
}

function _draw() {
    const totalPages = Math.max(1, Math.ceil(_filtered.length / PAGE_SIZE))

    _container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title lib-title">Wishlist</h1>
            <p class="page-subtitle lib-subtitle">${_subtitleText()}</p>
        </div>
        <div class="lib-controls">
            <input
                id="wl-search"
                class="lib-search"
                type="search"
                placeholder="Search wishlist…"
                value="${escapeHtml(_query)}"
                autocomplete="off"
            >
            <select id="wl-sort" class="lib-sort">
                <option value="priority" ${_sort === 'priority' ? 'selected' : ''}>Priority</option>
                <option value="name"     ${_sort === 'name'     ? 'selected' : ''}>A – Z</option>
                <option value="price"    ${_sort === 'price'    ? 'selected' : ''}>Price</option>
                <option value="discount" ${_sort === 'discount' ? 'selected' : ''}>Discount</option>
                <option value="added"    ${_sort === 'added'    ? 'selected' : ''}>Date Added</option>
            </select>
            <button id="wl-dir" class="lib-dir-btn" title="${_dir === 'asc' ? 'Ascending' : 'Descending'}">${_dir === 'asc' ? '↑' : '↓'}</button>
        </div>
        <div id="wl-grid" class="lib-grid">${_buildGrid()}</div>
        <div id="wl-pager" class="lib-pager">${_buildPager(totalPages)}</div>`

    _container.querySelector('#wl-search').addEventListener('input', e => {
        clearTimeout(_debounce)
        _debounce = setTimeout(() => {
            _query = e.target.value
            _applyFilter()
            _redraw()
        }, 200)
    })

    _container.querySelector('#wl-sort').addEventListener('change', e => {
        _sort = e.target.value
        _dir  = (_sort === 'discount') ? 'desc' : 'asc'
        localStorage.setItem(STORAGE_SORT, _sort)
        localStorage.setItem(STORAGE_DIR,  _dir)
        _applyFilter()
        _redraw()
        _updateDirBtn()
    })

    _container.querySelector('#wl-dir').addEventListener('click', () => {
        _dir = _dir === 'asc' ? 'desc' : 'asc'
        localStorage.setItem(STORAGE_DIR, _dir)
        _applyFilter()
        _redraw()
        _updateDirBtn()
    })

    _bindPager()

    _scrollAbort = new AbortController()
    _container.addEventListener('scroll', () => {
        // Guard: if wishlist is no longer the active view (e.g. game page replaced
        // our content), don't overwrite the saved scroll position.
        if (!_container.querySelector('#wl-grid')) return
        clearTimeout(_scrollDebounce)
        _scrollDebounce = setTimeout(() => {
localStorage.setItem(STORAGE_SCROLL, String(Math.round(_container.scrollTop)))
        }, 150)
    }, { passive: true, signal: _scrollAbort.signal })
}

function _redraw() {
    const totalPages = Math.max(1, Math.ceil(_filtered.length / PAGE_SIZE))
    _container.querySelector('.lib-subtitle').textContent = _subtitleText()
    _container.querySelector('#wl-grid').innerHTML        = _buildGrid()
    _container.querySelector('#wl-pager').innerHTML       = _buildPager(totalPages)
    _bindPager()
}

function _subtitleText() {
    const total   = _all.length
    const showing = _filtered.length
    const pages   = Math.max(1, Math.ceil(showing / PAGE_SIZE))
    if (_query) return `${showing} of ${total} games — page ${_page} of ${pages}`
    return `${total} games — page ${_page} of ${pages}`
}

function _buildGrid() {
    const start = (_page - 1) * PAGE_SIZE
    const slice = _filtered.slice(start, start + PAGE_SIZE)
    if (slice.length === 0) return `<p class="lib-empty">No games match your search.</p>`
    return slice.map(_buildCard).join('')
}

function _buildCard(game) {
    const imgSrc    = `/relay/images/steam/games/${game.appid}/header.jpg`
    const bp     = game.itad?.bestPrice
    const retail = game.store?.price

    let priceHtml
    if (bp) {
        const priceStr = bp.price === 0 ? 'Free' : `$${bp.price.toFixed(2)}`
        const cutHtml  = bp.cut > 0 ? ` <span class="wl-card-cut">-${bp.cut}%</span>` : ''
        priceHtml = `<p class="wl-card-price-line"><span class="wl-card-price">${priceStr}</span><span class="wl-card-sep">·</span><span class="wl-card-store">${escapeHtml(bp.store)}</span>${cutHtml}</p>`
    } else if (game.store?.isFree) {
        priceHtml = `<p class="wl-card-price-line"><span class="wl-card-price">Free</span></p>`
    } else if (retail) {
        priceHtml = `<p class="wl-card-price-line"><span class="wl-card-price wl-card-price--retail">${escapeHtml(retail.formatted)}</span></p>`
    } else {
        priceHtml = `<p class="wl-card-price-line wl-card-price--none">No price data</p>`
    }

    return `
        <a class="lib-card" href="/game/${game.appid}">
            <div class="lib-card-img-wrap">
                <img class="lib-card-img" src="${imgSrc}" alt="${escapeHtml(game.name)}" loading="lazy">
            </div>
            <div class="lib-card-info">
                <span class="lib-card-name">${escapeHtml(game.name)}</span>
                ${priceHtml}
            </div>
        </a>`
}

function _buildPager(totalPages) {
    if (totalPages <= 1) return ''
    const prevDisabled = _page <= 1          ? 'disabled' : ''
    const nextDisabled = _page >= totalPages ? 'disabled' : ''
    return `
        <button id="wl-prev" class="lib-pager-btn" ${prevDisabled}>&#8592; Prev</button>
        <span class="lib-pager-info">Page ${_page} of ${totalPages}</span>
        <button id="wl-next" class="lib-pager-btn" ${nextDisabled}>Next &#8594;</button>`
}

function _updateDirBtn() {
    const btn = _container.querySelector('#wl-dir')
    if (!btn) return
    btn.textContent = _dir === 'asc' ? '↑' : '↓'
    btn.title = _dir === 'asc' ? 'Ascending' : 'Descending'
}

function _bindPager() {
    const prev = _container.querySelector('#wl-prev')
    const next = _container.querySelector('#wl-next')
    if (prev) prev.addEventListener('click', () => {
        _page--
        localStorage.setItem(STORAGE_PAGE, String(_page))
        localStorage.removeItem(STORAGE_SCROLL)
        _redraw()
        _container.scrollTo(0, 0)
    })
    if (next) next.addEventListener('click', () => {
        _page++
        localStorage.setItem(STORAGE_PAGE, String(_page))
        localStorage.removeItem(STORAGE_SCROLL)
        _redraw()
        _container.scrollTo(0, 0)
    })
}
