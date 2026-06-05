import { escapeHtml } from '../utils.js'
import { loadGameFilter } from './game-filter.js'

// ── Data ──────────────────────────────────────────────────────────────────────

async function _loadGames() {
    const [lastPlayedRes, gamesRes, shouldShow] = await Promise.all([
        fetch('/relay/api/steam/playtime/last-played'),
        fetch('/relay/api/steam/games'),
        loadGameFilter(),
    ])
    if (!lastPlayedRes.ok) throw new Error(`Last-played HTTP ${lastPlayedRes.status}`)
    if (!gamesRes.ok)      throw new Error(`Games HTTP ${gamesRes.status}`)

    const lastPlayedMap = await lastPlayedRes.json()
    const gamesRaw      = await gamesRes.json()
    const games         = Array.isArray(gamesRaw) ? gamesRaw
        : Array.isArray(gamesRaw.games)            ? gamesRaw.games
        : []

    const gameInfoMap = new Map(games.map(g => [g.appid, g]))

    return Object.entries(lastPlayedMap)
        .map(([appidStr, data]) => {
            const appid = Number(appidStr)
            const info  = gameInfoMap.get(appid)
            return {
                appid,
                name:         info?.name ?? `App ${appid}`,
                playtime:     data.effectiveMin ?? 0,
                lastPlayedAt: data.lastPlayedAt ?? null,
            }
        })
        .filter(g => g.lastPlayedAt && shouldShow(g.appid))
        .sort((a, b) => new Date(b.lastPlayedAt) - new Date(a.lastPlayedAt))
}

// ── Formatting ────────────────────────────────────────────────────────────────

function _fmtHours(mins) {
    if (!mins) return null
    const h = mins / 60
    if (h < 1)  return `${Math.round(mins)}m`
    if (h < 10) return `${h.toFixed(1)}h`
    return `${Math.round(h)}h`
}

function _fmtRelative(isoStr) {
    if (!isoStr) return null
    const diffMs  = Date.now() - new Date(isoStr).getTime()
    const diffMin = Math.floor(diffMs / 60_000)
    if (diffMin < 2)    return 'Just now'
    if (diffMin < 60)   return `${diffMin}m ago`
    const diffH = Math.floor(diffMin / 60)
    if (diffH < 24)     return `${diffH}h ago`
    const diffD = Math.floor(diffH / 24)
    if (diffD < 7)      return `${diffD}d ago`
    if (diffD < 31)     return `${Math.floor(diffD / 7)}w ago`
    return new Date(isoStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// ── Card ──────────────────────────────────────────────────────────────────────

function _card(game, position) {
    const img      = `/relay/images/steam/games/${game.appid}/header.jpg`
    const ptLabel  = _fmtHours(game.playtime)
    const relLabel = _fmtRelative(game.lastPlayedAt)
    const featured = position <= 3

    return `
        <a class="history-card${featured ? ' history-card--featured' : ''}" href="/game/${game.appid}">
            <div class="history-card-img-wrap">
                <img class="history-card-img" src="${img}" alt="" loading="lazy" onerror="this.style.opacity='0'">
                <div class="history-card-overlay"></div>
                <span class="history-card-num">${position}</span>
                ${relLabel ? `<span class="history-card-time">${escapeHtml(relLabel)}</span>` : ''}
            </div>
            <div class="history-card-body">
                <span class="history-card-name">${escapeHtml(game.name)}</span>
                ${ptLabel ? `<span class="history-card-played">${escapeHtml(ptLabel)} played</span>` : ''}
            </div>
        </a>`
}

// ── Render ────────────────────────────────────────────────────────────────────

export async function renderHistory(container) {
    container.innerHTML = `<p class="page-loading">Loading…</p>`

    let games
    try {
        games = await _loadGames()
    } catch (err) {
        container.innerHTML = `<p class="page-error">Failed to load history: ${escapeHtml(err.message)}</p>`
        return
    }

    if (!games.length) {
        container.innerHTML = `
            <div class="history-header">
                <div class="history-header-body">
                    <p class="history-eyebrow">Activity</p>
                    <h1 class="history-title">History</h1>
                </div>
            </div>
            <p class="page-empty" style="padding:40px">No play history recorded yet.</p>`
        return
    }

    const topGames  = games.slice(0, 3)
    const restGames = games.slice(3)

    const topCards  = topGames.map((g, i) => _card(g, i + 1)).join('')
    const restCards = restGames.map((g, i) => _card(g, i + 4)).join('')

    const subtitle = `${games.length} game${games.length !== 1 ? 's' : ''} · last played ${_fmtRelative(games[0].lastPlayedAt)}`

    const sepHtml = restGames.length ? `
        <div class="history-rest-sep">
            <span class="history-rest-sep-label">Earlier &middot; ${restGames.length} more</span>
        </div>` : ''

    const restHtml = restGames.length ? `
        <div class="history-grid">${restCards}</div>` : ''

    container.innerHTML = `
        <div class="history-header">
            <div class="history-header-body">
                <p class="history-eyebrow">Activity</p>
                <h1 class="history-title">History</h1>
                <p class="history-subtitle">${escapeHtml(subtitle)}</p>
            </div>
        </div>
        <div class="history-recent">
            <div class="history-recent-header">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span class="history-recent-label">Recently Played</span>
            </div>
            <div class="history-recent-row">${topCards}</div>
        </div>
        ${sepHtml}
        ${restHtml}`
}
