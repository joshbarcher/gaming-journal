import { escapeHtml } from '../utils.js'

// ── Data ──────────────────────────────────────────────────────────────────────

async function _loadGames() {
    const [flagsRes, gamesRes] = await Promise.all([
        fetch('/api/flags'),
        fetch('/relay/api/steam/games'),
    ])
    if (!flagsRes.ok) throw new Error(`Flags HTTP ${flagsRes.status}`)
    if (!gamesRes.ok) throw new Error(`Games HTTP ${gamesRes.status}`)

    const flags   = await flagsRes.json()
    const gamesRaw = await gamesRes.json()
    const games   = Array.isArray(gamesRaw) ? gamesRaw
        : Array.isArray(gamesRaw.games)     ? gamesRaw.games
        : []

    const ownedMap = new Map(games.map(g => [g.appid, g]))

    const backlogIds = Object.entries(flags)
        .filter(([, f]) => f.backlog)
        .map(([id]) => Number(id))

    if (!backlogIds.length) return []

    // Fetch HLTB for each in parallel, fail gracefully per-game
    const results = await Promise.all(backlogIds.map(async appid => {
        const owned = ownedMap.get(appid)
        let name = owned?.name ?? null
        let hltb = null
        let playtime = owned?.playtime_forever ?? 0

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

    return results.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
}

// ── Formatting ────────────────────────────────────────────────────────────────

function _fmtHours(mins) {
    if (!mins) return null
    const h = mins / 60
    if (h < 1)  return `${Math.round(mins)}m`
    if (h < 10) return `${h.toFixed(1)}h`
    return `${Math.round(h)}h`
}

function _hltbLabel(hltb) {
    const main = hltb?.gameplayMain ?? hltb?.mainStory ?? null
    if (main) return { label: _fmtHours(main * 60), type: 'main' }
    const comp = hltb?.gameplayCompletionist ?? hltb?.completionist ?? null
    if (comp) return { label: _fmtHours(comp * 60), type: 'comp' }
    return null
}

function _totalHours(games) {
    let total = 0
    for (const g of games) {
        const main = g.hltb?.gameplayMain ?? g.hltb?.mainStory ?? null
        if (main) total += main
    }
    return total
}

// ── Card ──────────────────────────────────────────────────────────────────────

function _card(game) {
    const img  = `/relay/images/steam/games/${game.appid}/header.jpg`
    const est  = _hltbLabel(game.hltb)
    const ptH  = game.playtime > 0 ? _fmtHours(game.playtime) : null

    const timeBadge = est
        ? `<span class="vault-card-time vault-card-time--hltb" title="HowLongToBeat estimate">${escapeHtml(est.label)}</span>`
        : `<span class="vault-card-time vault-card-time--unknown">?h</span>`

    const playedBadge = ptH
        ? `<span class="vault-card-played" title="Time played in Steam">${escapeHtml(ptH)} played</span>`
        : ''

    return `
        <a class="vault-card" href="/game/${game.appid}" data-appid="${game.appid}">
            <div class="vault-card-img-wrap">
                <img class="vault-card-img" src="${img}" alt="" loading="lazy" onerror="this.style.opacity='0'">
                <div class="vault-card-overlay"></div>
                ${timeBadge}
            </div>
            <div class="vault-card-body">
                <span class="vault-card-name">${escapeHtml(game.name)}</span>
                ${playedBadge}
            </div>
        </a>`
}

// ── Random pick ───────────────────────────────────────────────────────────────

function _initRandomPick(container, games) {
    const btn = container.querySelector('#vault-random-btn')
    if (!btn || !games.length) return

    btn.addEventListener('click', () => {
        const pick = games[Math.floor(Math.random() * games.length)]
        const card = container.querySelector(`.vault-card[data-appid="${pick.appid}"]`)
        if (!card) return

        // Flash highlight
        container.querySelectorAll('.vault-card--picked').forEach(el => el.classList.remove('vault-card--picked'))
        card.classList.add('vault-card--picked')
        card.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
}

// ── Main render ───────────────────────────────────────────────────────────────

export async function renderVault(container) {
    container.innerHTML = `<p class="page-loading">Loading vault…</p>`

    let games
    try {
        games = await _loadGames()
    } catch (err) {
        container.innerHTML = `<p class="page-error">Failed to load vault: ${escapeHtml(err.message)}</p>`
        return
    }

    if (!games.length) {
        container.innerHTML = `
            <div class="vault-header">
                <div class="vault-header-body">
                    <p class="vault-eyebrow">Collection</p>
                    <h1 class="vault-title">Backlog</h1>
                </div>
            </div>
            <p class="page-empty" style="padding:40px">
                No games in your backlog yet. Open any game page and toggle the
                <strong>Backlog</strong> flag to add it here.
            </p>`
        return
    }

    const totalH  = _totalHours(games)
    const totalStr = totalH > 0
        ? `~${Math.round(totalH)}h of games waiting`
        : `${games.length} game${games.length !== 1 ? 's' : ''} waiting`

    container.innerHTML = `
        <div class="vault-header">
            <div class="vault-header-body">
                <p class="vault-eyebrow">Collection</p>
                <h1 class="vault-title">Backlog</h1>
                <p class="vault-subtitle">${totalStr}</p>
            </div>
            <button id="vault-random-btn" class="vault-random-btn" title="Pick a random game from your backlog">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/>
                    <polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/>
                </svg>
                Random Pick
            </button>
        </div>
        <div class="vault-grid">
            ${games.map(_card).join('')}
        </div>`

    _initRandomPick(container, games)
}
