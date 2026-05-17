import { loadGameFilter } from './game-filter.js'

let _refreshTimer  = null
let _hideFiltered  = false
let _allEntries    = []

// ── Icons ─────────────────────────────────────────────────────────────────────

const _ICO_MUTE   = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`
const _ICO_UNMUTE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`
const _ICO_FILTER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`

// ── API ───────────────────────────────────────────────────────────────────────

async function _setFiltered(appid, filtered) {
    const method = filtered ? 'POST' : 'DELETE'
    const res = await fetch(`/relay/api/player-counts/filtered/${appid}`, { method })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const entry = _allEntries.find(e => e.appid === appid)
    if (entry) entry.filtered = filtered
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _fmt(n) {
    if (n == null || n === 0) return '—'
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
    return n.toLocaleString()
}

function _sparkline(samples) {
    if (!samples?.length) return '<svg class="tg-spark" viewBox="0 0 80 24"></svg>'
    const vals  = samples.map(s => s[1])
    const min   = Math.min(...vals)
    const max   = Math.max(...vals)
    const range = max - min || 1
    const W = 80, H = 24, PAD = 1
    const pts = vals.map((v, i) => {
        const x = PAD + (i / Math.max(vals.length - 1, 1)) * (W - PAD * 2)
        const y = PAD + (1 - (v - min) / range) * (H - PAD * 2)
        return `${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
    return `<svg class="tg-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`
}

// ── Row ───────────────────────────────────────────────────────────────────────

function _row(entry, rank) {
    const img     = `/relay/images/steam/games/${entry.appid}/header.jpg`
    const owned   = entry.owned      ? '<span class="tg-badge tg-badge--owned">Owned</span>'     : ''
    const wished  = entry.wishlisted ? '<span class="tg-badge tg-badge--wish">Wishlisted</span>' : ''
    const href    = `/game/${entry.appid}`
    const target  = ''
    const name    = entry.name ?? `App ${entry.appid}`
    const wrapCls = entry.filtered ? ' tg-row-wrap--muted' : ''
    const rankStr = entry.filtered ? '—' : rank

    return `
        <div class="tg-row-wrap${wrapCls}" data-appid="${entry.appid}">
            <a class="tg-row" href="${href}"${target}>
                <span class="tg-rank">${rankStr}</span>
                <img class="tg-thumb" src="${img}" alt="" loading="lazy" onerror="this.style.opacity='0'">
                <span class="tg-name">${name}${owned}${wished}</span>
                <span class="tg-stat">${_fmt(entry.latest)}</span>
                <span class="tg-stat tg-stat--muted">${_fmt(entry.peak24h)}</span>
                <span class="tg-stat tg-stat--muted">${_fmt(entry.peak7d)}</span>
                <span class="tg-stat tg-stat--muted">${_fmt(entry.peakAllTime)}</span>
                <span class="tg-spark-cell">${_sparkline(entry.samples24h)}</span>
            </a>
            <button class="tg-mute-btn" data-appid="${entry.appid}" title="${entry.filtered ? 'Restore' : 'Hide'} ${name}">
                ${entry.filtered ? _ICO_UNMUTE : _ICO_MUTE}
            </button>
        </div>`
}

// ── Render ────────────────────────────────────────────────────────────────────

function _renderRows(container) {
    const active   = _allEntries.filter(e => !e.filtered)
    const filtered = _allEntries.filter(e => e.filtered)

    const toggleBtn = container.querySelector('#tg-filter-btn')
    if (toggleBtn) {
        toggleBtn.classList.toggle('tg-filter-btn--active', _hideFiltered && filtered.length > 0)
        toggleBtn.title = _hideFiltered ? `Show hidden games (${filtered.length})` : 'Hide filtered games'
        const countEl = toggleBtn.querySelector('.tg-filter-count')
        if (countEl) countEl.textContent = filtered.length || ''
        toggleBtn.style.display = filtered.length ? '' : 'none'
    }

    const tableEl = container.querySelector('#tg-rows')
    if (!tableEl) return

    let rank = 0
    const activeHtml   = active.map(e => _row(e, ++rank)).join('')
    const filteredHtml = (!_hideFiltered && filtered.length)
        ? filtered.map(e => _row(e, rank)).join('')
        : ''

    tableEl.innerHTML = activeHtml + filteredHtml

    tableEl.querySelectorAll('.tg-mute-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.preventDefault()
            e.stopPropagation()
            const appid = Number(btn.dataset.appid)
            const entry = _allEntries.find(x => x.appid === appid)
            if (!entry) return
            btn.disabled = true
            try {
                await _setFiltered(appid, !entry.filtered)
                _renderRows(container)
            } catch (err) {
                console.error('[top-games] filter toggle failed', err)
                btn.disabled = false
            }
        })
    })
}

// ── Main render ───────────────────────────────────────────────────────────────

export async function renderTopGames(container) {
    clearInterval(_refreshTimer)
    container.innerHTML = `<p class="page-loading">Loading top games…</p>`

    try {
        const [res, shouldShow] = await Promise.all([
            fetch('/relay/api/player-counts/top?n=100&includeFiltered=true'),
            loadGameFilter(),
        ])
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        _allEntries = (await res.json()).filter(e => shouldShow(e.appid))
    } catch (err) {
        container.innerHTML = `<p class="page-error">Failed to load: ${err.message}</p>`
        return
    }

    if (!_allEntries.length) {
        container.innerHTML = `
            <div class="page-header">
                <h1 class="page-title">Top Games</h1>
                <p class="page-subtitle">No data yet — trigger a collection first via <code>POST /relay/api/player-counts/collect</code></p>
            </div>`
        return
    }

    const updatedAt    = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    const filteredCount = _allEntries.filter(e => e.filtered).length

    container.innerHTML = `
        <div class="page-header">
            <div class="tg-page-top">
                <div>
                    <h1 class="page-title tg-title">Top Games by Players</h1>
                    <p class="page-subtitle">Live Steam data · updated ${updatedAt} · refreshes every 30 min</p>
                </div>
                <button id="tg-filter-btn" class="tg-filter-btn" style="${filteredCount ? '' : 'display:none'}" title="Hide filtered games">
                    ${_ICO_FILTER}
                    <span class="tg-filter-count">${filteredCount || ''}</span>
                </button>
            </div>
        </div>
        <div class="tg-table">
            <div class="tg-header">
                <span class="tg-rank">#</span>
                <span class="tg-thumb-ph"></span>
                <span class="tg-name">Game</span>
                <span class="tg-stat">Now</span>
                <span class="tg-stat tg-stat--muted">24h Peak</span>
                <span class="tg-stat tg-stat--muted">7d Peak</span>
                <span class="tg-stat tg-stat--muted">All-Time</span>
                <span class="tg-spark-cell">24h Trend</span>
            </div>
            <div id="tg-rows"></div>
        </div>`

    container.querySelector('#tg-filter-btn').addEventListener('click', () => {
        _hideFiltered = !_hideFiltered
        _renderRows(container)
    })

    _renderRows(container)

    _refreshTimer = setInterval(() => renderTopGames(container), 30 * 60 * 1_000)
}
