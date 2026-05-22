import { escapeHtml } from '../utils.js'

const RESUME_WINDOW_S = 7 * 24 * 60 * 60   // 7 days in seconds
const MOSAIC_COUNT    = 6

// ── Entry point ───────────────────────────────────────────────────────────────

export async function renderHome(container) {
    container.innerHTML = `<p class="page-loading">Loading…</p>`

    const [libResult, wlResult, alertsResult, discResult] = await Promise.allSettled([
        fetch('/relay/api/steam/games').then(r => r.ok ? r.json() : null),
        fetch('/relay/api/wishlist').then(r => r.ok ? r.json() : null),
        fetch('/api/alerts').then(r => r.ok ? r.json() : null),
        fetch('/relay/api/discover/featured').then(r => r.ok ? r.json() : null),
    ])

    const library   = _unwrapLibrary(libResult.value)
    const wishlist  = Array.isArray(wlResult.value)  ? wlResult.value  : []
    const alerts    = alertsResult.value ?? {}
    const discover  = discResult.value   ?? []

    // ── Conditional cards ─────────────────────────────────────────────────────

    const today       = new Date().toISOString().slice(0, 10)
    const releaseGame = wishlist.find(g => g.store?.releaseDateIso === today) ?? null

    const onSale    = alerts.onSale ?? []
    const saleGame  = onSale.length ? onSale[Math.floor(Math.random() * onSale.length)] : null

    const nowSec    = Math.floor(Date.now() / 1000)
    const resumeGame = library
        .filter(g => g.rtime_last_played && (nowSec - g.rtime_last_played) < RESUME_WINDOW_S)
        .sort((a, b) => b.rtime_last_played - a.rtime_last_played)[0] ?? null

    const conditionals = [
        releaseGame ? _cardRelease(releaseGame)          : null,
        saleGame    ? _cardSale(saleGame)                : null,
        resumeGame  ? _cardResume(resumeGame)            : null,
    ].filter(Boolean)

    // ── Anchor card poster pools ──────────────────────────────────────────────

    const libPosters  = _sample(library, MOSAIC_COUNT).map(g => g.appid)
    const wlPosters   = _sample(wishlist, MOSAIC_COUNT).map(g => g.appid)

    const discItems   = discover.flatMap(s => s.items ?? [])
    const discPosters = _sample(discItems, MOSAIC_COUNT).map(g => g.appid ?? _appidFromUrl(g.headerImage))

    // ── Render ────────────────────────────────────────────────────────────────

    const hasConditional = conditionals.length > 0
    const condCols = conditionals.length || 1

    container.innerHTML = `
        <div class="home-wrap${hasConditional ? '' : ' home-wrap--solo'}">
            ${hasConditional ? `
            <div class="home-row" style="grid-template-columns: repeat(${condCols}, 1fr)">
                ${conditionals.join('')}
            </div>` : ''}
            <div class="home-row" style="grid-template-columns: 1fr 1fr 1fr">
                ${_cardAnchor('/library',  'View Library',     libPosters)}
                ${_cardAnchor('/wishlist', 'View Wishlist',    wlPosters)}
                ${_cardAnchor('/discover', 'Discover Games',   discPosters)}
            </div>
        </div>`

}

// ── Conditional cards ─────────────────────────────────────────────────────────

function _cardRelease(game) {
    const bg = _heroBg(game.appid)
    return `
        <a class="home-card" href="/game/${game.appid}">
            <div class="home-card-bg" style="background-image:url('${bg}')"></div>
            <div class="home-card-body">
                <span class="home-chip home-chip--release"><em class="home-chip-icon">★</em> Released Today</span>
                <span class="home-card-title">${escapeHtml(game.name)}</span>
                <span class="home-card-meta">Available now on Steam</span>
                <span class="home-card-arrow">→</span>
            </div>
        </a>`
}

function _cardSale(game) {
    const bg   = _heroBg(game.appid)
    const cut  = game.bestPrice?.cut   ?? 0
    const url  = game.bestPrice?.url   ?? `/game/${game.appid}`
    const store = game.bestPrice?.store ?? ''
    const price = game.bestPrice?.price != null ? `$${game.bestPrice.price.toFixed(2)}` : ''
    const external = url.startsWith('http')
    return `
        <a class="home-card" href="${escapeHtml(url)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>
            <div class="home-card-bg" style="background-image:url('${bg}')"></div>
            <div class="home-card-body">
                <span class="home-chip home-chip--sale">On Sale  −${cut}%</span>
                <span class="home-card-title">${escapeHtml(game.name)}</span>
                <span class="home-card-meta">${price ? `${price} · ` : ''}${escapeHtml(store)}</span>
                <span class="home-card-arrow">→</span>
            </div>
        </a>`
}

function _cardResume(game) {
    const bg    = _heroBg(game.appid)
    const hours = ((game.playtime_forever ?? 0) / 60).toFixed(1)
    const days  = Math.floor((Date.now() / 1000 - game.rtime_last_played) / 86400)
    const when  = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`
    return `
        <a class="home-card" href="/game/${game.appid}">
            <div class="home-card-bg" style="background-image:url('${bg}')"></div>
            <div class="home-card-body">
                <span class="home-chip home-chip--resume">▶ Resume</span>
                <span class="home-card-title">${escapeHtml(game.name)}</span>
                <span class="home-card-meta">${hours}h played · last played ${when}</span>
                <span class="home-card-arrow">→</span>
            </div>
        </a>`
}

// ── Anchor cards ──────────────────────────────────────────────────────────────

function _cardAnchor(href, label, appids) {
    const mosaicImgs = appids.map(id => id
        ? `<img class="home-mosaic-img"
                src="https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg"
                onerror="this.src='/relay/images/steam/games/${id}/header.jpg'"
                alt="" loading="lazy">`
        : '<div class="home-mosaic-img" style="background:#111"></div>'
    ).join('')

    return `
        <a class="home-card home-card--anchor" href="${escapeHtml(href)}">
            <div class="home-mosaic">${mosaicImgs}</div>
            <div class="home-card-body">
                <span class="home-chip home-chip--anchor">${escapeHtml(label)}</span>
                <span class="home-card-title">${escapeHtml(label)}</span>
                <span class="home-card-arrow">→</span>
            </div>
        </a>`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _heroBg(appid) {
    return `/relay/images/steam/games/${appid}/header.jpg`
}

function _sample(arr, n) {
    if (!arr?.length) return []
    const copy = [...arr]
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return copy.slice(0, n)
}

function _unwrapLibrary(json) {
    if (!json) return []
    if (Array.isArray(json))                           return json
    if (Array.isArray(json.games))                     return json.games
    if (Array.isArray(json.data))                      return json.data
    if (json.response && Array.isArray(json.response.games)) return json.response.games
    return []
}

function _appidFromUrl(url) {
    if (!url) return null
    const m = url.match(/\/apps\/(\d+)\//)
    return m ? m[1] : null
}

