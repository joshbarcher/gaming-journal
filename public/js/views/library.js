import { escapeHtml } from '../utils.js'
import { loadGameFilter } from './game-filter.js'

const PAGE_SIZE      = 48
const STORAGE_SORT   = 'gj_lib_sort'
const STORAGE_DIR    = 'gj_lib_dir'
const STORAGE_PAGE   = 'gj_lib_page'
const STORAGE_QUERY  = 'gj_lib_query'
const STORAGE_SCROLL = 'gj_lib_scroll'
const STORAGE_LETTER = 'gj_lib_letter'

const ALPHA_CHARS = ['A-Z', '#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']

let _all            = []
let _filtered       = []
let _available      = new Set()
let _query          = ''
let _sort           = 'name'
let _dir            = 'asc'
let _page           = 1
let _letter         = null
let _container      = null
let _debounce       = null
let _scrollDebounce = null
let _scrollAbort    = null

export async function renderLibrary(container) {
    // Abort any previous scroll listener FIRST — before innerHTML is touched.
    if (_scrollAbort) { _scrollAbort.abort(); _scrollAbort = null }

    _container = container

    // Read persisted scroll BEFORE touching innerHTML — setting innerHTML collapses
    // page height, firing a scroll event on the still-attached listener from the
    // previous visit, which would overwrite STORAGE_SCROLL with 0.
    const savedScroll = Number(localStorage.getItem(STORAGE_SCROLL) ?? 0)


    container.innerHTML = `<p class="page-loading">Loading library…</p>`

    try {
        const [gamesRes, shouldShow] = await Promise.all([
            fetch('/relay/api/steam/games'),
            loadGameFilter(),
        ])
        if (!gamesRes.ok) throw new Error(`Games HTTP ${gamesRes.status}`)
        const json = await gamesRes.json()
        // unwrap common envelope shapes
        if (Array.isArray(json)) {
            _all = json
        } else if (Array.isArray(json.games)) {
            _all = json.games
        } else if (Array.isArray(json.data)) {
            _all = json.data
        } else if (json.response && Array.isArray(json.response.games)) {
            _all = json.response.games
        } else {
            throw new Error(`Unexpected response shape: ${JSON.stringify(json).slice(0, 120)}`)
        }
        _all = _all.filter(g => shouldShow(g.appid))
    } catch (err) {
        container.innerHTML = `<p class="page-error">Failed to load library: ${escapeHtml(err.message)}</p>`
        return
    }

    _query  = localStorage.getItem(STORAGE_QUERY)  ?? ''
    _sort   = localStorage.getItem(STORAGE_SORT)   ?? 'name'
    _dir    = localStorage.getItem(STORAGE_DIR)    ?? 'asc'
    _page   = Number(localStorage.getItem(STORAGE_PAGE) ?? 1)
    _letter = localStorage.getItem(STORAGE_LETTER) || null
    _applyFilter()
    const totalPages = Math.max(1, Math.ceil(_filtered.length / PAGE_SIZE))
    if (_page > totalPages) _page = totalPages
    _draw()
    if (savedScroll > 0) requestAnimationFrame(() => _container.scrollTop = savedScroll)
}

function _applyFilter() {
    const q = _query.toLowerCase()
    const searched = q ? _all.filter(g => g.name.toLowerCase().includes(q)) : [..._all]

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
    if (_sort === 'playtime') {
        _filtered.sort((a, b) => flip * ((a.playtime_forever ?? 0) - (b.playtime_forever ?? 0)))
    } else if (_sort === 'recent') {
        _filtered.sort((a, b) => flip * ((a.rtime_last_played ?? 0) - (b.rtime_last_played ?? 0)))
    } else {
        _filtered.sort((a, b) => flip * a.name.localeCompare(b.name))
    }
}

function _draw() {
    const totalPages = Math.max(1, Math.ceil(_filtered.length / PAGE_SIZE))

    _container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title lib-title">Steam Library</h1>
            <p class="page-subtitle lib-subtitle">${_subtitleText()}</p>
        </div>
        <div class="lib-controls">
            <input
                id="lib-search"
                class="lib-search"
                type="search"
                placeholder="Search games…"
                value="${escapeHtml(_query)}"
                autocomplete="off"
            >
            <select id="lib-sort" class="lib-sort">
                <option value="name"     ${_sort === 'name'     ? 'selected' : ''}>A – Z</option>
                <option value="playtime" ${_sort === 'playtime' ? 'selected' : ''}>Most Played</option>
                <option value="recent"   ${_sort === 'recent'   ? 'selected' : ''}>Recently Played</option>
            </select>
            <button id="lib-dir" class="lib-dir-btn" title="${_dir === 'asc' ? 'Ascending' : 'Descending'}">${_dir === 'asc' ? '↑' : '↓'}</button>
            <div id="lib-pager" class="lib-pager">${_buildPager(totalPages, '')}</div>
        </div>
        ${_buildAlphaBar('lib-alpha')}
        <div id="lib-grid" class="lib-grid">${_buildGrid()}</div>
        <div class="lib-bottom-row">
            <button class="lib-back-top" id="lib-back-top">&#8593; Back to top</button>
            <div id="lib-pager-b" class="lib-pager">${_buildPager(totalPages, 'b')}</div>
        </div>`

    _container.querySelector('#lib-search').addEventListener('input', e => {
        clearTimeout(_debounce)
        _debounce = setTimeout(() => {
            _query = e.target.value
            _page  = 1
            localStorage.setItem(STORAGE_QUERY, _query)
            localStorage.setItem(STORAGE_PAGE,  _page)
            _applyFilter()
            _redraw()
        }, 200)
    })

    _container.querySelector('#lib-sort').addEventListener('change', e => {
        _sort = e.target.value
        _dir  = (_sort === 'name') ? 'asc' : 'desc'
        _page = 1
        localStorage.setItem(STORAGE_SORT,  _sort)
        localStorage.setItem(STORAGE_DIR,   _dir)
        localStorage.setItem(STORAGE_PAGE,  _page)
        _applyFilter()
        _redraw()
        _updateDirBtn()
    })

    _container.querySelector('#lib-dir').addEventListener('click', () => {
        _dir  = _dir === 'asc' ? 'desc' : 'asc'
        _page = 1
        localStorage.setItem(STORAGE_DIR,  _dir)
        localStorage.setItem(STORAGE_PAGE, _page)
        _applyFilter()
        _redraw()
        _updateDirBtn()
    })

    _bindAlpha('lib-alpha')

    _container.querySelector('#lib-back-top')?.addEventListener('click', () => {
        _container.scrollTo({ top: 0, behavior: 'smooth' })
    })

    _scrollAbort = new AbortController()
    _container.addEventListener('scroll', () => {
        // Guard: if library is no longer the active view, don't overwrite saved scroll.
        if (!_container.querySelector('#lib-grid')) return
        clearTimeout(_scrollDebounce)
        _scrollDebounce = setTimeout(() => {
localStorage.setItem(STORAGE_SCROLL, _container.scrollTop)
        }, 150)
    }, { signal: _scrollAbort.signal })

    _bindPager()
}

function _redraw() {
    const totalPages = Math.max(1, Math.ceil(_filtered.length / PAGE_SIZE))
    _container.querySelector('.lib-subtitle').textContent  = _subtitleText()
    _container.querySelector('#lib-grid').innerHTML        = _buildGrid()
    _container.querySelector('#lib-pager').innerHTML       = _buildPager(totalPages, '')
    _container.querySelector('#lib-pager-b').innerHTML     = _buildPager(totalPages, 'b')
    _container.querySelector('#lib-alpha').innerHTML       = _buildAlphaButtons()
    _bindPager()
}

function _subtitleText() {
    const total    = _all.length
    const showing  = _filtered.length
    const pages    = Math.max(1, Math.ceil(showing / PAGE_SIZE))
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
    const start  = (_page - 1) * PAGE_SIZE
    const slice  = _filtered.slice(start, start + PAGE_SIZE)
    if (slice.length === 0) return `<p class="lib-empty">No games match your search.</p>`
    return slice.map(_buildCard).join('')
}

function _fmtPlaytime(minutes) {
    if (!minutes) return null
    const h = Math.floor(minutes / 60)
    if (h === 0) return `${minutes}m`
    return `${h.toLocaleString()} hrs`
}

function _buildCard(game) {
    const timeStr  = _fmtPlaytime(game.playtime_forever ?? 0)
    const imgSrc   = `/relay/images/steam/games/${game.appid}/header.jpg`
    const hoursEl  = timeStr
        ? `<span class="lib-card-hours">${timeStr}</span>`
        : `<span class="lib-card-hours lib-card-hours--zero">Not played</span>`

    return `
        <a class="lib-card" href="/game/${game.appid}">
            <div class="lib-card-img-wrap">
                <img class="lib-card-img" src="${imgSrc}" alt="${escapeHtml(game.name)}" loading="lazy">
            </div>
            <div class="lib-card-info">
                <span class="lib-card-name">${escapeHtml(game.name)}</span>
                ${hoursEl}
            </div>
        </a>`
}

function _buildPager(totalPages, suffix = '') {
    if (totalPages <= 1) return ''
    const s   = suffix ? `-${suffix}` : ''
    const prevDisabled = _page <= 1          ? 'disabled' : ''
    const nextDisabled = _page >= totalPages ? 'disabled' : ''
    return `
        <button id="lib-prev${s}" class="lib-pager-btn" ${prevDisabled}>&#8592; Prev</button>
        <span class="lib-pager-info">Page ${_page} of ${totalPages}</span>
        <button id="lib-next${s}" class="lib-pager-btn" ${nextDisabled}>Next &#8594;</button>`
}

function _updateDirBtn() {
    const btn = _container.querySelector('#lib-dir')
    if (!btn) return
    btn.textContent = _dir === 'asc' ? '↑' : '↓'
    btn.title = _dir === 'asc' ? 'Ascending' : 'Descending'
}

function _page_prev() {
    _page--
    localStorage.setItem(STORAGE_PAGE, _page)
    localStorage.setItem(STORAGE_SCROLL, 0)
    _redraw()
    _container.scrollTo(0, 0)
}

function _page_next() {
    _page++
    localStorage.setItem(STORAGE_PAGE, _page)
    localStorage.setItem(STORAGE_SCROLL, 0)
    _redraw()
    _container.scrollTo(0, 0)
}

function _bindPager() {
    _container.querySelector('#lib-prev')  ?.addEventListener('click', _page_prev)
    _container.querySelector('#lib-next')  ?.addEventListener('click', _page_next)
    _container.querySelector('#lib-prev-b')?.addEventListener('click', _page_prev)
    _container.querySelector('#lib-next-b')?.addEventListener('click', _page_next)
}
