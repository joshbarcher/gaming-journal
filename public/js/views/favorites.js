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

    const favoriteIds = Object.entries(flags)
        .filter(([, f]) => f.favorite)
        .map(([id]) => Number(id))

    if (!favoriteIds.length) return []

    const results = await Promise.all(favoriteIds.map(async appid => {
        const owned    = ownedMap.get(appid)
        let name       = owned?.name ?? null
        const playtime = owned?.playtime_forever ?? 0

        if (!name) {
            try {
                const r = await fetch(`/relay/api/games/${appid}`)
                if (r.ok) { const d = await r.json(); name = d?.name ?? null }
            } catch { /* ignore */ }
        }

        return { appid, name: name ?? `App ${appid}`, playtime }
    }))

    // Most played first
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

// ── Love meter — 5 hearts filled proportionally to top game's playtime ────────

function _hearts() {
    return `<span class="fav-hearts" aria-hidden="true">${
        Array.from({ length: 5 }, () => `<span class="fav-heart fav-heart--filled">♥</span>`).join('')
    }</span>`
}

// ── Hero card (top favorite) ──────────────────────────────────────────────────

function _hero(game, maxPlaytime) {
    const img   = `/relay/images/steam/games/${game.appid}/header.jpg`
    const hours = _fmtHours(game.playtime)

    return `
        <a class="fav-hero" href="/game/${game.appid}" data-appid="${game.appid}">
            <div class="fav-hero-bg-wrap">
                <div class="fav-hero-bg fav-hero-bg--a" style="background-image:url('${img}')"></div>
                <div class="fav-hero-bg fav-hero-bg--b"></div>
            </div>
            <div class="fav-hero-scrim"></div>
            <div class="fav-hero-body">
                ${_hearts()}
                <h2 class="fav-hero-name">${escapeHtml(game.name)}</h2>
                ${hours ? `<span class="fav-hero-hours">${escapeHtml(hours)}</span>` : ''}
            </div>
            <div class="fav-hero-shine"></div>
        </a>`
}

// ── Screenshot slideshow ──────────────────────────────────────────────────────

async function _startHeroSlideshow(container, appid) {
    const bgA = container.querySelector('.fav-hero-bg--a')
    const bgB = container.querySelector('.fav-hero-bg--b')
    if (!bgA || !bgB) return

    const headerUrl  = `/relay/images/steam/games/${appid}/header.jpg`
    const candidates = Array.from({ length: 20 }, (_, i) =>
        `/relay/images/steam/screenshots/${appid}/${i}.jpg`
    )

    // Probe all candidates in parallel — filter to ones that load
    const screenshots = (await Promise.all(
        candidates.map(url => new Promise(resolve => {
            const img = new Image()
            img.onload  = () => resolve(url)
            img.onerror = () => resolve(null)
            img.src = url
        }))
    )).filter(Boolean)

    if (screenshots.length === 0) return

    if (screenshots.length === 0) return

    const frames   = [headerUrl, ...screenshots]
    const INTERVAL = 6000
    const PAN_DUR  = 10000

    const randDir = () => Math.random() < 0.5 ? 'top' : 'bottom'

    // Pan from center toward a random edge — never snaps, works on visible or hidden layers
    function _pan(el, dir) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
            el.style.transition         = `opacity 1.5s ease, background-position ${PAN_DUR}ms linear`
            el.style.backgroundPosition = `center ${dir}`
        }))
    }

    // Kick off a slow drift on the header image immediately
    _pan(bgA, randDir())

    let idx      = 1
    let showingA = true

    const timer = setInterval(() => {
        if (!document.contains(bgA)) { clearInterval(timer); return }

        const url      = frames[idx % frames.length]
        const dir      = randDir()
        const incoming = showingA ? bgB : bgA
        const outgoing = showingA ? bgA : bgB
        idx++

        // Reset incoming to center (invisible at opacity 0 — no visible snap)
        incoming.style.transition         = 'none'
        incoming.style.backgroundImage    = `url('${url}')`
        incoming.style.backgroundPosition = 'center center'
        incoming.style.opacity            = '0'

        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!document.contains(bgA)) return
            // Fade in + drift toward a random edge
            incoming.style.transition         = `opacity 1.5s ease, background-position ${PAN_DUR}ms linear`
            incoming.style.opacity            = '1'
            incoming.style.backgroundPosition = `center ${dir}`
            // Fade out the outgoing layer — do NOT touch its transition.
            // Removing background-position from the transition would snap it to
            // its target value mid-pan. Just set opacity and let it finish its drift.
            outgoing.style.opacity = '0'
        }))

        showingA = !showingA
    }, INTERVAL)
}

// ── Standard card ─────────────────────────────────────────────────────────────

function _card(game, maxPlaytime) {
    const img   = `/relay/images/steam/games/${game.appid}/header.jpg`
    const hours = _fmtHours(game.playtime)

    return `
        <a class="fav-card" href="/game/${game.appid}">
            <div class="fav-card-img-wrap">
                <img class="fav-card-img" src="${img}" alt="" loading="lazy" onerror="this.style.opacity='0'">
                <div class="fav-card-shine"></div>
                ${hours ? `<span class="fav-card-hours">${escapeHtml(hours)}</span>` : ''}
            </div>
            <div class="fav-card-body">
                <span class="fav-card-name">${escapeHtml(game.name)}</span>
                ${_hearts()}
            </div>
        </a>`
}

// ── Main render ───────────────────────────────────────────────────────────────

export async function renderFavorites(container) {
    container.innerHTML = `<p class="page-loading">Loading Favorites…</p>`

    let games
    try {
        games = await _loadGames()
    } catch (err) {
        container.innerHTML = `<p class="page-error">Failed to load: ${escapeHtml(err.message)}</p>`
        return
    }

    if (!games.length) {
        container.innerHTML = `
            <div class="fav-header">
                <div class="fav-header-body">
                    <p class="fav-eyebrow">Collection</p>
                    <h1 class="fav-title">Favorites</h1>
                </div>
            </div>
            <p class="page-empty" style="padding:40px">
                No favorites yet. Open any game page and toggle the
                <strong>Favorite</strong> flag to add it here.
            </p>`
        return
    }

    const maxPlaytime = games[0].playtime   // always the most-played, for heart scaling
    const totalMins   = games.reduce((s, g) => s + g.playtime, 0)
    const subtitle    = `${games.length} game${games.length !== 1 ? 's' : ''} · ${_fmtHours(totalMins) ?? '0h'} played`

    const heroIdx = Math.floor(Math.random() * games.length)
    const hero    = games[heroIdx]
    const rest    = games.filter((_, i) => i !== heroIdx)

    container.innerHTML = `
        <div class="fav-header">
            <div class="fav-header-body">
                <p class="fav-eyebrow">Collection</p>
                <h1 class="fav-title">Favorites</h1>
                <p class="fav-subtitle">${subtitle}</p>
            </div>
        </div>

        <div class="fav-grid">
            ${_hero(hero, maxPlaytime)}
            ${rest.map(g => _card(g, maxPlaytime)).join('')}
        </div>`

    _startHeroSlideshow(container, hero.appid)
}
