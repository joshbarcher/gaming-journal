import { escapeHtml } from '../utils.js'
import { loadGameFilter } from './game-filter.js'

const RESUME_WINDOW_S = 7 * 24 * 60 * 60   // 7 days in seconds
const MOSAIC_COUNT    = 6

// ── Entry point ───────────────────────────────────────────────────────────────

export async function renderHome(container) {
    container.innerHTML = `<p class="page-loading">Loading…</p>`

    // /relay/api/games is the enriched combined endpoint — library + wishlist
    // with store data (releaseDate, media, etc.) and source tagging.
    // /relay/api/steam/games is the thin Steam endpoint that has rtime_last_played.
    const [allGamesResult, steamResult, alertsResult, discResult, shouldShow] = await Promise.allSettled([
        fetch('/relay/api/games').then(r => r.ok ? r.json() : null),
        fetch('/relay/api/steam/games').then(r => r.ok ? r.json() : null),
        fetch('/api/alerts').then(r => r.ok ? r.json() : null),
        fetch('/relay/api/discover/featured').then(r => r.ok ? r.json() : null),
        loadGameFilter(),
    ])

    const allGames  = Array.isArray(allGamesResult.value) ? allGamesResult.value : []
    const filterFn  = shouldShow.value ?? (() => true)
    const steamLib  = _unwrapLibrary(steamResult.value).filter(g => filterFn(g.appid))
    const alerts   = alertsResult.value ?? {}
    const discover = discResult.value   ?? []

    const libGames = allGames.filter(g => g.source === 'library' || g.source === 'both')
    const wlGames  = allGames.filter(g => g.source === 'wishlist' || g.source === 'both')

    // ── Conditional cards ─────────────────────────────────────────────────────

    // Library-owned releases first, then wishlist-only
    const releaseGame = libGames.find(_isToday) ?? wlGames.find(_isToday) ?? null

    const onSale   = alerts.onSale ?? []
    const saleGame = onSale.length ? onSale[Math.floor(Math.random() * onSale.length)] : null

    const nowSec     = Math.floor(Date.now() / 1000)
    const resumeSteam = steamLib
        .filter(g => g.rtime_last_played && (nowSec - g.rtime_last_played) < RESUME_WINDOW_S)
        .sort((a, b) => b.rtime_last_played - a.rtime_last_played)[0] ?? null
    // Merge with rich data for art/name (keep steam obj for playtime fields)
    const resumeGame = resumeSteam
        ? { ...resumeSteam, ...(allGames.find(g => String(g.appid) === String(resumeSteam.appid)) ?? {}) }
        : null

    const conditionals = [
        releaseGame  ? _cardRelease(releaseGame)          : null,
        saleGame     ? _cardSale(saleGame)                : null,
        resumeGame   ? _cardResume(resumeGame, resumeSteam) : null,
    ].filter(Boolean)

    // ── Anchor card poster pools ──────────────────────────────────────────────

    const libPosters  = _sample(libGames, MOSAIC_COUNT)
    const wlPosters   = _sample(wlGames,  MOSAIC_COUNT)
    const discItems   = discover.flatMap(s => s.items ?? [])
    // Discover items carry their own CDN headerImage — use it directly
    const discPosters = _sample(discItems, MOSAIC_COUNT).map(g => ({
        src: g.headerImage ?? null,
    }))

    // ── Render ────────────────────────────────────────────────────────────────

    const hasConditional = conditionals.length > 0
    const condCols       = conditionals.length || 1

    container.innerHTML = `
        <div class="home-wrap${hasConditional ? '' : ' home-wrap--solo'}">
            ${hasConditional ? `
            <div class="home-row" style="grid-template-columns: repeat(${condCols}, 1fr)">
                ${conditionals.join('')}
            </div>` : ''}
            <div class="home-row" style="grid-template-columns: 1fr 1fr 1fr">
                ${_cardAnchor('/library',  'View Library',   libPosters)}
                ${_cardAnchor('/wishlist', 'View Wishlist',  wlPosters)}
                ${_cardAnchor('/discover', 'Discover Games', discPosters)}
            </div>
        </div>`
}

// ── Conditional cards ─────────────────────────────────────────────────────────

function _cardRelease(game) {
    const bg = _heroBg(game)
    return `
        <a class="home-card" href="/game/${game.appid}">
            <div class="home-card-bg" style="background-image:url('${bg}')"></div>
            <div class="home-card-body">
                <span class="home-chip home-chip--release"><em class="home-chip-icon">★</em> Released Today</span>
                <span class="home-card-title">${escapeHtml(game.name)}</span>
                <span class="home-card-meta">Available now on Steam</span>

            </div>
        </a>`
}

function _cardSale(game) {
    const bg    = `/relay/images/steam/games/${game.appid}/header.jpg`
    const cut   = game.bestPrice?.cut   ?? 0
    const url   = game.bestPrice?.url   ?? `/game/${game.appid}`
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

            </div>
        </a>`
}

function _cardResume(game, steamGame) {
    const bg    = _heroBg(game)
    // playtime_forever (minutes) comes from the raw steam obj; playtimeMinutes from enriched
    const mins  = steamGame?.playtime_forever ?? game.playtimeMinutes ?? 0
    const hours = (mins / 60).toFixed(1)
    const last  = steamGame?.rtime_last_played ?? 0
    const days  = Math.floor((Date.now() / 1000 - last) / 86400)
    const when  = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`
    return `
        <a class="home-card" href="/game/${game.appid}">
            <div class="home-card-bg" style="background-image:url('${bg}')"></div>
            <div class="home-card-body">
                <span class="home-chip home-chip--resume">▶ Resume</span>
                <span class="home-card-title">${escapeHtml(game.name)}</span>
                <span class="home-card-meta">${hours}h played · last played ${when}</span>

            </div>
        </a>`
}

// ── Anchor cards ──────────────────────────────────────────────────────────────

function _cardAnchor(href, label, posters) {
    const mosaicImgs = posters.map(g => {
        // Discover items supply a direct CDN src; library/wishlist use relay appid paths
        if (g?.src) {
            return `<img class="home-mosaic-img"
                         src="${escapeHtml(g.src)}"
                         onerror="this.onerror=null;this.style.visibility='hidden'"
                         alt="" loading="lazy">`
        }
        const id = g?.appid
        if (!id) return '<div class="home-mosaic-img" style="background:#111"></div>'
        return `<img class="home-mosaic-img"
                     src="/relay/images/steam/games/${id}/poster.jpg"
                     onerror="this.onerror=null;this.src='/relay/images/steam/games/${id}/header.jpg'"
                     alt="" loading="lazy">`
    }).join('')

    return `
        <a class="home-card home-card--anchor" href="${escapeHtml(href)}">
            <div class="home-mosaic">${mosaicImgs}</div>
            <div class="home-card-body">
                <span class="home-anchor-label">${escapeHtml(label)}</span>

            </div>
        </a>`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _heroBg(game) {
    // Prefer the relay-served header; media.header is already the relay path
    return game.media?.header ?? `/relay/images/steam/games/${game.appid}/header.jpg`
}

function _isToday(game) {
    const str = game.store?.releaseDate
    if (!str) return false
    const parsed = new Date(str)
    if (isNaN(parsed.getTime())) return false
    const now = new Date()
    return parsed.getDate()     === now.getDate()     &&
           parsed.getMonth()    === now.getMonth()    &&
           parsed.getFullYear() === now.getFullYear()
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
    if (Array.isArray(json))                                    return json
    if (Array.isArray(json.games))                              return json.games
    if (Array.isArray(json.data))                               return json.data
    if (json.response && Array.isArray(json.response.games))    return json.response.games
    return []
}

function _appidFromUrl(url) {
    if (!url) return null
    const m = url.match(/\/apps\/(\d+)\//)
    return m ? m[1] : null
}
