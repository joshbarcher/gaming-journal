import { escapeHtml } from '../utils.js'

// ── Module state ──────────────────────────────────────────────────────────────

let _currentGames = []
let _draggedAppid = null

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

// ── Order persistence ─────────────────────────────────────────────────────────

function _loadOrder() {
    try {
        const raw = localStorage.getItem('vault-order')
        return raw ? JSON.parse(raw) : []
    } catch {
        return []
    }
}

function _saveOrder(appids) {
    try {
        localStorage.setItem('vault-order', JSON.stringify(appids))
    } catch { /* ignore */ }
}

function _applyOrder(games) {
    const order = _loadOrder()
    const gameMap = new Map(games.map(g => [g.appid, g]))
    const ordered = []
    const seen = new Set()

    for (const appid of order) {
        if (gameMap.has(appid)) {
            ordered.push(gameMap.get(appid))
            seen.add(appid)
        }
    }

    for (const g of games) {
        if (!seen.has(g.appid)) {
            ordered.push(g)
        }
    }

    return ordered
}

// ── Card ──────────────────────────────────────────────────────────────────────

function _card(game, position = null) {
    const img  = `/relay/images/steam/games/${game.appid}/header.jpg`
    const est  = _hltbLabel(game.hltb)
    const ptH  = game.playtime > 0 ? _fmtHours(game.playtime) : null

    const timeBadge = est
        ? `<span class="vault-card-time vault-card-time--hltb" title="HowLongToBeat estimate">${escapeHtml(est.label)}</span>`
        : `<span class="vault-card-time vault-card-time--unknown">?h</span>`

    const playedBadge = ptH
        ? `<span class="vault-card-played" title="Time played in Steam">${escapeHtml(ptH)} played</span>`
        : ''

    const numBadge = position !== null
        ? `<span class="vault-card-num">${position}</span>`
        : ''

    const upNextClass = position !== null ? ' vault-card--up-next' : ''

    return `
        <a class="vault-card${upNextClass}" href="/game/${game.appid}" data-appid="${game.appid}" draggable="true">
            <div class="vault-card-img-wrap">
                <img class="vault-card-img" src="${img}" alt="" loading="lazy" onerror="this.style.opacity='0'">
                <div class="vault-card-overlay"></div>
                ${numBadge}
                ${timeBadge}
            </div>
            <div class="vault-card-body">
                <span class="vault-card-name">${escapeHtml(game.name)}</span>
                ${playedBadge}
            </div>
        </a>`
}

// ── Drag and drop ─────────────────────────────────────────────────────────────

function _clearDropIndicators(container) {
    container.querySelectorAll('.vault-card--drop-before, .vault-card--drop-after').forEach(el => {
        el.classList.remove('vault-card--drop-before', 'vault-card--drop-after')
    })
}

function _initDrag(container) {
    container.querySelectorAll('.vault-card[data-appid]').forEach(el => {
        el.addEventListener('dragstart', e => {
            _draggedAppid = Number(el.dataset.appid)
            requestAnimationFrame(() => el.classList.add('vault-card--dragging'))
        })

        el.addEventListener('dragend', e => {
            _draggedAppid = null
            el.classList.remove('vault-card--dragging')
            _clearDropIndicators(container)
        })

        el.addEventListener('dragover', e => {
            e.preventDefault()
            if (_draggedAppid === null || _draggedAppid === Number(el.dataset.appid)) return
            _clearDropIndicators(container)
            const rect = el.getBoundingClientRect()
            const mid  = rect.left + rect.width / 2
            if (e.clientX < mid) {
                el.classList.add('vault-card--drop-before')
            } else {
                el.classList.add('vault-card--drop-after')
            }
        })

        el.addEventListener('dragleave', e => {
            if (!el.contains(e.relatedTarget)) {
                el.classList.remove('vault-card--drop-before', 'vault-card--drop-after')
            }
        })

        el.addEventListener('drop', e => {
            e.preventDefault()
            if (_draggedAppid === null) return

            const targetAppid = Number(el.dataset.appid)
            if (_draggedAppid === targetAppid) return

            const isBefore = el.classList.contains('vault-card--drop-before')
            _clearDropIndicators(container)

            const draggedIdx = _currentGames.findIndex(g => g.appid === _draggedAppid)
            if (draggedIdx === -1) return
            const [dragged] = _currentGames.splice(draggedIdx, 1)

            const targetIdx = _currentGames.findIndex(g => g.appid === targetAppid)
            if (targetIdx === -1) {
                _currentGames.push(dragged)
            } else {
                const insertAt = isBefore ? targetIdx : targetIdx + 1
                _currentGames.splice(insertAt, 0, dragged)
            }

            _saveOrder(_currentGames.map(g => g.appid))
            _renderDynamic(container, _currentGames)
        })
    })
}

// ── Random pick ───────────────────────────────────────────────────────────────

function _initRandomPick(container) {
    const btn = container.querySelector('#vault-random-btn')
    if (!btn) return

    const fresh = btn.cloneNode(true)
    btn.parentNode.replaceChild(fresh, btn)

    fresh.addEventListener('click', () => {
        if (!_currentGames.length) return
        const pick = _currentGames[Math.floor(Math.random() * _currentGames.length)]
        const card = container.querySelector(`.vault-card[data-appid="${pick.appid}"]`)
        if (!card) return

        // Flash highlight
        container.querySelectorAll('.vault-card--picked').forEach(el => el.classList.remove('vault-card--picked'))
        card.classList.add('vault-card--picked')
        card.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
}

// ── Dynamic section render ────────────────────────────────────────────────────

function _renderDynamic(container, games) {
    _currentGames = games

    const dynamic = container.querySelector('.vault-dynamic')
    if (!dynamic) return

    const queueGames = games.slice(0, 3)
    const restGames  = games.slice(3)

    const queueCards = queueGames.map((g, i) => _card(g, i + 1)).join('')

    const sepHtml = restGames.length > 0 ? `
        <div class="vault-rest-sep">
            <span class="vault-rest-sep-label">Queue &middot; ${restGames.length} more</span>
        </div>` : ''

    const restHtml = restGames.length > 0 ? `
        <div class="vault-grid">
            ${restGames.map(g => _card(g)).join('')}
        </div>` : ''

    dynamic.innerHTML = `
        <div class="vault-queue">
            <div class="vault-queue-header">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                <span class="vault-queue-label">Up Next</span>
                <span class="vault-queue-hint">Drag to reorder</span>
            </div>
            <div class="vault-queue-row">
                ${queueCards}
            </div>
        </div>
        ${sepHtml}
        ${restHtml}`

    _initDrag(container)
    _initRandomPick(container)
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

    const ordered = _applyOrder(games)

    const totalH   = _totalHours(ordered)
    const totalStr = totalH > 0
        ? `~${Math.round(totalH)}h of games waiting`
        : `${ordered.length} game${ordered.length !== 1 ? 's' : ''} waiting`

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
        <div class="vault-dynamic"></div>`

    _renderDynamic(container, ordered)
}
