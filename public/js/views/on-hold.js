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

    const onHoldIds = Object.entries(flags)
        .filter(([, f]) => f.onHold)
        .map(([id]) => Number(id))

    if (!onHoldIds.length) return []

    const results = await Promise.all(onHoldIds.map(async appid => {
        const owned   = ownedMap.get(appid)
        let name      = owned?.name ?? null
        let hltb      = null
        let playtime  = owned?.playtime_forever ?? 0

        try {
            const r = await fetch(`/relay/api/hltb/${appid}`)
            if (r.ok) hltb = await r.json()
        } catch { /* no HLTB data */ }

        if (!name) {
            try {
                const r = await fetch(`/relay/api/games/${appid}`)
                if (r.ok) { const d = await r.json(); name = d?.name ?? null }
            } catch { /* ignore */ }
        }

        return { appid, name: name ?? `App ${appid}`, hltb, playtime }
    }))

    // Most time invested first — these are the ones you're most committed to
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

function _totalPlaytime(games) {
    return games.reduce((sum, g) => sum + (g.playtime ?? 0), 0)
}

// ── Progress bar with HLTB tier markers ───────────────────────────────────────

function _progressBar(game) {
    const hltb      = game.hltb
    const playedH   = game.playtime / 60   // minutes → hours

    const main  = hltb?.gameplayMain          ?? null
    const extra = hltb?.gameplayMainExtra     ?? null
    const comp  = hltb?.gameplayCompletionist ?? null

    if (!main && !extra && !comp) return { bar: '', label: '' }

    // The furthest tier we have — used as the 100% mark on the bar
    const ceiling = comp ?? extra ?? main

    // Clamp fill at 100% visually but track real progress for label
    const fillPct = Math.min((playedH / ceiling) * 100, 100)

    // Tick mark positions as % of the bar width
    const ticks = []
    if (main  && main  < ceiling) ticks.push({ pct: (main  / ceiling) * 100, label: 'Main'   })
    if (extra && extra < ceiling) ticks.push({ pct: (extra / ceiling) * 100, label: 'Extras' })

    const ticksHtml = ticks.map(t =>
        `<span class="onhold-bar-tick" style="left:${t.pct.toFixed(1)}%" title="${t.label}"></span>`
    ).join('')

    // Smart label: which tier are you currently working toward?
    let label = ''
    const pct = n => Math.round((playedH / n) * 100)
    if (main && playedH < main) {
        label = `${pct(main)}% of Main Story`
    } else if (extra && playedH < extra) {
        label = `Main done · ${pct(extra)}% of Main+Extras`
    } else if (comp && playedH < comp) {
        label = `Extras done · ${pct(comp)}% completionist`
    } else {
        label = `Past all estimates`
    }

    const bar = `
        <div class="onhold-bar-wrap">
            <div class="onhold-bar-track">
                <div class="onhold-bar-fill" style="width:${fillPct.toFixed(1)}%"></div>
                ${ticksHtml}
            </div>
        </div>`

    return { bar, label }
}

// ── Card ──────────────────────────────────────────────────────────────────────

function _card(game) {
    const img     = `/relay/images/steam/games/${game.appid}/header.jpg`
    const playedH = _fmtHours(game.playtime)
    const { bar, label } = _progressBar(game)

    const badge = playedH
        ? `<span class="onhold-card-time" title="Time played so far">${escapeHtml(playedH)}</span>`
        : ''

    return `
        <a class="onhold-card" href="/game/${game.appid}" data-appid="${game.appid}">
            <div class="onhold-card-img-wrap">
                <img class="onhold-card-img" src="${img}" alt="" loading="lazy" onerror="this.style.opacity='0'">
                <div class="onhold-card-overlay"></div>
                ${badge}
            </div>
            <div class="onhold-card-body">
                <span class="onhold-card-name">${escapeHtml(game.name)}</span>
                ${label ? `<span class="onhold-card-progress-label">${escapeHtml(label)}</span>` : ''}
            </div>
            ${bar}
        </a>`
}

// ── Main render ───────────────────────────────────────────────────────────────

export async function renderOnHold(container) {
    container.innerHTML = `<p class="page-loading">Loading…</p>`

    let games
    try {
        games = await _loadGames()
    } catch (err) {
        container.innerHTML = `<p class="page-error">Failed to load: ${escapeHtml(err.message)}</p>`
        return
    }

    if (!games.length) {
        container.innerHTML = `
            <div class="onhold-header">
                <div class="onhold-header-body">
                    <p class="onhold-eyebrow">Collection</p>
                    <h1 class="onhold-title">In Progress</h1>
                </div>
            </div>
            <p class="page-empty" style="padding:40px">
                No games on hold. Open any game page and toggle the
                <strong>In Progress</strong> flag to track paused playthroughs here.
            </p>`
        return
    }

    const totalMins = _totalPlaytime(games)
    const totalStr  = totalMins > 0
        ? `${_fmtHours(totalMins)} invested across ${games.length} paused game${games.length !== 1 ? 's' : ''}`
        : `${games.length} game${games.length !== 1 ? 's' : ''} paused`

    container.innerHTML = `
        <div class="onhold-header">
            <div class="onhold-header-body">
                <p class="onhold-eyebrow">Collection</p>
                <h1 class="onhold-title">In Progress</h1>
                <p class="onhold-subtitle">${totalStr}</p>
            </div>
        </div>
        <div class="onhold-grid">
            ${games.map(_card).join('')}
        </div>`
}
