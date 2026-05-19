import { escapeHtml } from '../utils.js'
import { loadGameFilter } from './game-filter.js'

const PAGE_SIZE      = 48
const STORAGE_SORT   = 'gj_wl_sort'
const STORAGE_DIR    = 'gj_wl_dir'
const STORAGE_PAGE   = 'gj_wl_page'
const STORAGE_SCROLL = 'gj_wl_scroll'
const STORAGE_LETTER = 'gj_wl_letter'

const ALPHA_CHARS = ['A-Z', '#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']

let _all               = []
let _filtered          = []
let _available         = new Set()
let _query             = ''
let _sort              = 'priority'
let _dir               = 'asc'
let _page              = 1
let _letter            = null
let _hideUnavailable   = false
let _container         = null
let _debounce          = null
let _scrollDebounce    = null
let _scrollAbort       = null

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
        const [res, shouldShow, settingsRes] = await Promise.all([
            fetch('/relay/api/wishlist'),
            loadGameFilter(),
            fetch('/api/settings'),
        ])
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const raw      = await res.json()
        const settings = settingsRes.ok ? await settingsRes.json() : {}
        _hideUnavailable = settings.hideUnavailable === true
        _all = raw.filter(g => shouldShow(g.appid))
    } catch (err) {
        container.innerHTML = `<p class="page-error">Failed to load wishlist: ${escapeHtml(err.message)}</p>`
        return
    }

    _query  = ''
    _sort   = localStorage.getItem(STORAGE_SORT)   ?? 'priority'
    _dir    = localStorage.getItem(STORAGE_DIR)    ?? 'asc'
    _letter = localStorage.getItem(STORAGE_LETTER) || null
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
    const afterAvail = _hideUnavailable ? _all.filter(g => !g.store?.unavailable) : _all
    const searched = q ? afterAvail.filter(g => g.name.toLowerCase().includes(q)) : [...afterAvail]

    // Compute which letters have games (from search results, before letter filter)
    _available = new Set()
    for (const g of searched) {
        const first = g.name[0]?.toUpperCase()
        if (first && /[A-Z]/.test(first)) _available.add(first)
        else if (first)                   _available.add('#')
    }

    // Apply letter filter
    if (_letter === '#') {
        _filtered = searched.filter(g => !/^[A-Za-z]/.test(g.name))
    } else if (_letter) {
        _filtered = searched.filter(g => g.name.toUpperCase().startsWith(_letter))
    } else {
        _filtered = searched
    }

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
            case 'release': {
                // comingSoon with no parseable date → treat as far future so they lead on desc
                const fallback = flip === -1 ? '9999-99-99' : '0000-00-00'
                const ra = a.store?.releaseDateIso ?? (a.store?.comingSoon ? '9999-99-99' : fallback)
                const rb = b.store?.releaseDateIso ?? (b.store?.comingSoon ? '9999-99-99' : fallback)
                return flip * ra.localeCompare(rb)
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
                <option value="release"  ${_sort === 'release'  ? 'selected' : ''}>Release Date</option>
            </select>
            <button id="wl-dir" class="lib-dir-btn" title="${_dir === 'asc' ? 'Ascending' : 'Descending'}">${_dir === 'asc' ? '↑' : '↓'}</button>
            <div id="wl-pager" class="lib-pager">${_buildPager(totalPages, '')}</div>
        </div>
        ${_buildAlphaBar('wl-alpha')}
        <div id="wl-grid" class="lib-grid">${_buildGrid()}</div>
        <div class="lib-bottom-row">
            <button class="lib-back-top" id="wl-back-top">&#8593; Back to top</button>
            <div id="wl-pager-b" class="lib-pager">${_buildPager(totalPages, 'b')}</div>
        </div>`

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
        _dir  = (_sort === 'discount' || _sort === 'release') ? 'desc' : 'asc'
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
    _bindAlpha('wl-alpha')

    _container.querySelector('#wl-back-top')?.addEventListener('click', () => {
        _container.scrollTo({ top: 0, behavior: 'smooth' })
    })

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
    _container.querySelector('#wl-pager').innerHTML       = _buildPager(totalPages, '')
    _container.querySelector('#wl-pager-b').innerHTML     = _buildPager(totalPages, 'b')
    _container.querySelector('#wl-alpha').innerHTML       = _buildAlphaButtons()
    _bindPager()
}

function _subtitleText() {
    const total   = _all.length
    const showing = _filtered.length
    const pages   = Math.max(1, Math.ceil(showing / PAGE_SIZE))
    if (_query) return `${showing} of ${total} games — page ${_page} of ${pages}`
    return `${total} games — page ${_page} of ${pages}`
}

function _buildAlphaButtons() {
    return ALPHA_CHARS.map(ch => {
        const active   = (_letter === null && ch === 'A-Z') || _letter === ch
        const disabled = ch !== 'A-Z' && !_available.has(ch) ? 'disabled' : ''
        return `<button class="lib-alpha-btn${active ? ' lib-alpha-btn--active' : ''}" data-letter="${ch}" ${disabled}>${ch}</button>`
    }).join('')
}

function _buildAlphaBar(id) {
    return `<div class="lib-alpha" id="${id}">${_buildAlphaButtons()}</div>`
}

function _bindAlpha(id) {
    _container.querySelector(`#${id}`)?.addEventListener('click', e => {
        const btn = e.target.closest('.lib-alpha-btn')
        if (!btn || btn.disabled) return
        const ch = btn.dataset.letter
        _letter = ch === 'A-Z' ? null : ch
        localStorage.setItem(STORAGE_LETTER, _letter ?? '')
        _page = 1
        localStorage.setItem(STORAGE_PAGE, '1')
        _applyFilter()
        _redraw()
    })
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
    const unavailableHtml = game.store?.unavailable
        ? `<span class="wl-card-unavailable">Unavailable</span>`
        : ''
    const localHtml = game.wishlist?.local
        ? `<span class="wl-card-local">Local Wishlist</span>`
        : ''

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
        <a class="lib-card${game.store?.unavailable ? ' lib-card--unavailable' : ''}" href="/game/${game.appid}">
            <div class="lib-card-img-wrap">
                <img class="lib-card-img" src="${imgSrc}" alt="${escapeHtml(game.name)}" loading="lazy">
                ${unavailableHtml}
                ${localHtml}
            </div>
            <div class="lib-card-info">
                <span class="lib-card-name">${escapeHtml(game.name)}</span>
                ${priceHtml}
            </div>
        </a>`
}

function _buildPager(totalPages, suffix = '') {
    if (totalPages <= 1) return ''
    const s = suffix ? `-${suffix}` : ''
    const prevDisabled = _page <= 1          ? 'disabled' : ''
    const nextDisabled = _page >= totalPages ? 'disabled' : ''
    return `
        <button id="wl-prev${s}" class="lib-pager-btn" ${prevDisabled}>&#8592; Prev</button>
        <span class="lib-pager-info">Page ${_page} of ${totalPages}</span>
        <button id="wl-next${s}" class="lib-pager-btn" ${nextDisabled}>Next &#8594;</button>`
}

function _updateDirBtn() {
    const btn = _container.querySelector('#wl-dir')
    if (!btn) return
    btn.textContent = _dir === 'asc' ? '↑' : '↓'
    btn.title = _dir === 'asc' ? 'Ascending' : 'Descending'
}

function _page_prev() {
    _page--
    localStorage.setItem(STORAGE_PAGE, String(_page))
    localStorage.removeItem(STORAGE_SCROLL)
    _redraw()
    _container.scrollTo(0, 0)
}

function _page_next() {
    _page++
    localStorage.setItem(STORAGE_PAGE, String(_page))
    localStorage.removeItem(STORAGE_SCROLL)
    _redraw()
    _container.scrollTo(0, 0)
}

function _bindPager() {
    _container.querySelector('#wl-prev')  ?.addEventListener('click', _page_prev)
    _container.querySelector('#wl-next')  ?.addEventListener('click', _page_next)
    _container.querySelector('#wl-prev-b')?.addEventListener('click', _page_prev)
    _container.querySelector('#wl-next-b')?.addEventListener('click', _page_next)
}
