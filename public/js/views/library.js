import { escapeHtml } from '../utils.js'

const PAGE_SIZE = 48

let _all       = []
let _filtered  = []
let _query     = ''
let _sort      = 'name'
let _page      = 1
let _container = null
let _debounce  = null

export async function renderLibrary(container) {
    _container = container
    container.innerHTML = `<p class="page-loading">Loading library…</p>`

    try {
        const gamesRes = await fetch('/relay/api/steam/games')
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
    } catch (err) {
        container.innerHTML = `<p class="page-error">Failed to load library: ${escapeHtml(err.message)}</p>`
        return
    }

    _query = ''
    _sort  = 'name'
    _page  = 1
    _applyFilter()
    _draw()
}

function _applyFilter() {
    const q = _query.toLowerCase()
    _filtered = q
        ? _all.filter(g => g.name.toLowerCase().includes(q))
        : [..._all]

    if (_sort === 'playtime') {
        _filtered.sort((a, b) => (b.playtime_forever ?? 0) - (a.playtime_forever ?? 0))
    } else if (_sort === 'recent') {
        _filtered.sort((a, b) => (b.rtime_last_played ?? 0) - (a.rtime_last_played ?? 0))
    } else {
        _filtered.sort((a, b) => a.name.localeCompare(b.name))
    }

    _page = 1
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
        </div>
        <div id="lib-grid" class="lib-grid">${_buildGrid()}</div>
        <div id="lib-pager" class="lib-pager">${_buildPager(totalPages)}</div>`

    _container.querySelector('#lib-search').addEventListener('input', e => {
        clearTimeout(_debounce)
        _debounce = setTimeout(() => {
            _query = e.target.value
            _applyFilter()
            _redraw()
        }, 200)
    })

    _container.querySelector('#lib-sort').addEventListener('change', e => {
        _sort = e.target.value
        _applyFilter()
        _redraw()
    })

    _bindPager()
}

function _redraw() {
    const totalPages = Math.max(1, Math.ceil(_filtered.length / PAGE_SIZE))
    _container.querySelector('.lib-subtitle').textContent  = _subtitleText()
    _container.querySelector('#lib-grid').innerHTML        = _buildGrid()
    _container.querySelector('#lib-pager').innerHTML       = _buildPager(totalPages)
    _bindPager()
}

function _subtitleText() {
    const total    = _all.length
    const showing  = _filtered.length
    const pages    = Math.max(1, Math.ceil(showing / PAGE_SIZE))
    if (_query) return `${showing} of ${total} games — page ${_page} of ${pages}`
    return `${total} games — page ${_page} of ${pages}`
}

function _buildGrid() {
    const start  = (_page - 1) * PAGE_SIZE
    const slice  = _filtered.slice(start, start + PAGE_SIZE)
    if (slice.length === 0) return `<p class="lib-empty">No games match your search.</p>`
    return slice.map(_buildCard).join('')
}

function _buildCard(game) {
    const hours   = game.playtime_forever ? Math.round(game.playtime_forever / 60) : 0
    const imgSrc  = `/relay/images/steam/games/${game.appid}/header.jpg`
    const hoursEl = hours > 0
        ? `<span class="lib-card-hours">${hours.toLocaleString()} hrs</span>`
        : `<span class="lib-card-hours lib-card-hours--zero">Not played</span>`

    return `
        <div class="lib-card">
            <div class="lib-card-img-wrap">
                <img class="lib-card-img" src="${imgSrc}" alt="${escapeHtml(game.name)}" loading="lazy">
            </div>
            <div class="lib-card-info">
                <span class="lib-card-name">${escapeHtml(game.name)}</span>
                ${hoursEl}
            </div>
        </div>`
}

function _buildPager(totalPages) {
    if (totalPages <= 1) return ''
    const prevDisabled = _page <= 1          ? 'disabled' : ''
    const nextDisabled = _page >= totalPages ? 'disabled' : ''
    return `
        <button id="lib-prev" class="lib-pager-btn" ${prevDisabled}>&#8592; Prev</button>
        <span class="lib-pager-info">Page ${_page} of ${totalPages}</span>
        <button id="lib-next" class="lib-pager-btn" ${nextDisabled}>Next &#8594;</button>`
}

function _bindPager() {
    const prev = _container.querySelector('#lib-prev')
    const next = _container.querySelector('#lib-next')
    if (prev) prev.addEventListener('click', () => { _page--; _redraw(); _container.scrollTo(0, 0) })
    if (next) next.addEventListener('click', () => { _page++; _redraw(); _container.scrollTo(0, 0) })
}
