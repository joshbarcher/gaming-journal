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

    // Default: most time invested first
    return results.sort((a, b) => b.playtime - a.playtime)
}

// ── Order persistence ─────────────────────────────────────────────────────────

async function _loadOrder() {
    try {
        const res = await fetch('/api/order/on-hold')
        if (!res.ok) return []
        const data = await res.json()
        return Array.isArray(data) ? data : []
    } catch {
        return []
    }
}

function _saveOrder(appids) {
    fetch('/api/order/on-hold', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(appids),
    }).catch(() => { /* best-effort */ })
}

async function _applyOrder(games) {
    const order   = await _loadOrder()
    const gameMap = new Map(games.map(g => [g.appid, g]))
    const ordered = []
    const seen    = new Set()

    for (const appid of order) {
        if (gameMap.has(appid)) {
            ordered.push(gameMap.get(appid))
            seen.add(appid)
        }
    }

    for (const g of games) {
        if (!seen.has(g.appid)) ordered.push(g)
    }

    return ordered
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

function _card(game, position = null) {
    const img     = `/relay/images/steam/games/${game.appid}/header.jpg`
    const playedH = _fmtHours(game.playtime)
    const { bar, label } = _progressBar(game)

    const timeBadge = playedH
        ? `<span class="onhold-card-time" title="Time played so far">${escapeHtml(playedH)}</span>`
        : ''

    const numBadge = position !== null
        ? `<span class="onhold-card-num">${position}</span>`
        : ''

    const upNextClass = position !== null ? ' onhold-card--up-next' : ''

    return `
        <a class="onhold-card${upNextClass}" href="/game/${game.appid}" data-appid="${game.appid}" draggable="true">
            <div class="onhold-card-img-wrap">
                <img class="onhold-card-img" src="${img}" alt="" loading="lazy" onerror="this.style.opacity='0'">
                <div class="onhold-card-overlay"></div>
                ${numBadge}
                ${timeBadge}
            </div>
            <div class="onhold-card-body">
                <span class="onhold-card-name">${escapeHtml(game.name)}</span>
                ${label ? `<span class="onhold-card-progress-label">${escapeHtml(label)}</span>` : ''}
            </div>
            ${bar}
        </a>`
}

// ── Drag and drop ─────────────────────────────────────────────────────────────

function _clearDropIndicators(container) {
    container.querySelectorAll('.onhold-card--drop-before, .onhold-card--drop-after').forEach(el => {
        el.classList.remove('onhold-card--drop-before', 'onhold-card--drop-after')
    })
}

function _initDrag(container) {
    container.querySelectorAll('.onhold-card[data-appid]').forEach(el => {
        el.addEventListener('dragstart', () => {
            _draggedAppid = Number(el.dataset.appid)
            requestAnimationFrame(() => el.classList.add('onhold-card--dragging'))
        })

        el.addEventListener('dragend', () => {
            _draggedAppid = null
            el.classList.remove('onhold-card--dragging')
            _clearDropIndicators(container)
        })

        el.addEventListener('dragover', e => {
            e.preventDefault()
            if (_draggedAppid === null || _draggedAppid === Number(el.dataset.appid)) return
            _clearDropIndicators(container)
            const rect = el.getBoundingClientRect()
            const mid  = rect.left + rect.width / 2
            if (e.clientX < mid) {
                el.classList.add('onhold-card--drop-before')
            } else {
                el.classList.add('onhold-card--drop-after')
            }
        })

        el.addEventListener('dragleave', e => {
            if (!el.contains(e.relatedTarget)) {
                el.classList.remove('onhold-card--drop-before', 'onhold-card--drop-after')
            }
        })

        el.addEventListener('drop', e => {
            e.preventDefault()
            if (_draggedAppid === null) return

            const targetAppid = Number(el.dataset.appid)
            if (_draggedAppid === targetAppid) return

            const isBefore   = el.classList.contains('onhold-card--drop-before')
            _clearDropIndicators(container)

            const draggedIdx = _currentGames.findIndex(g => g.appid === _draggedAppid)
            if (draggedIdx === -1) return
            const [dragged] = _currentGames.splice(draggedIdx, 1)

            const targetIdx = _currentGames.findIndex(g => g.appid === targetAppid)
            if (targetIdx === -1) {
                _currentGames.push(dragged)
            } else {
                _currentGames.splice(isBefore ? targetIdx : targetIdx + 1, 0, dragged)
            }

            _saveOrder(_currentGames.map(g => g.appid))
            _renderDynamic(container, _currentGames)
        })
    })
}

// ── Dynamic section render ────────────────────────────────────────────────────

function _renderDynamic(container, games) {
    _currentGames = games

    const dynamic = container.querySelector('.onhold-dynamic')
    if (!dynamic) return

    const queueGames = games.slice(0, 3)
    const restGames  = games.slice(3)

    const queueCards = queueGames.map((g, i) => _card(g, i + 1)).join('')

    const sepHtml = restGames.length > 0 ? `
        <div class="onhold-rest-sep">
            <span class="onhold-rest-sep-label">Queue &middot; ${restGames.length} more</span>
        </div>` : ''

    const restHtml = restGames.length > 0 ? `
        <div class="onhold-grid">
            ${restGames.map(g => _card(g)).join('')}
        </div>` : ''

    dynamic.innerHTML = `
        <div class="onhold-queue">
            <div class="onhold-queue-header">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
                <span class="onhold-queue-label">Up Next</span>
                <span class="onhold-queue-hint">Drag to reorder</span>
            </div>
            <div class="onhold-queue-row">
                ${queueCards}
            </div>
        </div>
        ${sepHtml}
        ${restHtml}`

    _initDrag(container)
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

    const ordered   = await _applyOrder(games)
    const totalMins = _totalPlaytime(ordered)
    const totalStr  = totalMins > 0
        ? `${_fmtHours(totalMins)} invested across ${ordered.length} paused game${ordered.length !== 1 ? 's' : ''}`
        : `${ordered.length} game${ordered.length !== 1 ? 's' : ''} paused`

    container.innerHTML = `
        <div class="onhold-header">
            <div class="onhold-header-body">
                <p class="onhold-eyebrow">Collection</p>
                <h1 class="onhold-title">In Progress</h1>
                <p class="onhold-subtitle">${totalStr}</p>
            </div>
        </div>
        <div class="onhold-dynamic"></div>`

    _renderDynamic(container, ordered)
}
