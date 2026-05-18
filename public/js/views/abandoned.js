import { escapeHtml } from '../utils.js'

// ── Data ──────────────────────────────────────────────────────────────────────

async function _loadGames() {
    const [flagsRes, gamesRes] = await Promise.all([
        fetch('/api/flags'),
        fetch('/relay/api/steam/games'),
    ])
    if (!flagsRes.ok) throw new Error(`Flags HTTP ${flagsRes.status}`)
    if (!gamesRes.ok) throw new Error(`Games HTTP ${gamesRes.status}`)

    const flags    = await flagsRes.json()
    const gamesRaw = await gamesRes.json()
    const games    = Array.isArray(gamesRaw) ? gamesRaw
        : Array.isArray(gamesRaw.games)      ? gamesRaw.games
        : []

    const ownedMap = new Map(games.map(g => [g.appid, g]))

    const droppedIds = Object.entries(flags)
        .filter(([, f]) => f.dropped)
        .map(([id]) => Number(id))

    if (!droppedIds.length) return []

    const results = await Promise.all(droppedIds.map(async appid => {
        const owned   = ownedMap.get(appid)
        let name      = owned?.name ?? null
        let playtime  = owned?.playtime_forever ?? 0   // Steam minutes
        let hltb      = null

        try {
            const r = await fetch(`/relay/api/hltb/${appid}`)
            if (r.ok) hltb = await r.json()
        } catch { /* no HLTB */ }

        if (!name) {
            try {
                const r = await fetch(`/relay/api/games/${appid}`)
                if (r.ok) { const d = await r.json(); name = d?.name ?? null }
            } catch { /* ignore */ }
        }

        return { appid, name: name ?? `App ${appid}`, playtime, hltb }
    }))

    // Sort by most time invested — the games you put the most into sit first
    return results.sort((a, b) => b.playtime - a.playtime)
}

// ── Formatting ────────────────────────────────────────────────────────────────

function _fmtHours(mins) {
    if (!mins) return null
    const h = mins / 60
    if (h < 1)  return `${Math.round(mins)}m`
    if (h < 10) return `${h.toFixed(1)}h`
    return `${Math.round(h)}h`
}

function _totalInvested(games) {
    return games.reduce((sum, g) => sum + (g.playtime ?? 0), 0)
}

// How much of the HLTB main story is likely left given playtime
function _remainingLabel(hltb, playtimeMin) {
    const mainH = hltb?.gameplayMain ?? hltb?.mainStory ?? null
    if (!mainH) return null
    const mainMin   = mainH * 60
    const remaining = mainMin - playtimeMin
    if (remaining <= 0) return null   // already past the estimate
    return _fmtHours(remaining)
}

// ── Card ──────────────────────────────────────────────────────────────────────

function _card(game) {
    const img       = `/relay/images/steam/games/${game.appid}/header.jpg`
    const invested  = _fmtHours(game.playtime)
    const remaining = _remainingLabel(game.hltb, game.playtime)

    const investedBadge = invested
        ? `<span class="ab-card-invested">${escapeHtml(invested)} in</span>`
        : ''

    const remainingBadge = remaining
        ? `<span class="ab-card-remaining" title="Estimated time remaining">${escapeHtml(remaining)} left</span>`
        : ''

    return `
        <a class="ab-card" href="/game/${game.appid}" data-appid="${game.appid}">
            <div class="ab-card-img-wrap">
                <img class="ab-card-img" src="${img}" alt="" loading="lazy" onerror="this.style.opacity='0'">
                <div class="ab-card-fog"></div>
                <div class="ab-card-overlay"></div>
                ${investedBadge}
            </div>
            <div class="ab-card-body">
                <span class="ab-card-name">${escapeHtml(game.name)}</span>
                ${remainingBadge
                    ? `<span class="ab-card-meta">${remainingBadge} to finish</span>`
                    : `<span class="ab-card-meta ab-card-meta--unknown">Unfinished</span>`}
            </div>
        </a>`
}

// ── Main render ───────────────────────────────────────────────────────────────

export async function renderAbandoned(container) {
    container.innerHTML = `<p class="page-loading">Loading abandoned saves…</p>`

    let games
    try {
        games = await _loadGames()
    } catch (err) {
        container.innerHTML = `<p class="page-error">Failed to load: ${escapeHtml(err.message)}</p>`
        return
    }

    if (!games.length) {
        container.innerHTML = `
            <div class="ab-header">
                <div class="ab-header-body">
                    <p class="ab-eyebrow">Collection</p>
                    <h1 class="ab-title">Abandoned Saves</h1>
                </div>
            </div>
            <p class="page-empty" style="padding:40px">
                No dropped games yet. Open any game page and toggle the
                <strong>Dropped</strong> flag to track it here.
            </p>`
        return
    }

    const totalMin  = _totalInvested(games)
    const totalStr  = totalMin > 0
        ? `${games.length} game${games.length !== 1 ? 's' : ''} set aside · ${_fmtHours(totalMin)} invested`
        : `${games.length} game${games.length !== 1 ? 's' : ''} set aside`

    container.innerHTML = `
        <div class="ab-header">
            <div class="ab-header-body">
                <p class="ab-eyebrow">Collection</p>
                <h1 class="ab-title">Abandoned Saves</h1>
                <p class="ab-subtitle">${totalStr}</p>
            </div>
        </div>
        <div class="ab-grid">
            ${games.map(_card).join('')}
        </div>`
}
