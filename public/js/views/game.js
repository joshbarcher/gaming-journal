import { escapeHtml } from '../utils.js'
import { refreshAlertsBadge } from '../sidebar.js'
import { openReviewModal, renderLocalReviewCard } from '../review-modal.js'
import { gameBackLabel, gameBackPath } from '../router.js'

export async function renderGame(appid, container) {
    // Clean up any nav rail left over from a previous game page
    _navRailEl?.remove()
    _navRailEl = null

    // Clear any live HLTB pin timer from a previous page visit
    if (_gpHltbTimer) { clearInterval(_gpHltbTimer); _gpHltbTimer = null }
    _gpHltbMilestones = _gpHltbMaxScale = null
    _gpBasePlaytimeMin = 0
    _gpRenderTime      = 0

    container.innerHTML = `<p class="page-loading">Loading…</p>`

    let game, itadData, pcgwData, communityReviews, myReview, playerCounts, flags, localReview, trailers, localWishlisted, news
    try {
        const [gameRes, itadRes, pcgwRes, crRes, mrRes, pcRes, flagsRes, localRevRes, trailersRes, localWlRes, newsRes] = await Promise.all([
            fetch(`/relay/api/games/${appid}`),
            fetch(`/relay/api/itad/${appid}`),
            fetch(`/relay/api/pcgw/${appid}`),
            fetch(`/relay/api/steam/community-reviews/${appid}`),
            fetch(`/relay/api/steam/reviews/${appid}`),
            fetch(`/relay/api/player-counts/${appid}`),
            fetch(`/api/flags/${appid}`),
            fetch(`/api/local-reviews/${appid}`),
            fetch(`/relay/api/videos/${appid}`),
            fetch(`/api/local-wishlist/${appid}`),
            fetch(`/relay/api/news/${appid}`),
        ])
        if (!gameRes.ok) throw new Error(gameRes.status === 404 ? 'Game not found' : `HTTP ${gameRes.status}`)
        game             = await gameRes.json()
        itadData         = itadRes.ok      ? await itadRes.json()      : null
        pcgwData         = pcgwRes.ok      ? await pcgwRes.json()      : null
        communityReviews = crRes.ok        ? await crRes.json()        : null
        myReview         = mrRes.ok        ? await mrRes.json()        : null
        playerCounts     = pcRes.ok        ? await pcRes.json()        : null
        flags            = flagsRes.ok     ? await flagsRes.json()     : {}
        localReview      = localRevRes.ok  ? await localRevRes.json()  : null
        trailers         = trailersRes.ok  ? await trailersRes.json()  : []
        localWishlisted  = localWlRes.ok   ? (await localWlRes.json()).wishlisted : false
        news             = newsRes.ok      ? await newsRes.json()      : null
        if (_newsBBCodeDirty(news)) {
            try {
                await fetch(`/relay/api/admin/news/${appid}/refresh`, { method: 'POST' })
                const freshRes = await fetch(`/relay/api/news/${appid}`)
                if (freshRes.ok) news = await freshRes.json()
            } catch { /* ignore — render whatever we have */ }
        } else {
            fetch(`/relay/api/admin/news/${appid}/refresh`, { method: 'POST' }).catch(() => {})
        }
    } catch (err) {
        container.innerHTML = `<p class="page-error">Failed to load: ${escapeHtml(err.message)}</p>`
        return
    }

    container.innerHTML = `
        ${_hero(game, communityReviews)}
        ${game.store?.unavailable ? `<div class="game-unavailable-banner"><span class="game-unavailable-icon">&#9888;</span> This game is no longer available on the Steam store.</div>` : ''}
        ${_releaseBanner(game)}
        <div class="game-flags-bar" data-appid="${appid}">
            ${_flagsBar(flags, game, localWishlisted)}
        </div>
        <div class="game-body">
            ${_trailers(appid, trailers)}
            ${_about(game)}
            ${_hltb(game)}
            ${_playerCounts(playerCounts, game)}
            ${_screenshots(game)}
            ${_news(news)}
            ${_localReviewSection(localReview, appid)}
            ${_myReview(myReview)}
            ${_communityReviews(communityReviews, game)}
            ${_itad(itadData, game)}
            ${_pcgw(pcgwData, game)}
        </div>`

    _startHeroSlideshow(container, game)
    _initPlayerChart(playerCounts, container)
    _initFlagsBar(container)
    _initWishlistBtn(container, game)
    _initLocalReviewSection(container, appid, game?.name ?? 'Game')
    _initSteamReview(container)
    _initTrailers(container, appid)
    _initNews(container)
    _initNavRail(container)
    _initHltbSessionUpdate(container, appid)
    _initHltbRefresh(container, game)
    _initPcgwRefresh(container, game)
    _initItadRefresh(container, game)

    // Fetch missing "About" description in the background and swap it in when ready
    if (!game.store?.detailedDescription && game.store && !game.store.unavailable && game.source !== 'discovered') {
        _loadAboutDynamic(container, appid)
    }

    // Progressively load any sections not yet cached (discovered games always,
    // library/wishlist games when HLTB is missing or previously unmatched)
    if (container.querySelector('.game-hltb-pending, .game-itad-pending, .game-pcgw-pending')) {
        _loadDiscoveredData(container, game)
    }

    // Community reviews: fetch on demand if not yet cached (covers discovered games + any
    // library game that hasn't been through the community-reviews sync yet)
    if (communityReviews === null && _releaseStatus(game) !== 'coming_soon') {
        _loadCommunityReviews(container, game)
    }

    container.querySelector('.game-shots-grid')?.addEventListener('click', e => {
        const img = e.target.closest('.game-shot-img')
        if (img) {
            const srcs = [...container.querySelectorAll('.game-shot-img')].map(i => i.src)
            _openModal(srcs, srcs.indexOf(img.src))
        }
    })

}

// ── Hero ──────────────────────────────────────────────────────────────────────

function _hero(game, communityReviews) {
    const screenshots = game.media?.screenshots ?? []
    const initBg  = screenshots[0] ?? game.media?.background ?? game.media?.header ?? ''
    const logoUrl = game.media?.logo ?? ''

    const desc   = game.store?.description ?? ''
    const genres = game.store?.genres ?? []
    const cats   = (game.store?.categories ?? []).filter(c =>
        ['Single-player', 'Multi-player', 'Co-op', 'Online Co-op',
         'Steam Achievements', 'Steam Cloud', 'Full controller support'].includes(c)
    )
    const tags = [...genres, ...cats].slice(0, 7)

    const badgesHtml = tags.map(t => `<span class="game-badge">${escapeHtml(t)}</span>`).join('')

    const logoHtml = logoUrl
        ? `<img class="game-hero-logo" src="${logoUrl}" alt="" onerror="this.style.display='none'">`
        : ''

    const bgAStyle = initBg ? ` style="background-image:url('${initBg}')"` : ''

    return `
        <section class="game-hero" id="game-sec-hero">
            <div class="game-hero-bg game-hero-bg--a"${bgAStyle}></div>
            <div class="game-hero-bg game-hero-bg--b"></div>
            <nav class="game-hero-nav">
                <a href="${gameBackPath()}" class="game-back-link">&#8592; ${escapeHtml(gameBackLabel())}</a>
            </nav>
            <div class="game-hero-body">
                <div class="game-hero-left">
                    <div class="game-hero-spacer"></div>
                    ${logoHtml}
                    <h1 class="game-hero-title">${escapeHtml(game.name)}</h1>
                    ${desc ? `<p class="game-hero-desc">${escapeHtml(desc)}</p>` : ''}
                    ${badgesHtml ? `<div class="game-hero-badges">${badgesHtml}</div>` : ''}
                </div>
                <div class="game-hero-right">
                    ${_dataPanel(game, communityReviews)}
                </div>
            </div>
        </section>`
}

async function _startHeroSlideshow(container, game) {
    const bgA = container.querySelector('.game-hero-bg--a')
    const bgB = container.querySelector('.game-hero-bg--b')
    if (!bgA || !bgB) return

    const shots = game.media?.screenshots ?? []
    const candidates = shots.length > 0
        ? shots
        : [game.media?.background].filter(Boolean)

    if (candidates.length < 2) return

    const frames = (await Promise.all(
        candidates.map(url => new Promise(resolve => {
            const img = new Image()
            img.onload  = () => resolve(url)
            img.onerror = () => resolve(null)
            img.src = url
        }))
    )).filter(Boolean)

    if (frames.length < 2) return

    // Shuffle so order is random each visit
    for (let i = frames.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [frames[i], frames[j]] = [frames[j], frames[i]]
    }

    const INTERVAL = 6_000
    const PAN_DUR  = 10_000
    const randDir  = () => Math.random() < 0.5 ? 'top' : 'bottom'
    const willPan  = () => Math.random() < 0.2

    function _applyTransition(el, pan) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
            el.style.transition         = pan
                ? `opacity 1.5s ease, background-position ${PAN_DUR}ms linear`
                : 'opacity 1.5s ease'
            if (pan) el.style.backgroundPosition = `center ${randDir()}`
        }))
    }

    _applyTransition(bgA, willPan())

    let idx = 1, showingA = true

    const timer = setInterval(() => {
        if (!document.contains(bgA)) { clearInterval(timer); return }

        const url      = frames[idx % frames.length]
        const incoming = showingA ? bgB : bgA
        const outgoing = showingA ? bgA : bgB
        const pan      = willPan()
        idx++

        incoming.style.transition         = 'none'
        incoming.style.backgroundImage    = `url('${url}')`
        incoming.style.backgroundPosition = 'center center'
        incoming.style.opacity            = '0'

        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!document.contains(bgA)) return
            incoming.style.transition = pan
                ? `opacity 1.5s ease, background-position ${PAN_DUR}ms linear`
                : 'opacity 1.5s ease'
            incoming.style.opacity            = '1'
            if (pan) incoming.style.backgroundPosition = `center ${randDir()}`
            outgoing.style.opacity = '0'
        }))

        showingA = !showingA
    }, INTERVAL)
}

function _scoreColor(n) {
    if (n == null) return null
    if (n >= 75) return { clr: '#4caf50', bg: 'rgba(76,175,80,0.13)' }
    if (n >= 50) return { clr: '#c9a84c', bg: 'rgba(201,168,76,0.13)' }
    return             { clr: '#e05050', bg: 'rgba(224,80,80,0.13)' }
}

function _scoreChip(source, score, display, id = '') {
    const idAttr = id ? ` id="${id}"` : ''
    if (score == null) {
        return `<div class="gdp-score-chip gdp-score-chip--missing"${idAttr}>
            <span class="gdp-score-chip-source">${source}</span>
            <span class="gdp-score-chip-value">—</span>
        </div>`
    }
    const c = _scoreColor(score)
    return `<div class="gdp-score-chip"${idAttr} style="--chip-clr:${c.clr};--chip-bg:${c.bg}">
        <span class="gdp-score-chip-source">${source}</span>
        <span class="gdp-score-chip-value">${display}</span>
    </div>`
}

function _dataPanel(game, communityReviews) {
    const rows = []

    // Scores row — Steam · OpenCritic (placeholder) · Metacritic
    const steamRatio = communityReviews?.summary?.ratio ?? null
    const mcData     = game.store?.metacritic
    const mcScore    = mcData?.score ?? (typeof mcData === 'number' ? mcData : null)

    rows.push(`<div class="gdp-score-row">
        ${_scoreChip('Steam',       steamRatio, steamRatio != null ? Math.round(steamRatio) + '%' : null, 'gdp-steam-chip')}
        ${_scoreChip('OpenCritic',  null,       null)}
        ${_scoreChip('Metacritic',  mcScore,    mcScore)}
    </div>`)

    // Playtime
    const playerHours = (game.playtimeMinutes ?? 0) / 60
    rows.push(_gdpRow('Played', playerHours > 0 ? _fmtHours(playerHours) : 'Not played'))

    // HLTB
    if (game.hltb?.matched) {
        rows.push(`<div class="gdp-divider"></div>`)
        if (game.hltb.gameplayMain          != null) rows.push(_gdpRow('Main Story',    _fmtHours(game.hltb.gameplayMain)))
        if (game.hltb.gameplayMainExtra     != null) rows.push(_gdpRow('Main + Extras', _fmtHours(game.hltb.gameplayMainExtra)))
        if (game.hltb.gameplayCompletionist != null) rows.push(_gdpRow('Completionist', _fmtHours(game.hltb.gameplayCompletionist)))
    }

    // ITAD pricing — wrapped so _initItadRefresh can patch it in-place after a refresh
    rows.push(_gdpPricesHtml(game.itad, game))

    // Release / developer / publisher / platforms
    rows.push(`<div class="gdp-divider"></div>`)
    if (game.store?.releaseDate) {
        const rs = _releaseStatus(game)
        const relLabel = rs === 'coming_soon'  ? 'Releases'
                       : rs === 'early_access' ? 'Early Access Since'
                       :                        'Released'
        rows.push(_gdpRow(relLabel, escapeHtml(game.store.releaseDate)))
    }
    if (game.store?.developers?.length)
        rows.push(_gdpRow('Developer', escapeHtml(game.store.developers[0])))
    if (game.store?.publishers?.length && game.store.publishers[0] !== game.store.developers?.[0])
        rows.push(_gdpRow('Publisher', escapeHtml(game.store.publishers[0])))

    const plat = game.store?.platforms
    if (plat) {
        const platList = [plat.windows && 'Windows', plat.mac && 'macOS', plat.linux && 'Linux'].filter(Boolean)
        if (platList.length) rows.push(_gdpRow('Platforms', platList.join(' · ')))
    }

    rows.push(`<div class="gdp-divider"></div>`)
    rows.push(_gdpRow('Steam ID', `<a class="gdp-steam-link" href="https://store.steampowered.com/app/${game.appid}" target="_blank" rel="noopener">${game.appid} ↗</a>`, true))

    return `<div class="game-data-panel">
        ${rows.join('')}
        <a href="/journal/${game.appid}" class="game-journal-btn"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;vertical-align:middle"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/></svg> Open Journal</a>
    </div>`
}

// Renders the ITAD price block for the data panel. Wrapped in display:contents so
// it can be replaced in-place by _initItadRefresh without breaking the flex layout.
function _gdpPricesHtml(itad, game) {
    const inner = []
    inner.push(`<div class="gdp-divider"></div>`)
    if (itad?.bestPrice) {
        const bp     = itad.bestPrice
        const cutStr = bp.cut > 0 ? ` <span class="gdp-cut">-${bp.cut}%</span>` : ''
        inner.push(_gdpRow('Best Price', `$${bp.price.toFixed(2)} · ${escapeHtml(bp.store)}${cutStr}`, true))
    } else if (game.store?.isFree) {
        inner.push(_gdpRow('Price', 'Free to Play'))
    } else if (game.store?.price?.final_formatted) {
        inner.push(_gdpRow('Price', escapeHtml(game.store.price.final_formatted) + ' · Steam'))
    }
    if (itad?.historicalLow) {
        const hl = itad.historicalLow
        const yr = hl.date ? ` (${hl.date.slice(0, 4)})` : ''
        inner.push(_gdpRow('All-Time Low', `$${hl.price.toFixed(2)} · ${escapeHtml(hl.store)}${yr}`))
    }
    return `<div data-role="gdp-prices" style="display:contents">${inner.join('')}</div>`
}

function _gdpRow(label, value, raw = false) {
    return `
        <div class="gdp-row">
            <span class="gdp-label">${escapeHtml(label)}</span>
            <span class="gdp-value">${raw ? value : escapeHtml(value)}</span>
        </div>`
}

// ── HLTB bar ──────────────────────────────────────────────────────────────────

function _hltb(game, sessionElapsedMins = 0) {
    if (_releaseStatus(game) === 'coming_soon') return ''

    const hltb    = game.hltb
    // Use || not ?? so that 0 counts as "no times" (HLTB found the game but times
    // haven't been submitted yet — treat the same as unmatched for display purposes)
    const hasData = hltb?.matched &&
        !!(hltb.gameplayMain || hltb.gameplayMainExtra || hltb.gameplayCompletionist)

    if (!hasData) {
        // No data yet — show a pending placeholder so the async loader can fetch
        // and swap it in dynamically.  This covers:
        //   • Discovered games (never fetched)
        //   • Library/wishlist games where HLTB returned no match last time
        //     (the server will retry; page visit also triggers an on-demand attempt)
        _gpHltbMilestones = null
        return '<div class="game-hltb-pending"></div>'
    }

    // game.playtimeMinutes is relay effectiveMin — already includes any live session elapsed.
    // sessionElapsedMins is 0 at initial render (default arg); the live timer in
    // _initHltbSessionUpdate advances the pin using delta from _gpRenderTime.
    const playerHours = (game.playtimeMinutes ?? 0) / 60 + sessionElapsedMins / 60

    const milestones  = [
        { label: 'Main',          h: hltb.gameplayMain          },
        { label: 'Main + Extras', h: hltb.gameplayMainExtra     },
        { label: 'Completionist', h: hltb.gameplayCompletionist },
    ].filter(m => m.h != null && m.h > 0)

    // Store for live HLTB pin recalculation — null when no HLTB data available.
    // relay effectiveMin (playtimeMinutes) already includes any live session elapsed up
    // to this render; the timer adds delta from _gpRenderTime forward, not session start.
    _gpHltbMilestones  = milestones.length ? milestones : null
    _gpHltbMaxScale    = null  // computed below
    _gpBasePlaytimeMin = game.playtimeMinutes ?? 0
    _gpRenderTime      = Date.now()

    if (!milestones.length) {
        return `
            <section class="game-section" id="game-sec-hltb">
                <h2 class="game-section-title">How Long To Beat<button class="game-refresh-btn" data-role="hltb-refresh" title="Refresh HLTB data">↻</button></h2>
                <p class="game-section-empty">No data available for this game.</p>
            </section>`
    }

    // Sqrt scale so a wide range (e.g. 30h main / 200h completionist) doesn't
    // clump everything on the left side of the bar.
    const allVals  = [...milestones.map(m => m.h), playerHours > 0 ? playerHours : null].filter(Boolean)
    const maxScale = Math.max(...allVals) * 1.08
    _gpHltbMaxScale = maxScale  // persist so delta updates use the same coordinate space
    const pct      = h => (Math.sqrt(h) / Math.sqrt(maxScale)) * 100

    const labelsHtml = milestones.map(m =>
        `<span class="hltb-lbl" style="left:${pct(m.h).toFixed(2)}%">${escapeHtml(m.label)}</span>`
    ).join('')

    const ticksHtml = milestones.map(m =>
        `<div class="hltb-tick" style="left:${pct(m.h).toFixed(2)}%"></div>`
    ).join('')

    const hoursHtml = milestones.map(m =>
        `<span class="hltb-hr" style="left:${pct(m.h).toFixed(2)}%">${_fmtHours(m.h)}</span>`
    ).join('')

    const pinPos  = playerHours > 0 ? pct(playerHours) : null
    const fillPct = pinPos ?? pct(milestones[0].h)
    const pinHtml = pinPos != null
        ? `<div class="hltb-pin" data-role="hltb-pin" style="left:${pinPos.toFixed(2)}%" data-label="${_fmtHours(playerHours)} played"></div>`
        : ''

    return `
        <section class="game-section" id="game-sec-hltb">
            <h2 class="game-section-title">How Long To Beat<button class="game-refresh-btn" data-role="hltb-refresh" title="Refresh HLTB data">↻</button></h2>
            <div class="hltb-bar-wrap">
                <div class="hltb-labels-row">${labelsHtml}</div>
                <div class="hltb-track-wrap">
                    <div class="hltb-track">
                        <div class="hltb-fill" data-role="hltb-fill" style="width:${fillPct.toFixed(2)}%"></div>
                    </div>
                    ${ticksHtml}
                    ${pinHtml}
                </div>
                <div class="hltb-hours-row">${hoursHtml}</div>
            </div>
        </section>`
}

// ── ITAD Prices ───────────────────────────────────────────────────────────────

const _SVG_CLOCK = `<svg class="itad-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`
const _SVG_EXT   = `<svg class="itad-ext" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`

// Stores hidden in favour of a preferred regional variant
const _HIDDEN_STORES = new Set(['gamesplanet uk', 'gamesplanet fr', 'gamesplanet de'])

// Map ITAD store name (lowercase) → local SVG filename (without extension)
const _STORE_ICONS = {
    'humble store':   'humblestore',
    'gamesplanet us': 'gamesplanet',
    'steam':          'steam',
    'greenmangaming': 'greenmangaming',
    'fanatical':      'fanatical',
    'gamebillet':     'gamebillet.webp',
}

function _storeIconHtml(storeName) {
    const file = _STORE_ICONS[storeName.toLowerCase()]
    const src = file.includes('.') ? file : `${file}.svg`
    return file ? `<img class="itad-store-icon" data-store="${file}" src="/images/stores/${src}" alt="">` : ''
}

function _itad(itad, game) {
    // Discovered game: data not yet fetched — placeholder for async progressive load
    if (game?.source === 'discovered' && itad === null) return '<div class="game-itad-pending"></div>'

    const refreshBtn = `<button class="game-refresh-btn" data-role="itad-refresh" title="Refresh price data">↻</button>`

    // No deal data — show an empty state so the section (and nav rail link) stays present
    if (!itad?.deals?.length) {
        return `
        <section class="game-section" id="game-sec-prices">
            <h2 class="game-section-title">Prices${refreshBtn}</h2>
            <p class="game-section-empty">No price data available for this game.</p>
        </section>`
    }

    const deals = itad.deals.filter(d => !_HIDDEN_STORES.has(d.store.toLowerCase()))

    const hl = itad.historicalLow
    const historicHtml = hl ? `
        <div class="itad-historic">
            ${_SVG_CLOCK}
            <span class="itad-historic-label">All-time low</span>
            <span class="itad-historic-price">$${hl.price.toFixed(2)}</span>
            <span class="itad-historic-cut">-${hl.cut}%</span>
            <span class="itad-historic-meta">${escapeHtml(hl.store)}${hl.date ? ` · ${hl.date.slice(0, 4)}` : ''}</span>
        </div>` : ''

    const cardsHtml = deals.map((d, i) => {
        const cutClass = d.cut >= 50 ? 'itad-cut--high' : 'itad-cut--mid'
        const cutHtml  = d.cut > 0 ? `<span class="itad-cut ${cutClass}">-${d.cut}%</span>` : ''
        const wasHtml  = d.cut > 0 ? `<span class="itad-was">$${d.regular.toFixed(2)}</span>` : ''
        const priceStr = d.price === 0 ? 'Free' : `$${d.price.toFixed(2)}`
        const logoHtml = _storeIconHtml(d.store)

        return `
            <a class="itad-card${i === 0 ? ' itad-card--best' : ''}" href="${escapeHtml(d.url)}" target="_blank" rel="noopener noreferrer">
                <div class="itad-card-logo">${logoHtml}</div>
                <span class="itad-card-name">${escapeHtml(d.store)}</span>
                <span class="itad-card-price">${priceStr}</span>
                ${cutHtml || wasHtml ? `<div class="itad-card-meta">${cutHtml}${wasHtml}</div>` : ''}
            </a>`
    }).join('')

    return `
        <section class="game-section" id="game-sec-prices">
            <h2 class="game-section-title">Prices${refreshBtn}</h2>
            ${historicHtml}
            <div class="itad-cards">${cardsHtml}</div>
        </section>`
}

// ── Trailers ──────────────────────────────────────────────────────────────────

function _trailers(appid, trailers) {
    if (!trailers?.length) return ''

    const firstThumb = trailers[0]?.thumbnail ?? ''
    const playerHtml = `
        <div class="trailers-player-wrap">
            <video class="trailers-player" controls preload="metadata"
                   src="/relay/videos/steam/${appid}/0.mp4"${firstThumb ? ` poster="${firstThumb}"` : ''}></video>
        </div>`

    if (trailers.length === 1) {
        return `
            <section class="game-section game-trailers" id="game-sec-trailers" data-appid="${appid}">
                <h2 class="game-section-title">Trailers</h2>
                <div class="trailers-single">${playerHtml}</div>
            </section>`
    }

    const listHtml = `
        <div class="trailers-list">
            ${trailers.map((t, i) => `
                <button class="trailers-thumb${i === 0 ? ' trailers-thumb--active' : ''}" data-index="${t.index}" data-thumbnail="${t.thumbnail ?? ''}">
                    <div class="trailers-thumb-img-wrap">
                        ${t.thumbnail
                            ? `<img class="trailers-thumb-img" src="${t.thumbnail}" alt="" loading="lazy" onerror="this.style.display='none'">`
                            : ''}
                        <span class="trailers-play-icon">&#9654;</span>
                    </div>
                    <span class="trailers-thumb-name">${escapeHtml(t.name)}</span>
                </button>`).join('')}
        </div>`

    return `
        <section class="game-section game-trailers" id="game-sec-trailers" data-appid="${appid}">
            <h2 class="game-section-title">Trailers</h2>
            <div class="trailers-layout">
                ${playerHtml}
                ${listHtml}
            </div>
        </section>`
}

function _initTrailers(container) {
    const section = container.querySelector('.game-trailers')
    if (!section) return

    const appid  = section.dataset.appid
    const player = section.querySelector('.trailers-player')
    const thumbs = section.querySelectorAll('.trailers-thumb')

    thumbs.forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('trailers-thumb--active')) return

            thumbs.forEach(b => b.classList.remove('trailers-thumb--active'))
            btn.classList.add('trailers-thumb--active')

            player.poster = btn.dataset.thumbnail ?? ''
            player.src = `/relay/videos/steam/${appid}/${btn.dataset.index}.mp4`
            player.play().catch(() => {})
        })
    })
}

// ── News ──────────────────────────────────────────────────────────────────────

const _BB_RE = /\[(?:b|i|u|s|h[1-6]|url|img|list|quote|code|spoiler|strike)[=\]]/i

function _newsBBCodeDirty(news) {
    return news?.items?.some(item => _BB_RE.test(item.contents ?? ''))
}

function _news(news) {
    const items = news?.items
    if (!items?.length) return ''

    const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

    const listHtml = items.map((item, i) => {
        const date = item.date ? fmt.format(new Date(item.date * 1000)) : ''
        return `
            <button class="news-item${i === 0 ? ' news-item--active' : ''}" data-index="${i}">
                <span class="news-item-feed">${escapeHtml(item.feedlabel)}</span>
                <span class="news-item-title">${escapeHtml(item.title)}</span>
                <span class="news-item-date">${date}</span>
            </button>`
    }).join('')

    const first = items[0]
    const firstDate = first.date ? fmt.format(new Date(first.date * 1000)) : ''
    const panelHtml = `
        <div class="news-panel">
            <div class="news-panel-meta">
                <span class="news-panel-feed">${escapeHtml(first.feedlabel)}</span>
                <span class="news-panel-date">${firstDate}</span>
                ${first.url ? `<a class="news-panel-link" href="${first.url}" target="_blank" rel="noopener noreferrer">Read full article ↗</a>` : ''}
            </div>
            <h3 class="news-panel-title">${escapeHtml(first.title)}</h3>
            <div class="news-panel-body">${first.contents ?? ''}</div>
        </div>`

    const newsJson = JSON.stringify(items).replace(/"/g, '&quot;')

    return `
        <section class="game-section game-news" id="game-sec-news" data-news="${newsJson}">
            <h2 class="game-section-title">News</h2>
            <div class="news-layout">
                <div class="news-list">${listHtml}</div>
                ${panelHtml}
            </div>
        </section>`
}

function _initNews(container) {
    const section = container.querySelector('.game-news')
    if (!section) return

    const items   = section.querySelectorAll('.news-item')
    const panel   = section.querySelector('.news-panel')
    if (!items.length || !panel) return

    // Pre-parse all item data from the DOM isn't ideal — store on element instead
    const newsData = Array.from(items).map(btn => {
        const idx = Number(btn.dataset.index)
        return { btn, idx }
    })

    // Collect raw content from the already-rendered first item; others come from JS data.
    // We store the news payload on the section element at render time.
    const raw = JSON.parse(section.dataset.news ?? '[]')
    const fmt  = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

    items.forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('news-item--active')) return
            items.forEach(b => b.classList.remove('news-item--active'))
            btn.classList.add('news-item--active')

            const item = raw[Number(btn.dataset.index)]
            if (!item) return

            const date = item.date ? fmt.format(new Date(item.date * 1000)) : ''
            const link = item.url
                ? `<a class="news-panel-link" href="${item.url}" target="_blank" rel="noopener noreferrer">Read full article ↗</a>`
                : ''

            panel.querySelector('.news-panel-meta').innerHTML =
                `<span class="news-panel-feed">${escapeHtml(item.feedlabel)}</span>
                 <span class="news-panel-date">${date}</span>
                 ${link}`
            panel.querySelector('.news-panel-title').textContent = item.title
            panel.querySelector('.news-panel-body').innerHTML    = item.contents ?? ''
        })
    })
}

// ── Screenshots ───────────────────────────────────────────────────────────────

function _screenshots(game) {
    const apiShots = (game.media?.screenshots ?? []).filter(Boolean)

    const urls = apiShots.length > 0
        ? apiShots
        : Array.from({ length: 25 }, (_, i) => `/relay/images/steam/screenshots/${game.appid}/${i}.jpg`)

    const imgsHtml = urls.map(url => `
        <div class="game-shot-item">
            <img class="game-shot-img" src="${url}" alt="Screenshot"
                 onerror="this.closest('.game-shot-item').remove()">
        </div>`).join('')

    return `
        <section class="game-section" id="game-sec-screenshots">
            <h2 class="game-section-title">Screenshots</h2>
            <div class="game-shots-grid">${imgsHtml}</div>
            <p class="game-section-empty game-shots-fallback">No screenshots available.</p>
        </section>`
}

// ── About This Game ───────────────────────────────────────────────────────────

function _about(game) {
    const html = game.store?.detailedDescription
    if (html) {
        return `
            <section class="game-section game-about" id="game-sec-about">
                <h2 class="game-section-title">About This Game</h2>
                <div class="game-about-body">${html}</div>
            </section>`
    }
    // Known library/wishlist game with store data but missing description —
    // render a placeholder that _loadAboutDynamic will replace on load.
    if (game.store && !game.store.unavailable && game.source !== 'discovered') {
        return `<div class="game-about-pending"></div>`
    }
    return ''
}

async function _loadAboutDynamic(container, appid) {
    const placeholder = container.querySelector('.game-about-pending')
    if (!placeholder) return

    try {
        const res = await fetch(`/relay/api/games/${appid}?refresh=true`)
        if (!res.ok) { placeholder.remove(); return }

        const refreshed = await res.json()
        if (!refreshed.store?.detailedDescription) { placeholder.remove(); return }

        const tmp = document.createElement('div')
        tmp.innerHTML = `
            <section class="game-section game-about" id="game-sec-about">
                <h2 class="game-section-title">About This Game</h2>
                <div class="game-about-body">${refreshed.store.detailedDescription}</div>
            </section>`
        placeholder.replaceWith(tmp.firstElementChild)
        _navRailEl?._rebuild?.()
    } catch {
        placeholder.remove()
    }
}

// ── PCGamingWiki ──────────────────────────────────────────────────────────────

const _PI = {
    monitor:  `<svg class="pcgw-icon" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`,
    maximize: `<svg class="pcgw-icon" viewBox="0 0 24 24"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`,
    sun:      `<svg class="pcgw-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`,
    zap:      `<svg class="pcgw-icon" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    activity: `<svg class="pcgw-icon" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
    refresh:  `<svg class="pcgw-icon" viewBox="0 0 24 24"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>`,
    sparkles: `<svg class="pcgw-icon" viewBox="0 0 24 24"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`,
    layers:   `<svg class="pcgw-icon" viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
    aim:      `<svg class="pcgw-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>`,
    aperture: `<svg class="pcgw-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="14.31" y1="8" x2="20.05" y2="17.94"/><line x1="9.69" y1="8" x2="21.17" y2="8"/><line x1="7.38" y1="12" x2="13.12" y2="2.06"/><line x1="9.69" y1="16" x2="3.95" y2="6.06"/><line x1="14.31" y1="16" x2="2.83" y2="16"/><line x1="16.62" y1="12" x2="10.88" y2="21.94"/></svg>`,
    film:     `<svg class="pcgw-icon" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>`,
    arrowUp:  `<svg class="pcgw-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="16 12 12 8 8 12"/><line x1="12" y1="16" x2="12" y2="8"/></svg>`,
    eye:      `<svg class="pcgw-icon" viewBox="0 0 24 24"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`,
    mouse:    `<svg class="pcgw-icon" viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="7"/><path d="M12 6v4"/></svg>`,
    keyboard: `<svg class="pcgw-icon" viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/></svg>`,
    gamepad:  `<svg class="pcgw-icon" viewBox="0 0 24 24"><line x1="6" y1="12" x2="10" y2="12"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="15" y1="13" x2="15.01" y2="13"/><line x1="18" y1="11" x2="18.01" y2="11"/><rect x="2" y="8" width="20" height="12" rx="4"/></svg>`,
    cloud:    `<svg class="pcgw-icon" viewBox="0 0 24 24"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`,
    folder:   `<svg class="pcgw-icon" viewBox="0 0 24 24"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>`,
    save:     `<svg class="pcgw-icon" viewBox="0 0 24 24"><path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/></svg>`,
    shield:   `<svg class="pcgw-icon" viewBox="0 0 24 24"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>`,
    wrench:   `<svg class="pcgw-icon" viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
    extLink:  `<svg class="pcgw-icon pcgw-icon--xs" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
}

function _pcgwBadge(val) {
    if (val === 'true')     return `<span class="pcgw-badge pcgw-badge--yes">Yes</span>`
    if (val === 'false')    return `<span class="pcgw-badge pcgw-badge--no">No</span>`
    if (val === 'hackable') return `<span class="pcgw-badge pcgw-badge--hack">Hackable</span>`
    return null
}

function _pcgwRows(obj, defs) {
    return defs
        .filter(([key]) => obj?.[key] != null)
        .map(([key, label]) => {
            const badge = _pcgwBadge(obj[key])
            return badge
                ? `<div class="pcgw-row"><span class="pcgw-row-label">${label}</span>${badge}</div>`
                : ''
        }).join('')
}

function _pcgw(pcgwData, game) {
    if (!pcgwData?.found) {
        // Discovered released/EA game, data not yet fetched — placeholder for async load
        if (game?.source === 'discovered' && pcgwData === null && _releaseStatus(game) !== 'coming_soon')
            return '<div class="game-pcgw-pending"></div>'
        return ''
    }

    const v      = pcgwData.video        ?? {}
    const inp    = pcgwData.input        ?? {}
    const cl     = pcgwData.cloud        ?? {}
    const av     = pcgwData.availability ?? {}
    const paths  = pcgwData.paths        ?? {}
    const fixes  = pcgwData.fixes        ?? []

    // ── Video ───────────────────────────────────────────
    const videoFeatures = [
        { key: 'widescreen', icon: _PI.monitor,  label: 'Widescreen' },
        { key: 'ultrawide',  icon: _PI.monitor,  label: 'Ultrawide' },
        { key: 'uhd4k',      icon: _PI.maximize, label: '4K UHD' },
        { key: 'hdr',        icon: _PI.sun,      label: 'HDR' },
        { key: 'fps60',      icon: _PI.zap,      label: '60 FPS' },
        { key: 'fps120',     icon: _PI.activity, label: '120+ FPS' },
        { key: 'vsync',      icon: _PI.refresh,  label: 'VSync' },
        { key: 'aa',         icon: _PI.sparkles, label: 'Anti-Aliasing' },
        { key: 'af',         icon: _PI.layers,   label: 'Aniso. Filtering' },
        { key: 'fov',        icon: _PI.aim,      label: 'FOV Control' },
        { key: 'rayTracing', icon: _PI.aperture, label: 'Ray Tracing' },
        { key: 'frameGen',   icon: _PI.film,     label: 'Frame Generation' },
        { key: 'upscaling',  icon: _PI.arrowUp,  label: 'Upscaling' },
        { key: 'colorBlind', icon: _PI.eye,      label: 'Color Blind Mode' },
    ].filter(f => v[f.key] != null)

    const videoHtml = videoFeatures.map(f => {
        const badge = _pcgwBadge(v[f.key])
        return badge ? `
            <div class="pcgw-feature-tile">
                ${f.icon}
                <span class="pcgw-tile-label">${f.label}</span>
                ${badge}
            </div>` : ''
    }).join('')

    // ── Input ───────────────────────────────────────────
    const mouseRows = _pcgwRows(inp.mouse, [
        ['sensitivity', 'Sensitivity'],
        ['acceleration', 'Raw input / no accel'],
        ['inMenus',      'Works in menus'],
        ['yInversion',   'Y-axis inversion'],
        ['kbmPrompts',   'KB/M prompts'],
    ])
    const kbRows = _pcgwRows(inp.keyboard, [
        ['remapping',  'Key remapping'],
        ['steamInput', 'Steam Input'],
    ])
    const ctrlRows = _pcgwRows(inp.controller, [
        ['support',           'Controller support'],
        ['fullSupport',       'Full controller'],
        ['remapping',         'Button remapping'],
        ['sensitivity',       'Sensitivity'],
        ['yInversion',        'Y-axis inversion'],
        ['hotplugging',       'Hot-plugging'],
        ['simultaneousInput', 'Simultaneous input'],
        ['hapticFeedback',    'Haptic feedback'],
        ['promptOverride',    'Prompt override'],
        ['xinput',            'XInput'],
        ['dinput',            'DirectInput'],
        ['playstation',       'PlayStation'],
        ['nintendo',          'Nintendo'],
    ]) + _pcgwRows(inp.platform, [
        ['xboxPrompts',        'Xbox prompts'],
        ['impulseTriggers',    'Impulse triggers'],
        ['playstationPrompts', 'PlayStation prompts'],
        ['lightBar',           'Light bar'],
        ['adaptiveTriggers',   'Adaptive triggers'],
        ['dualSenseHaptics',   'DualSense haptics'],
        ['motionSensors',      'Motion sensors'],
        ['steamDeckPrompts',   'Steam Deck prompts'],
        ['touchscreen',        'Touchscreen'],
    ])

    const inputCards = [
        { title: 'Mouse',      icon: _PI.mouse,    rows: mouseRows, multiCol: false },
        { title: 'Keyboard',   icon: _PI.keyboard, rows: kbRows,    multiCol: false },
        { title: 'Controller', icon: _PI.gamepad,  rows: ctrlRows,  multiCol: true  },
    ].filter(c => c.rows).map(c => `
        <div class="pcgw-input-card${c.multiCol ? ' pcgw-input-card--fit' : ''}">
            <div class="pcgw-card-title">${c.icon}${c.title}</div>
            ${c.multiCol ? `<div class="pcgw-rows-multicol">${c.rows}</div>` : c.rows}
        </div>`).join('')

    // ── Availability ────────────────────────────────────
    const drmChips = (av.drm ?? []).map(d => `<span class="pcgw-chip">${escapeHtml(d)}</span>`).join('')
    const cloudRows = _pcgwRows(cl, [
        ['steam',          'Steam'],
        ['gogGalaxy',      'GOG Galaxy'],
        ['epicGames',      'Epic Games'],
        ['eaApp',          'EA App'],
        ['xbox',           'Xbox'],
        ['ubisoftConnect', 'Ubisoft Connect'],
        ['xboxCloud',      'Xbox Cloud'],
        ['oneDrive',       'OneDrive'],
    ])

    // ── Paths ───────────────────────────────────────────
    const _pathCard = (title, icon, pathObj) => {
        const entries = Object.entries(pathObj ?? {})
        if (!entries.length) return ''
        const rows = entries.map(([os, path]) => `
            <div class="pcgw-path-row">
                <span class="pcgw-path-os">${escapeHtml(os)}</span>
                <code class="pcgw-path-code">${escapeHtml(path)}</code>
            </div>`).join('')
        return `
            <div class="pcgw-path-card">
                <div class="pcgw-card-title">${icon}${title}</div>
                ${rows}
            </div>`
    }

    // ── Fixes ───────────────────────────────────────────
    const fixesHtml = fixes.map(f => `
        <details class="pcgw-fix">
            <summary>${_PI.wrench}${escapeHtml(f.title)}</summary>
            <div class="pcgw-fix-body">${f.html}</div>
        </details>`).join('')

    return `
        <section class="game-section" id="game-sec-pcgw">
            <h2 class="game-section-title">
                PCGamingWiki${pcgwData.pageUrl
                    ? ` <a class="pcgw-wiki-link" href="${escapeHtml(pcgwData.pageUrl)}" target="_blank" rel="noopener">${_PI.extLink}</a>`
                    : ''}
                <button class="game-refresh-btn" data-role="pcgw-refresh" title="Refresh PCGamingWiki data">↻</button>
            </h2>

            ${videoHtml ? `
            <div class="pcgw-block">
                <h3 class="pcgw-block-title">${_PI.monitor}Video &amp; Display</h3>
                <div class="pcgw-feature-grid">${videoHtml}</div>
            </div>` : ''}

            ${inputCards ? `
            <div class="pcgw-block">
                <h3 class="pcgw-block-title">${_PI.gamepad}Input</h3>
                <div class="pcgw-input-grid">${inputCards}</div>
            </div>` : ''}

            ${drmChips || cloudRows ? `
            <div class="pcgw-block">
                <h3 class="pcgw-block-title">${_PI.shield}Availability &amp; Cloud Saves</h3>
                <div class="pcgw-avail-grid">
                    ${drmChips ? `
                    <div class="pcgw-input-card">
                        <div class="pcgw-card-title">${_PI.shield}DRM</div>
                        <div class="pcgw-chip-row">${drmChips}</div>
                    </div>` : ''}
                    ${cloudRows ? `
                    <div class="pcgw-input-card">
                        <div class="pcgw-card-title">${_PI.cloud}Cloud Saves</div>
                        ${cloudRows}
                    </div>` : ''}
                </div>
            </div>` : ''}

            <div class="pcgw-block pcgw-block--files" id="Game_data">
                <h3 class="pcgw-block-title">${_PI.save}Save &amp; Config Locations</h3>
                <div class="pcgw-paths-grid">
                    ${_pathCard('Save Game', _PI.save, paths.saveGame)}
                    ${_pathCard('Config File', _PI.folder, paths.config)}
                </div>
            </div>

            ${fixesHtml ? `
            <div class="pcgw-block">
                <h3 class="pcgw-block-title">${_PI.wrench}Fixes &amp; Tweaks</h3>
                <div class="pcgw-fixes">${fixesHtml}</div>
            </div>` : ''}
        </section>`
}

// ── Player Counts ─────────────────────────────────────────────────────────────

const _PC_GRANULARITIES = [
    { key: '24h', label: '24h',  windowMs: 24 * 60 * 60 * 1_000,       bucketMs: 30 * 60 * 1_000 },
    { key: '7d',  label: '7d',   windowMs: 7  * 24 * 60 * 60 * 1_000,  bucketMs: 2  * 60 * 60 * 1_000 },
    { key: '30d', label: '30d',  windowMs: 30 * 24 * 60 * 60 * 1_000,  bucketMs: 6  * 60 * 60 * 1_000 },
    { key: '1y',  label: '1y',   windowMs: 365 * 24 * 60 * 60 * 1_000, bucketMs: 24 * 60 * 60 * 1_000 },
]

function _downsample(samples, windowMs, bucketMs) {
    const nowMs  = Date.now()
    const cutoff = nowMs - windowMs
    const buckets = new Map()
    for (const [tSec, n] of samples) {
        const tMs = tSec * 1000
        if (tMs < cutoff) continue
        const bucket = Math.floor(tMs / bucketMs) * bucketMs
        buckets.set(bucket, n)
    }
    return [...buckets.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([t, n]) => ({ x: t, y: n }))
}

function _fmtPlayerCount(n) {
    if (!n) return '—'
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
    return n.toLocaleString()
}

function _playerCounts(data, game) {
    if (_releaseStatus(game) === 'coming_soon') return ''

    if (!data?.samples?.length) {
        return `
            <section class="game-section" id="game-sec-player-count">
                <h2 class="game-section-title">Player Count</h2>
                <p class="game-section-empty">No player count data collected yet.</p>
            </section>`
    }

    const latest = data.samples[data.samples.length - 1]?.[1] ?? 0

    const tabs = _PC_GRANULARITIES.map(g =>
        `<button class="pc-tab${g.key === '7d' ? ' pc-tab--active' : ''}" data-granularity="${g.key}">${g.label}</button>`
    ).join('')

    return `
        <section class="game-section" id="game-sec-player-count">
            <h2 class="game-section-title">Player Count</h2>
            <div class="pc-header">
                <span class="pc-current">${_fmtPlayerCount(latest)} <span class="pc-current-label">playing now</span></span>
                <div class="pc-tabs">${tabs}</div>
            </div>
            <div class="pc-chart-wrap">
                <canvas id="pc-chart"></canvas>
            </div>
        </section>`
}

let _pcChart = null

function _initPlayerChart(data, container) {
    if (!data?.samples?.length) return
    if (typeof Chart === 'undefined') return

    const canvas = container.querySelector('#pc-chart')
    if (!canvas) return

    const accentColor = getComputedStyle(document.documentElement)
        .getPropertyValue('--clr-accent').trim() || '#7c6ff7'

    function _buildDataset(granularityKey) {
        const g = _PC_GRANULARITIES.find(x => x.key === granularityKey)
        return _downsample(data.samples, g.windowMs, g.bucketMs)
    }

    function _fmtLabel(tMs, key) {
        const d = new Date(tMs)
        if (key === '24h') return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
        if (key === '7d')  return d.toLocaleDateString(undefined, { weekday: 'short', hour: '2-digit' })
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    }

    let activeKey = '7d'
    let pts = _buildDataset(activeKey)

    if (_pcChart) { _pcChart.destroy(); _pcChart = null }

    _pcChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: pts.map(p => _fmtLabel(p.x, activeKey)),
            datasets: [{
                data:            pts.map(p => p.y),
                borderColor:     accentColor,
                borderWidth:     1.5,
                pointRadius:     0,
                pointHoverRadius: 4,
                tension:         0.3,
                fill:            true,
                backgroundColor: `${accentColor}1a`,
            }],
        },
        options: {
            responsive:          true,
            maintainAspectRatio: false,
            animation:           { duration: 200 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${_fmtPlayerCount(ctx.parsed.y)} players`,
                    },
                },
            },
            scales: {
                x: {
                    ticks: {
                        color:    'rgba(255,255,255,0.35)',
                        font:     { size: 10 },
                        maxTicksLimit: 8,
                        maxRotation:   0,
                    },
                    grid: { color: 'rgba(255,255,255,0.06)' },
                },
                y: {
                    ticks: {
                        color:    'rgba(255,255,255,0.35)',
                        font:     { size: 10 },
                        callback: v => _fmtPlayerCount(v),
                    },
                    grid:     { color: 'rgba(255,255,255,0.06)' },
                    beginAtZero: false,
                },
            },
        },
    })

    // Tab switching
    container.querySelectorAll('.pc-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            container.querySelectorAll('.pc-tab').forEach(b => b.classList.remove('pc-tab--active'))
            btn.classList.add('pc-tab--active')
            activeKey = btn.dataset.granularity
            pts       = _buildDataset(activeKey)
            _pcChart.data.labels   = pts.map(p => _fmtLabel(p.x, activeKey))
            _pcChart.data.datasets[0].data = pts.map(p => p.y)
            _pcChart.update()
        })
    })
}

// ── My Review ─────────────────────────────────────────────────────────────────

function _myReview(entry) {
    // entry shape from relay: { fetchedAt, gameName, review: <raw Steam review | null> }
    const r = entry?.review ?? null
    if (!r) return ''

    const recommended = r.voted_up
    const text        = r.review ?? ''
    const hours       = r.author?.playtime_at_review != null
        ? Math.round(r.author.playtime_at_review / 60)
        : null
    const date        = r.timestamp_created
        ? new Date(r.timestamp_created * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
        : entry?.fetchedAt
            ? new Date(entry.fetchedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
            : null
    const helpful     = r.votes_up > 0 ? `${_fmtCount(r.votes_up)} found helpful` : null
    const ea          = r.written_during_early_access ? `<span class="rev-card-badge">Early Access</span>` : ''

    const thumb    = recommended ? _SVG_THUMB_UP : _SVG_THUMB_DOWN
    const thumbCls = recommended ? 'rev-card-thumb--pos' : 'rev-card-thumb--neg'
    const recLabel = recommended ? 'Recommended' : 'Not Recommended'

    return `
        <section class="game-section" id="game-sec-steam-review">
            <h2 class="game-section-title">Steam Review</h2>
            <div class="rev-mine">
                <div class="rev-mine-header">
                    <span class="rev-card-thumb ${thumbCls}">${thumb}</span>
                    <span class="rev-mine-verdict">${recLabel}</span>
                    <div class="rev-mine-meta">
                        ${hours != null ? `<span class="rev-card-hours">${hours.toLocaleString()}h at review</span>` : ''}
                        ${date ? `<span class="rev-card-date">${escapeHtml(date)}</span>` : ''}
                        ${ea}
                    </div>
                    ${helpful ? `<span class="rev-card-helpful rev-mine-helpful">${escapeHtml(helpful)}</span>` : ''}
                    ${text ? `<button class="rev-mine-show-more">Show review</button>` : ''}
                </div>
                ${text ? `<div class="rev-mine-body" hidden><p class="rev-mine-text">${escapeHtml(text)}</p></div>` : ''}
            </div>
        </section>`
}

function _initSteamReview(container) {
    const btn  = container.querySelector('.rev-mine-show-more')
    const body = container.querySelector('.rev-mine-body')
    if (!btn || !body) return
    btn.addEventListener('click', () => {
        const hidden = body.hasAttribute('hidden')
        body.toggleAttribute('hidden', !hidden)
        btn.textContent = hidden ? 'Hide review' : 'Show review'
    })
}

// ── Community Reviews ─────────────────────────────────────────────────────────

const _SVG_THUMB_UP   = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>`
const _SVG_THUMB_DOWN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>`

function _ratioBar(ratio) {
    if (ratio == null) return ''
    const pct = Math.round(ratio)
    const color = pct >= 80 ? 'var(--clr-review-pos)' : pct >= 60 ? 'var(--clr-review-mix)' : 'var(--clr-review-neg)'
    return `
        <div class="rev-ratio-wrap">
            <div class="rev-ratio-bar">
                <div class="rev-ratio-fill" style="width:${pct}%;background:${color}"></div>
            </div>
            <span class="rev-ratio-pct" style="color:${color}">${pct}%</span>
        </div>`
}

function _fmtCount(n) {
    if (n == null) return '0'
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
    return String(n)
}

function _reviewCard(r, isMine = false) {
    const thumb    = r.votedUp ? _SVG_THUMB_UP : _SVG_THUMB_DOWN
    const thumbCls = r.votedUp ? 'rev-card-thumb--pos' : 'rev-card-thumb--neg'
    const date     = new Date(r.postedAt ?? r.fetchedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    const hours    = r.hoursAtReview ?? (r.review ? Math.round(r.review.author?.playtime_at_review / 60) : null)
    const hoursStr = hours != null ? `${hours.toLocaleString()}h at review` : ''
    const helpful  = r.votesUp > 0 ? `${_fmtCount(r.votesUp)} found helpful` : ''
    const text     = r.text ?? r.review?.review ?? ''
    const ea       = r.earlyAccess ? `<span class="rev-card-badge">Early Access</span>` : ''

    return `
        <div class="rev-card${isMine ? ' rev-card--mine' : ''}">
            <div class="rev-card-header">
                <span class="rev-card-thumb ${thumbCls}">${thumb}</span>
                <div class="rev-card-meta">
                    ${isMine ? `<span class="rev-card-mine-label">My Review</span>` : ''}
                    ${hoursStr ? `<span class="rev-card-hours">${escapeHtml(hoursStr)}</span>` : ''}
                    <span class="rev-card-date">${escapeHtml(date)}</span>
                    ${ea}
                </div>
                ${helpful ? `<span class="rev-card-helpful">${escapeHtml(helpful)}</span>` : ''}
            </div>
            <p class="rev-card-text">${escapeHtml(text)}</p>
        </div>`
}

function _communityReviews(data, game) {
    if (_releaseStatus(game) === 'coming_soon') return ''

    if (!data) {
        // null = not yet fetched — async fetch will replace this section
        return `
            <section class="game-section" id="game-sec-community-reviews">
                <h2 class="game-section-title">Community Reviews</h2>
                <p class="game-section-empty">Loading community reviews…</p>
            </section>`
    }

    if (!data.totalReviews) {
        return `
            <section class="game-section" id="game-sec-community-reviews">
                <h2 class="game-section-title">Community Reviews</h2>
                <p class="game-section-empty">No community reviews on Steam yet.</p>
            </section>`
    }

    const s            = data?.summary
    const totalReviews = data?.totalReviews ?? 0
    const reviews      = data?.reviews ?? []

    const summaryHtml = s && totalReviews > 0 ? `
        <div class="rev-summary">
            <div class="rev-summary-score">
                <span class="rev-summary-desc">${escapeHtml(s.scoreDesc ?? '')}</span>
                <span class="rev-summary-counts">
                    ${_fmtCount(s.totalPositive)} positive &middot; ${_fmtCount(s.totalNegative)} negative &middot; ${_fmtCount(totalReviews)} total
                </span>
            </div>
            ${_ratioBar(s.ratio)}
        </div>` : ''

    const topHtml = reviews.length
        ? `<div class="rev-list">${reviews.map(r => _reviewCard(r)).join('')}</div>`
        : `<p class="game-section-empty">No English reviews cached yet.</p>`

    return `
        <section class="game-section" id="game-sec-community-reviews">
            <h2 class="game-section-title">Community Reviews</h2>
            ${summaryHtml}
            ${topHtml}
        </section>`
}

// Fires when community reviews aren't cached yet — syncs then swaps in both
// the hero Steam score chip and the full reviews section without a page reload.
async function _loadCommunityReviews(container, game) {
    try {
        await fetch(`/relay/api/steam/community-reviews/${game.appid}/sync`, { method: 'POST' })

        const res = await fetch(`/relay/api/steam/community-reviews/${game.appid}`)
        if (!res.ok) return
        const data = await res.json()

        // Update Steam score chip in the hero data panel
        const chip = container.querySelector('#gdp-steam-chip')
        if (chip) {
            const ratio = data?.summary?.ratio ?? null
            chip.outerHTML = _scoreChip('Steam', ratio, ratio != null ? Math.round(ratio) + '%' : null, 'gdp-steam-chip')
        }

        // Swap the community reviews section
        const section = container.querySelector('#game-sec-community-reviews')
        if (section) {
            const tmp = document.createElement('div')
            tmp.innerHTML = _communityReviews(data, game)
            const newEl = tmp.firstElementChild
            if (newEl) section.replaceWith(newEl)
        }
    } catch { /* non-critical — page is fully usable without reviews */ }
}

// ── Screenshot modal ──────────────────────────────────────────────────────────

let _modalEl  = null
let _modalSrcs = []
let _modalIdx  = 0

function _modalNav(delta) {
    _modalIdx = (_modalIdx + delta + _modalSrcs.length) % _modalSrcs.length
    _modalEl.querySelector('.shot-modal-img').src = _modalSrcs[_modalIdx]
    _modalEl.querySelector('.shot-modal-prev').disabled = _modalSrcs.length <= 1
    _modalEl.querySelector('.shot-modal-next').disabled = _modalSrcs.length <= 1
}

function _openModal(srcs, idx = 0) {
    if (!_modalEl) {
        _modalEl = document.createElement('div')
        _modalEl.className = 'shot-modal'
        _modalEl.innerHTML = `
            <div class="shot-modal-backdrop"></div>
            <button class="shot-modal-prev shot-modal-nav" aria-label="Previous">&#8249;</button>
            <img class="shot-modal-img" src="" alt="Screenshot">
            <button class="shot-modal-next shot-modal-nav" aria-label="Next">&#8250;</button>
            <button class="shot-modal-close" aria-label="Close">✕</button>`
        document.body.appendChild(_modalEl)
        _modalEl.querySelector('.shot-modal-backdrop').addEventListener('click', _closeModal)
        _modalEl.querySelector('.shot-modal-close').addEventListener('click', _closeModal)
        _modalEl.querySelector('.shot-modal-prev').addEventListener('click', () => _modalNav(-1))
        _modalEl.querySelector('.shot-modal-next').addEventListener('click', () => _modalNav(1))
        document.addEventListener('keydown', e => {
            if (!_modalEl?.classList.contains('shot-modal--open')) return
            if (e.key === 'Escape')     _closeModal()
            if (e.key === 'ArrowLeft')  _modalNav(-1)
            if (e.key === 'ArrowRight') _modalNav(1)
        })
        window.addEventListener('popstate', () => _closeModal())
    }
    _modalSrcs = srcs
    _modalIdx  = idx
    _modalEl.querySelector('.shot-modal-img').src = srcs[idx]
    const hidden = srcs.length <= 1
    _modalEl.querySelector('.shot-modal-prev').style.display = hidden ? 'none' : ''
    _modalEl.querySelector('.shot-modal-next').style.display = hidden ? 'none' : ''
    _modalEl.classList.add('shot-modal--open')
}

function _closeModal() {
    _modalEl?.classList.remove('shot-modal--open')
}

// ── Local wishlist button ─────────────────────────────────────────────────────

const _WL_STAR     = `<svg class="game-flag-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`
const _WL_STAR_FILL = `<svg class="game-flag-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`

// Returns a flags-group element to be injected inside game-flags-inner, or '' if not applicable.
function _wishlistGroup(game, localWishlisted) {
    if (game.source === 'library' || game.source === 'both') return ''

    const isSteam = game.wishlist?.steam === true
    const isLocal = localWishlisted || game.wishlist?.local === true

    if (isSteam) {
        return `<div class="game-flags-group">
            <button class="game-flag game-wishlist-btn game-wishlist-btn--steam" disabled title="On Steam Wishlist">${_WL_STAR_FILL}</button>
        </div>`
    }

    const cls   = isLocal ? ' game-flag--active' : ''
    const title = isLocal ? 'Remove from Local Wishlist' : 'Add to Local Wishlist'
    return `<div class="game-flags-group">
        <button class="game-flag game-wishlist-btn${cls}" data-wishlist-appid="${game.appid}" title="${title}">${_WL_STAR_FILL}</button>
    </div>`
}

function _initWishlistBtn(container, game) {
    const btn = container.querySelector('.game-wishlist-btn[data-wishlist-appid]')
    if (!btn) return

    btn.addEventListener('click', () => {
        const appid   = btn.dataset.wishlistAppid
        const isLocal = btn.classList.contains('game-flag--active')
        const method  = isLocal ? 'DELETE' : 'POST'

        btn.classList.toggle('game-flag--active', !isLocal)
        btn.title = isLocal ? 'Add to Local Wishlist' : 'Remove from Local Wishlist'

        fetch(`/api/local-wishlist/${appid}`, { method }).catch(err => {
            console.warn('[wishlist] request failed, reverting', err)
            btn.classList.toggle('game-flag--active', isLocal)
            btn.title = isLocal ? 'Remove from Local Wishlist' : 'Add to Local Wishlist'
        })
    })
}

// ── Flags bar ─────────────────────────────────────────────────────────────────

const _FLAG_SVG = (paths) =>
    `<svg class="game-flag-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`

const _FLAG_GROUPS = [
    [
        { key: 'software',  label: 'Software / Tool — excluded from play stats',   icon: _FLAG_SVG(`<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>`) },
    ],
    [
        { key: 'childLock', label: 'Child Lock — hidden from all views',            icon: _FLAG_SVG(`<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`) },
        { key: 'filtered',  label: 'Filtered — hidden unless filter is lifted',     icon: _FLAG_SVG(`<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>`) },
        { key: 'alert',     label: 'Sale Alert — notify when on sale',              icon: _FLAG_SVG(`<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>`) },
    ],
    [
        { key: 'favorite',  label: 'Favorite',                                      icon: _FLAG_SVG(`<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>`) },
        { key: 'revisit',   label: 'Revisit — want to replay',                      icon: _FLAG_SVG(`<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>`) },
    ],
    [
        { key: 'completed', label: 'Completed',                                     icon: _FLAG_SVG(`<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>`) },
        { key: 'dropped',   label: 'Dropped — abandoned, won\'t return',            icon: _FLAG_SVG(`<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>`) },
        { key: 'onHold',    label: 'On Hold — paused mid-playthrough',              icon: _FLAG_SVG(`<circle cx="12" cy="12" r="10"/><line x1="10" x2="10" y1="15" y2="9"/><line x1="14" x2="14" y1="15" y2="9"/>`) },
        { key: 'backlog',   label: 'Backlog — owned, unstarted, intend to play',    icon: _FLAG_SVG(`<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>`) },
    ],
]

function _flagsBar(flags, game, localWishlisted = false) {
    const groups = _FLAG_GROUPS.map((group, gi) => {
        const btns = group.map(f => {
            const active = flags?.[f.key] ? ' game-flag--active' : ''
            return `<button class="game-flag game-flag--${f.key}${active}" data-flag="${f.key}" title="${f.label}">${f.icon}</button>`
        }).join('')
        const divider = gi < _FLAG_GROUPS.length - 1 ? `<div class="game-flags-divider"></div>` : ''
        return `<div class="game-flags-group">${btns}</div>${divider}`
    }).join('')
    const wlGroup = _wishlistGroup(game, localWishlisted)
    const wlHtml  = wlGroup ? `<div class="game-flags-divider"></div>${wlGroup}` : ''
    return `<div class="game-flags-inner">${groups}${wlHtml}</div>`
}

function _initFlagsBar(container) {
    const bar   = container.querySelector('.game-flags-bar')
    if (!bar) return
    const appid = bar.dataset.appid

    bar.addEventListener('click', async e => {
        const btn = e.target.closest('.game-flag')
        if (!btn) return
        const flag    = btn.dataset.flag
        const active  = btn.classList.contains('game-flag--active')
        const newVal  = !active

        // Optimistic update
        btn.classList.toggle('game-flag--active', newVal)

        try {
            await fetch(`/api/flags/${appid}`, {
                method:  'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ flag, value: newVal }),
            })
            if (flag === 'alert') refreshAlertsBadge()
        } catch {
            // Revert on failure
            btn.classList.toggle('game-flag--active', active)
        }
    })
}

// ── Local Review Section ──────────────────────────────────────────────────────

const _SLIDER_LABELS = {
    story: 'Story', soundMusic: 'Sound & Music', gameplay: 'Gameplay',
    graphics: 'Graphics', replayability: 'Replayability',
    performance: 'Performance', agendaFree: 'Agenda-Free',
}

function _fmtNoteDate(iso) {
    try {
        return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    } catch {
        return ''
    }
}

function _notesGridHtml(review, appid) {
    const notes = review?.notes ?? []
    if (!notes.length) return ''
    return notes.map(n => `
        <div class="rev-note-card">
            <div class="rev-note-text">${escapeHtml(n.text)}</div>
            <div class="rev-note-date">${_fmtNoteDate(n.createdAt)}</div>
            <button class="rev-note-del" data-note-id="${escapeHtml(n.id)}" aria-label="Delete note">×</button>
        </div>`).join('')
}

function _localReviewSection(review, appid) {
    const cardHtml = review ? renderLocalReviewCard(review, appid) : `
        <button class="rev-no-review" data-appid="${appid}">
            ✦ Write a Review for this game
        </button>`

    const notesGridHtml = _notesGridHtml(review, appid)

    const writeBtn = review ? '' : ''

    return `
        <section class="game-section rev-local-section" id="game-sec-local-review">
            <h2 class="game-section-title">Local Review</h2>
            ${cardHtml}
            <div class="rev-notes-section">
                <div class="rev-notes-grid" id="rev-notes-grid-${appid}">
                    ${notesGridHtml}
                </div>
                <div class="rev-add-note">
                    <input class="rev-add-note-input" placeholder="Quick note…" maxlength="200">
                    <button class="rev-add-note-btn">Add</button>
                </div>
            </div>
            ${review ? '' : '<button class="rev-write-btn" data-appid="' + appid + '">✦ Write a Review</button>'}
        </section>`
}

function _initLocalReviewSection(container, appid, gameName) {
    const section = container.querySelector('.rev-local-section')
    if (!section) return

    async function _refresh() {
        const res = await fetch(`/api/local-reviews/${appid}`)
        const review = res.ok ? await res.json() : null
        const newSection = document.createElement('div')
        newSection.innerHTML = _localReviewSection(review, appid)
        const newEl = newSection.querySelector('.rev-local-section')
        if (newEl) {
            section.replaceWith(newEl)
            _initLocalReviewSection(container, appid, gameName)
        }
    }

    // "Write a Review" / "Edit Review" button
    const writeBtn = section.querySelector('.rev-write-btn, .rev-no-review')
    if (writeBtn) {
        writeBtn.addEventListener('click', async () => {
            const res = await fetch(`/api/local-reviews/${appid}`)
            const existing = res.ok ? await res.json() : null
            const saved = await openReviewModal(appid, gameName, existing)
            if (saved) await _refresh()
        })
    }

    const editBtn = section.querySelector('.rev-edit-btn')
    if (editBtn) {
        editBtn.addEventListener('click', async () => {
            const res = await fetch(`/api/local-reviews/${appid}`)
            const existing = res.ok ? await res.json() : null
            const saved = await openReviewModal(appid, gameName, existing)
            if (saved) await _refresh()
        })
    }

    // Add note
    const addNoteInput = section.querySelector('.rev-add-note-input')
    const addNoteBtn = section.querySelector('.rev-add-note-btn')
    if (addNoteInput && addNoteBtn) {
        async function _doAddNote() {
            const text = addNoteInput.value.trim()
            if (!text) return
            addNoteBtn.disabled = true
            try {
                const res = await fetch(`/api/local-reviews/${appid}/notes`, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ text }),
                })
                if (res.ok) {
                    addNoteInput.value = ''
                    await _refresh()
                }
            } catch { /* silent */ } finally {
                addNoteBtn.disabled = false
            }
        }

        addNoteBtn.addEventListener('click', _doAddNote)
        addNoteInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); _doAddNote() }
        })
    }

    // Delete note buttons
    section.querySelectorAll('.rev-note-del').forEach(btn => {
        btn.addEventListener('click', async () => {
            const noteId = btn.dataset.noteId
            if (!noteId) return
            btn.disabled = true
            try {
                const res = await fetch(`/api/local-reviews/${appid}/notes/${noteId}`, { method: 'DELETE' })
                if (res.ok) await _refresh()
            } catch { /* silent */ } finally {
                btn.disabled = false
            }
        })
    })
}

// ── Discovered game — progressive enrichment ──────────────────────────────────

// Fires after the initial render for discovered games that are missing HLTB / ITAD / PCGW.
// Each service runs independently and swaps its placeholder out when it resolves.
function _loadDiscoveredData(container, game) {
    const appid  = game.appid
    const name   = encodeURIComponent(game.name)
    const status = _releaseStatus(game)

    // Helper — replaces a placeholder element with rendered HTML, or removes it
    function _swap(el, html) {
        if (!html) { el.remove(); return }
        const tmp = document.createElement('div')
        tmp.innerHTML = html
        const newEl = tmp.firstElementChild
        if (newEl) { el.replaceWith(newEl); _navRailEl?._rebuild?.() }
        else el.remove()
    }

    // HLTB — released / early access only (unreleased games have no completion data)
    if (status !== 'coming_soon') {
        ;(async () => {
            const el = container.querySelector('.game-hltb-pending')
            if (!el) return
            const noData = () => _swap(el, `
                <section class="game-section" id="game-sec-hltb">
                    <h2 class="game-section-title">How Long To Beat</h2>
                    <p class="game-section-empty">No data available for this game.</p>
                </section>`)
            try {
                const res = await fetch(`/relay/api/hltb/${appid}?fetch=true&name=${name}`)
                if (!res.ok) { noData(); return }
                const entry = await res.json()
                const hasTimes = entry.matched &&
                    (entry.gameplayMain ?? entry.gameplayMainExtra ?? entry.gameplayCompletionist) != null
                if (!hasTimes) { noData(); return }
                _swap(el, _hltb({ ...game, hltb: entry }))
                // Re-init the session pin timer now that milestones/scale are populated
                _initHltbSessionUpdate(container, appid)
                _initHltbRefresh(container, { ...game, hltb: entry })
            } catch { noData() }
        })()
    } else {
        container.querySelector('.game-hltb-pending')?.remove()
    }

    // ITAD — all discovered games including coming-soon (pre-purchase deals are real)
    ;(async () => {
        const el = container.querySelector('.game-itad-pending')
        if (!el) return
        try {
            const res   = await fetch(`/relay/api/itad/${appid}?fetch=true&name=${name}`)
            // {} (not null) so _itad renders empty state rather than the pending placeholder
            const entry = res.ok ? await res.json() : {}
            _swap(el, _itad(entry, game))
        } catch { _swap(el, _itad({}, game)) }
        _initItadRefresh(container, game)
    })()

    // PCGW — released / early access only (unreleased games rarely have wiki pages)
    if (status !== 'coming_soon') {
        ;(async () => {
            const el = container.querySelector('.game-pcgw-pending')
            if (!el) return
            try {
                const res = await fetch(`/relay/api/pcgw/${appid}?fetch=true&name=${name}`)
                if (!res.ok) { el.remove(); return }
                const entry = await res.json()
                if (!entry.found) { el.remove(); return }
                _swap(el, _pcgw(entry, game))
                _initPcgwRefresh(container, game)
            } catch { el.remove() }
        })()
    } else {
        container.querySelector('.game-pcgw-pending')?.remove()
    }
}

// ── Release status ────────────────────────────────────────────────────────────

// Returns 'released' | 'coming_soon' | 'early_access' | 'unknown'
function _releaseStatus(game) {
    if (!game.store || game.store.unavailable) return 'unknown'

    // Early access is still purchasable — check categories first
    if ((game.store.categories ?? []).includes('Early Access')) return 'early_access'

    const dateStr = (game.store.releaseDate ?? '').trim()
    if (!dateStr) return 'unknown'

    const lower = dateStr.toLowerCase()

    // Explicit not-released strings from Steam
    if (['coming soon', 'to be announced', 'tba', 'tbd'].includes(lower)) return 'coming_soon'

    // Quarter patterns: Q1 2025, Q2 2026, etc.
    if (/^q[1-4]\s*\d{4}$/i.test(dateStr)) return 'coming_soon'

    // Year only: future year = coming soon, past/current = released
    if (/^\d{4}$/.test(dateStr)) {
        return parseInt(dateStr, 10) > new Date().getFullYear() ? 'coming_soon' : 'released'
    }

    // General date parse — Steam format is usually "14 Nov, 2023"
    const parsed = new Date(dateStr)
    if (!isNaN(parsed.getTime())) {
        return parsed > new Date() ? 'coming_soon' : 'released'
    }

    return 'unknown'
}

function _releaseBanner(game) {
    const status = _releaseStatus(game)

    if (status === 'coming_soon') {
        const dateStr = game.store?.releaseDate ?? ''
        const lower   = dateStr.toLowerCase()
        const datePart = (dateStr && !['coming soon', 'tba', 'tbd'].includes(lower))
            ? ` — ${escapeHtml(dateStr)}`
            : ''
        return `
            <div class="game-release-banner game-release-banner--soon">
                <span class="game-release-banner-icon">&#x231B;</span>
                Coming Soon${datePart}
            </div>`
    }

    if (status === 'early_access') {
        const dateStr = game.store?.releaseDate ?? ''
        const datePart = dateStr ? ` — in Early Access since ${escapeHtml(dateStr)}` : ''
        return `
            <div class="game-release-banner game-release-banner--ea">
                <span class="game-release-banner-icon">&#x25CE;</span>
                Early Access${datePart}
            </div>`
    }

    return ''
}

// ── Page nav rail ─────────────────────────────────────────────────────────────

const _NAV_ICONS = {
    home:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    video:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`,
    bookOpen:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 0 3-3h7z"/></svg>`,
    clock:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    barChart:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
    image:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    newspaper: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M16 8H8"/><path d="M16 12H8"/><path d="M10 16H8"/></svg>`,
    star:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    thumbsUp:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>`,
    msgCircle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
    tag:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
    monitor:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
}

const _NAV_ITEMS = [
    { id: 'game-sec-hero',              label: 'Top',               icon: _NAV_ICONS.home      },
    { id: 'game-sec-trailers',          label: 'Trailers',          icon: _NAV_ICONS.video     },
    { id: 'game-sec-about',             label: 'About',             icon: _NAV_ICONS.bookOpen  },
    { id: 'game-sec-hltb',              label: 'How Long To Beat',  icon: _NAV_ICONS.clock     },
    { id: 'game-sec-player-count',      label: 'Player Count',      icon: _NAV_ICONS.barChart  },
    { id: 'game-sec-screenshots',       label: 'Screenshots',       icon: _NAV_ICONS.image     },
    { id: 'game-sec-news',              label: 'News',              icon: _NAV_ICONS.newspaper },
    { id: 'game-sec-local-review',      label: 'Local Review',      icon: _NAV_ICONS.star      },
    { id: 'game-sec-steam-review',      label: 'Steam Review',      icon: _NAV_ICONS.thumbsUp  },
    { id: 'game-sec-community-reviews', label: 'Community Reviews', icon: _NAV_ICONS.msgCircle },
    { id: 'game-sec-prices',            label: 'Prices',            icon: _NAV_ICONS.tag       },
    { id: 'game-sec-pcgw',              label: 'PCGamingWiki',      icon: _NAV_ICONS.monitor   },
]

let _navRailEl = null

// HLTB session-tracking state — cleared each time renderGame() runs
let _gpHltbMilestones  = null  // [{label, h}] stored as side-effect by _hltb()
let _gpHltbMaxScale    = null  // pre-computed coordinate space for consistent pin position
let _gpBasePlaytimeMin = 0     // relay effectiveMin at render time (includes session elapsed to render)
let _gpRenderTime      = 0     // Date.now() when _gpBasePlaytimeMin was captured
let _gpHltbTimer       = null  // 30s tick that moves the pin during an active play session

function _initNavRail(container) {
    const scrollEl = document.getElementById('main-content')
    if (!scrollEl) return

    const rail = document.createElement('nav')
    rail.className = 'game-nav-rail'
    rail.setAttribute('aria-label', 'Page sections')
    document.body.appendChild(rail)
    _navRailEl = rail

    // Align the rail's first icon with the first flag button.
    // .game-flags-inner has padding: 10px 0; the rail has padding: 4px 0 — so +6 corrects
    // for that difference. Once the flags bar scrolls off-screen we floor at 20px.
    function _updatePosition() {
        if (!rail.isConnected) return
        const flagsInner = container.querySelector('.game-flags-inner')
        const hero       = document.getElementById('game-sec-hero')
        if (!flagsInner && !hero) return
        const top = flagsInner
            ? flagsInner.getBoundingClientRect().top + 6
            : hero.getBoundingClientRect().bottom
        rail.style.top = Math.max(top, 20) + 'px'
    }

    function _updateActive() {
        if (!rail.isConnected) return
        const btns = [...rail.querySelectorAll('.gnr-btn')]
        if (!btns.length) return
        // Default to the first visible item (hero / top)
        let activeId = btns[0]?.dataset.target ?? null
        for (const btn of btns) {
            const el = document.getElementById(btn.dataset.target)
            if (!el) continue
            // Section becomes active once its top edge crosses 40% down the viewport
            if (el.getBoundingClientRect().top <= window.innerHeight * 0.4) {
                activeId = btn.dataset.target
            }
        }
        btns.forEach(btn =>
            btn.classList.toggle('gnr-btn--active', btn.dataset.target === activeId)
        )
    }

    function _onScroll() {
        _updatePosition()
        _updateActive()
    }

    function _rebuild() {
        const visible = _NAV_ITEMS.filter(item => document.getElementById(item.id))
        rail.innerHTML = visible.map(item => `
            <button class="gnr-btn" data-target="${item.id}" data-label="${item.label}" title="${item.label}">
                ${item.icon}
            </button>`).join('')
        rail.querySelectorAll('.gnr-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const target = document.getElementById(btn.dataset.target)
                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
            })
        })
        _updatePosition()
        _updateActive()
    }

    // Expose rebuild so async section loads can call it
    rail._rebuild = _rebuild
    _rebuild()

    scrollEl.addEventListener('scroll', _onScroll, { passive: true })

    // Clean up when the SPA navigates away from the game page
    const mo = new MutationObserver(() => {
        if (!document.getElementById('game-sec-hero')) {
            rail.remove()
            _navRailEl = null
            scrollEl.removeEventListener('scroll', _onScroll)
            mo.disconnect()
        }
    })
    mo.observe(container, { childList: true })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _fmtHours(h) {
    if (h == null) return '—'
    if (h >= 100)  return `${Math.round(h)}h`
    if (h >= 10)   return `${(Math.round(h * 2) / 2)}h`  // 0.5h precision
    return `${(Math.round(h * 10) / 10)}h`                // 0.1h precision
}

// ── HLTB live pin update (session-aware) ──────────────────────────────────────

/**
 * Moves the HLTB pin and fill bar to reflect updated playtime.
 * Creates the pin element if it didn't exist at render time (player had 0 playtime).
 * Scoped to #game-sec-hltb so it won't affect unrelated containers.
 */
function _updateGameHltbPin(container, playtimeMinutes) {
    if (!_gpHltbMilestones?.length || _gpHltbMaxScale == null || !(playtimeMinutes > 0)) return

    const playerHours = playtimeMinutes / 60
    const pct         = h => (Math.sqrt(h) / Math.sqrt(_gpHltbMaxScale)) * 100
    const pinPos      = pct(playerHours)

    const section = container.querySelector('#game-sec-hltb')
    if (!section) return

    const fillEl = section.querySelector('[data-role="hltb-fill"]')
    let   pinEl  = section.querySelector('[data-role="hltb-pin"]')

    // Create the pin if it wasn't rendered (player had 0 playtime when page loaded)
    if (!pinEl && fillEl) {
        pinEl = document.createElement('div')
        pinEl.className    = 'hltb-pin'
        pinEl.dataset.role = 'hltb-pin'
        fillEl.closest('.hltb-track-wrap')?.appendChild(pinEl)
    }

    if (pinEl) {
        pinEl.style.left    = `${pinPos.toFixed(2)}%`
        pinEl.dataset.label = `${_fmtHours(playerHours)} played`
    }
    if (fillEl) fillEl.style.width = `${pinPos.toFixed(2)}%`
}

/**
 * Wires the ↻ button inside #game-sec-hltb.  On click: force-syncs HLTB,
 * re-fetches the enriched game object, swaps the section in-place.
 * Re-wires itself on the replacement so the button keeps working.
 */
function _initHltbRefresh(container, game) {
    const btn = container.querySelector('[data-role="hltb-refresh"]')
    if (!btn) return
    btn.addEventListener('click', async () => {
        btn.classList.add('game-refresh-btn--spinning')
        btn.disabled = true
        try {
            await fetch(`/relay/api/hltb/sync/${game.appid}?force=true`, { method: 'POST' })
            const newGame = await fetch(`/relay/api/games/${game.appid}`).then(r => r.ok ? r.json() : null)
            if (!newGame) return
            const section = container.querySelector('#game-sec-hltb')
            if (!section) return
            // _hltb() updates _gpBasePlaytimeMin + _gpRenderTime as a side-effect
            const tmp = document.createElement('div')
            tmp.innerHTML = _hltb(newGame)
            const newSection = tmp.firstElementChild
            if (newSection) {
                section.replaceWith(newSection)
                _navRailEl?._rebuild?.()
                _initHltbRefresh(container, newGame)
                _initHltbSessionUpdate(container, newGame.appid)
            }
        } catch { /* silent — network error or no data */ }
    })
}

/**
 * Wires the ↻ button inside #game-sec-pcgw.  On click: force-syncs PCGW,
 * re-fetches the entry, swaps the section in-place.
 */
function _initPcgwRefresh(container, game) {
    const btn = container.querySelector('[data-role="pcgw-refresh"]')
    if (!btn) return
    btn.addEventListener('click', async () => {
        btn.classList.add('game-refresh-btn--spinning')
        btn.disabled = true
        try {
            await fetch(`/relay/api/pcgw/sync/${game.appid}?force=true`, { method: 'POST' })
            const pcgwData = await fetch(`/relay/api/pcgw/${game.appid}`).then(r => r.ok ? r.json() : null)
            const section  = container.querySelector('#game-sec-pcgw')
            if (!section) return
            const tmp = document.createElement('div')
            tmp.innerHTML = _pcgw(pcgwData, game)
            const newSection = tmp.firstElementChild
            if (newSection) {
                section.replaceWith(newSection)
                _navRailEl?._rebuild?.()
                _initPcgwRefresh(container, game)
            } else {
                section.remove()
                _navRailEl?._rebuild?.()
            }
        } catch { /* silent */ }
    })
}

/**
 * Wires the ↻ button inside #game-sec-prices. On click: force-syncs ITAD,
 * re-renders the section in-place and patches the data-panel price rows.
 * Re-wires itself on the replacement so the button keeps working.
 */
function _initItadRefresh(container, game) {
    const btn = container.querySelector('[data-role="itad-refresh"]')
    if (!btn) return
    btn.addEventListener('click', async () => {
        btn.classList.add('game-refresh-btn--spinning')
        btn.disabled = true
        try {
            await fetch(`/relay/api/itad/sync/${game.appid}?force=true`, { method: 'POST' })
            // Use {} (not null) on 404 — null would re-render the pending placeholder for discovered games
            const itadData = await fetch(`/relay/api/itad/${game.appid}`).then(r => r.ok ? r.json() : {})
            const section  = container.querySelector('#game-sec-prices')
            if (!section) return
            const tmp = document.createElement('div')
            tmp.innerHTML = _itad(itadData, game)
            const newSection = tmp.firstElementChild
            if (newSection) {
                section.replaceWith(newSection)
                _navRailEl?._rebuild?.()
                _initItadRefresh(container, game)
                // Patch the data-panel price block in the hero with fresh data
                const gdpPrices = container.querySelector('[data-role="gdp-prices"]')
                if (gdpPrices) {
                    const tmp2 = document.createElement('div')
                    tmp2.innerHTML = _gdpPricesHtml(itadData, game)
                    gdpPrices.replaceWith(tmp2.firstElementChild)
                }
            }
        } catch { /* silent */ }
    })
}

/**
 * Fetches now-playing once; if this game is active, immediately corrects the HLTB
 * pin position and starts a 30-second interval to keep it moving live.
 * Called after the initial render and again after any dynamic HLTB section swap.
 */
async function _initHltbSessionUpdate(container, appid) {
    // Clear any previous timer (e.g. after a dynamic HLTB section swap)
    if (_gpHltbTimer) { clearInterval(_gpHltbTimer); _gpHltbTimer = null }
    if (!_gpHltbMilestones?.length) return   // no HLTB data — nothing to update

    try {
        const np      = await fetch('/relay/api/steam/now-playing').then(r => r.ok ? r.json() : null)
        const session = np?.playing?.appid === Number(appid) ? np.playing : null
        if (!session) return

        // _gpBasePlaytimeMin is relay effectiveMin captured at render time — it already
        // includes session elapsed up to then.  Use delta from render time so we don't
        // double-count the session minutes already baked into the base.
        const elapsed = () => Math.floor((Date.now() - _gpRenderTime) / 60_000)
        const update  = () => _updateGameHltbPin(container, _gpBasePlaytimeMin + elapsed())

        update()  // correct the pin immediately
        _gpHltbTimer = setInterval(update, 30_000)
    } catch { /* silent — best-effort */ }
}
