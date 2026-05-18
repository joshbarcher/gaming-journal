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

    const completedIds = Object.entries(flags)
        .filter(([, f]) => f.completed)
        .map(([id]) => Number(id))

    if (!completedIds.length) return []

    const results = await Promise.all(completedIds.map(async appid => {
        const owned  = ownedMap.get(appid)
        let name     = owned?.name ?? null
        let playtime = owned?.playtime_forever ?? 0   // Steam minutes

        if (!name) {
            try {
                const r = await fetch(`/relay/api/games/${appid}`)
                if (r.ok) { const d = await r.json(); name = d?.name ?? null }
            } catch { /* ignore */ }
        }

        return { appid, name: name ?? `App ${appid}`, playtime }
    }))

    // Most played first — the time investment is the trophy
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

function _totalHours(games) {
    return games.reduce((sum, g) => sum + (g.playtime ?? 0), 0)
}

// ── Tier definitions ──────────────────────────────────────────────────────────

const TIERS = [
    { key: 'legend',    minH: 100, symbol: '◆', label: 'Legend',    sublabel: '100h+', cls: 'hof-tier--legend',    featured: true  },
    { key: 'veteran',   minH: 50,  symbol: '▲', label: 'Veteran',   sublabel: '50h+',  cls: 'hof-tier--veteran',   featured: false },
    { key: 'completed', minH: 20,  symbol: '●', label: 'Completed', sublabel: '20h+',  cls: 'hof-tier--completed', featured: false },
    { key: 'finished',  minH: 0,   symbol: '○', label: 'Finished',  sublabel: '<20h',  cls: 'hof-tier--finished',  featured: false },
]

function _tier(playtimeMin) {
    const h = playtimeMin / 60
    return TIERS.find(t => h >= t.minH) ?? TIERS[TIERS.length - 1]
}

// ── Card ──────────────────────────────────────────────────────────────────────

function _card(game, featured = false) {
    const img  = `/relay/images/steam/games/${game.appid}/header.jpg`
    const hours = _fmtHours(game.playtime)
    const tier  = _tier(game.playtime)

    return `
        <a class="hof-card${featured ? ' hof-card--featured' : ''}" href="/game/${game.appid}" data-appid="${game.appid}">
            <div class="hof-card-img-wrap">
                <img class="hof-card-img" src="${img}" alt="" loading="lazy" onerror="this.style.opacity='0'">
                <div class="hof-card-shine"></div>
                <div class="hof-card-overlay"></div>
                <span class="hof-card-tier ${tier.cls}" title="${tier.label}">${tier.symbol}</span>
                ${hours ? `<span class="hof-card-hours">${escapeHtml(hours)}</span>` : ''}
            </div>
            <div class="hof-card-body">
                <span class="hof-card-name">${escapeHtml(game.name)}</span>
                <span class="hof-card-label ${tier.cls}">${tier.label}</span>
            </div>
        </a>`
}

// ── Section ───────────────────────────────────────────────────────────────────

function _section(tier, games) {
    if (!games.length) return ''
    const grid = tier.featured
        ? `<div class="hof-featured-grid">${games.map(g => _card(g, true)).join('')}</div>`
        : `<div class="hof-grid">${games.map(g => _card(g, false)).join('')}</div>`

    return `
        <div class="hof-section">
            <div class="hof-section-heading">
                <span class="hof-section-symbol ${tier.cls}">${tier.symbol}</span>
                <span class="hof-section-name ${tier.cls}">${tier.label}</span>
                <span class="hof-section-meta">${tier.sublabel} · ${games.length} game${games.length !== 1 ? 's' : ''}</span>
            </div>
            ${grid}
        </div>`
}

// ── Main render ───────────────────────────────────────────────────────────────

export async function renderHallOfFame(container) {
    container.innerHTML = `<p class="page-loading">Loading Completed Games…</p>`

    let games
    try {
        games = await _loadGames()
    } catch (err) {
        container.innerHTML = `<p class="page-error">Failed to load: ${escapeHtml(err.message)}</p>`
        return
    }

    if (!games.length) {
        container.innerHTML = `
            <div class="hof-header">
                <div class="hof-header-body">
                    <p class="hof-eyebrow">Collection</p>
                    <h1 class="hof-title">Completed Games</h1>
                </div>
            </div>
            <p class="page-empty" style="padding:40px">
                No completed games yet. Open any game page and toggle the
                <strong>Completed</strong> flag to enshrine it here.
            </p>`
        return
    }

    const totalMin = _totalHours(games)
    const totalStr = `${games.length} game${games.length !== 1 ? 's' : ''} conquered · ${_fmtHours(totalMin)} total`

    // Group by tier, preserving playtime-desc sort within each group
    const grouped = new Map(TIERS.map(t => [t.key, []]))
    for (const g of games) grouped.get(_tier(g.playtime).key).push(g)

    container.innerHTML = `
        <div class="hof-header">
            <div class="hof-header-body">
                <p class="hof-eyebrow">Collection</p>
                <h1 class="hof-title">Completed Games</h1>
                <p class="hof-subtitle">${totalStr}</p>
            </div>
        </div>
        ${TIERS.map(t => _section(t, grouped.get(t.key))).join('')}`
}
