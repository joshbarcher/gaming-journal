import { escapeHtml } from '../utils.js'
import { refreshAlertsBadge } from '../sidebar.js'
import { openReviewModal, renderLocalReviewCard } from '../review-modal.js'
import { gameBackLabel, gameBackPath } from '../router.js'

export async function renderGame(appid, container) {
    container.innerHTML = `<p class="page-loading">Loading…</p>`

    let game, itadData, pcgwData, communityReviews, myReview, playerCounts, flags, localReview, trailers
    try {
        const [gameRes, itadRes, pcgwRes, crRes, mrRes, pcRes, flagsRes, localRevRes, trailersRes] = await Promise.all([
            fetch(`/relay/api/games/${appid}`),
            fetch(`/relay/api/itad/${appid}`),
            fetch(`/relay/api/pcgw/${appid}`),
            fetch(`/relay/api/steam/community-reviews/${appid}`),
            fetch(`/relay/api/steam/reviews/${appid}`),
            fetch(`/relay/api/player-counts/${appid}`),
            fetch(`/api/flags/${appid}`),
            fetch(`/api/local-reviews/${appid}`),
            fetch(`/relay/api/videos/${appid}`),
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
    } catch (err) {
        container.innerHTML = `<p class="page-error">Failed to load: ${escapeHtml(err.message)}</p>`
        return
    }

    container.innerHTML = `
        ${_hero(game)}
        ${game.store?.unavailable ? `<div class="game-unavailable-banner"><span class="game-unavailable-icon">&#9888;</span> This game is no longer available on the Steam store.</div>` : ''}
        <div class="game-flags-bar" data-appid="${appid}">
            ${_flagsBar(flags, game)}
        </div>
        <div class="game-body">
            ${_trailers(appid, trailers)}
            ${_about(game)}
            ${_hltb(game)}
            ${_playerCounts(playerCounts)}
            ${_screenshots(game)}
            ${_localReviewSection(localReview, appid)}
            ${_myReview(myReview)}
            ${_communityReviews(communityReviews)}
            ${_itad(itadData)}
            ${_pcgw(pcgwData)}
        </div>`

    _startHeroSlideshow(container, game)
    _initPlayerChart(playerCounts, container)
    _initFlagsBar(container)
    _initWishlistBtn(container, game)
    _initLocalReviewSection(container, appid, game?.name ?? 'Game')
    _initTrailers(container, appid)

    container.querySelector('.game-shots-grid')?.addEventListener('click', e => {
        const img = e.target.closest('.game-shot-img')
        if (img) {
            const srcs = [...container.querySelectorAll('.game-shot-img')].map(i => i.src)
            _openModal(srcs, srcs.indexOf(img.src))
        }
    })

}

// ── Hero ──────────────────────────────────────────────────────────────────────

function _hero(game) {
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
        <section class="game-hero">
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
                    ${_dataPanel(game)}
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

    function _pan(el, dir) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
            el.style.transition         = `opacity 1.5s ease, background-position ${PAN_DUR}ms linear`
            el.style.backgroundPosition = `center ${dir}`
        }))
    }

    _pan(bgA, randDir())

    let idx = 1, showingA = true

    const timer = setInterval(() => {
        if (!document.contains(bgA)) { clearInterval(timer); return }

        const url      = frames[idx % frames.length]
        const incoming = showingA ? bgB : bgA
        const outgoing = showingA ? bgA : bgB
        idx++

        incoming.style.transition         = 'none'
        incoming.style.backgroundImage    = `url('${url}')`
        incoming.style.backgroundPosition = 'center center'
        incoming.style.opacity            = '0'

        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!document.contains(bgA)) return
            incoming.style.transition         = `opacity 1.5s ease, background-position ${PAN_DUR}ms linear`
            incoming.style.opacity            = '1'
            incoming.style.backgroundPosition = `center ${randDir()}`
            outgoing.style.opacity = '0'
        }))

        showingA = !showingA
    }, INTERVAL)
}

function _dataPanel(game) {
    const rows = []

    // Metacritic
    const mcData = game.store?.metacritic
    const mc     = mcData?.score ?? (typeof mcData === 'number' ? mcData : null)
    if (mc != null) {
        const mcColor = mc >= 75 ? '#4a8c2a' : mc >= 50 ? '#a07010' : '#982020'
        rows.push(`
            <div class="gdp-row gdp-row--score">
                <span class="gdp-metacritic" style="background:${mcColor}">${mc}</span>
                <span class="gdp-score-label">Metacritic</span>
            </div>`)
    }

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

    // ITAD pricing
    const itad = game.itad
    if (itad) {
        rows.push(`<div class="gdp-divider"></div>`)
        if (itad.bestPrice) {
            const bp     = itad.bestPrice
            const cutStr = bp.cut > 0 ? ` <span class="gdp-cut">-${bp.cut}%</span>` : ''
            rows.push(_gdpRow('Best Price', `$${bp.price.toFixed(2)} · ${escapeHtml(bp.store)}${cutStr}`, true))
        } else if (game.store?.isFree) {
            rows.push(_gdpRow('Price', 'Free to Play'))
        } else if (game.store?.price?.final_formatted) {
            rows.push(_gdpRow('Price', escapeHtml(game.store.price.final_formatted) + ' · Steam'))
        }
        if (itad.historicalLow) {
            const hl = itad.historicalLow
            const yr = hl.date ? ` (${hl.date.slice(0, 4)})` : ''
            rows.push(_gdpRow('All-Time Low', `$${hl.price.toFixed(2)} · ${escapeHtml(hl.store)}${yr}`))
        }
    } else {
        rows.push(`<div class="gdp-divider"></div>`)
        if (game.store?.isFree) {
            rows.push(_gdpRow('Price', 'Free to Play'))
        } else if (game.store?.price?.final_formatted) {
            rows.push(_gdpRow('Price', escapeHtml(game.store.price.final_formatted) + ' · Steam'))
        }
    }

    // Release / developer / publisher / platforms
    rows.push(`<div class="gdp-divider"></div>`)
    if (game.store?.releaseDate)
        rows.push(_gdpRow('Released', escapeHtml(game.store.releaseDate)))
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

    return `<div class="game-data-panel">${rows.join('')}</div>`
}

function _gdpRow(label, value, raw = false) {
    return `
        <div class="gdp-row">
            <span class="gdp-label">${escapeHtml(label)}</span>
            <span class="gdp-value">${raw ? value : escapeHtml(value)}</span>
        </div>`
}

// ── HLTB bar ──────────────────────────────────────────────────────────────────

function _hltb(game) {
    const hltb    = game.hltb
    const hasData = hltb?.matched &&
        (hltb.gameplayMain ?? hltb.gameplayMainExtra ?? hltb.gameplayCompletionist) != null

    if (!hasData) {
        return `
            <section class="game-section">
                <h2 class="game-section-title">How Long To Beat</h2>
                <p class="game-section-empty">No data available for this game.</p>
            </section>`
    }

    const playerHours = (game.playtimeMinutes ?? 0) / 60
    const milestones  = [
        { label: 'Main',          h: hltb.gameplayMain          },
        { label: 'Main + Extras', h: hltb.gameplayMainExtra     },
        { label: 'Completionist', h: hltb.gameplayCompletionist },
    ].filter(m => m.h != null && m.h > 0)

    if (!milestones.length) {
        return `
            <section class="game-section">
                <h2 class="game-section-title">How Long To Beat</h2>
                <p class="game-section-empty">No data available for this game.</p>
            </section>`
    }

    // Sqrt scale so a wide range (e.g. 30h main / 200h completionist) doesn't
    // clump everything on the left side of the bar.
    const allVals  = [...milestones.map(m => m.h), playerHours > 0 ? playerHours : null].filter(Boolean)
    const maxScale = Math.max(...allVals) * 1.08
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
        ? `<div class="hltb-pin" style="left:${pinPos.toFixed(2)}%" data-label="${_fmtHours(playerHours)} played"></div>`
        : ''

    return `
        <section class="game-section">
            <h2 class="game-section-title">How Long To Beat</h2>
            <div class="hltb-bar-wrap">
                <div class="hltb-labels-row">${labelsHtml}</div>
                <div class="hltb-track-wrap">
                    <div class="hltb-track">
                        <div class="hltb-fill" style="width:${fillPct.toFixed(2)}%"></div>
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

function _itad(itad) {
    if (!itad?.deals?.length) return ''

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
        <section class="game-section">
            <h2 class="game-section-title">Prices</h2>
            ${historicHtml}
            <div class="itad-cards">${cardsHtml}</div>
        </section>`
}

// ── Trailers ──────────────────────────────────────────────────────────────────

function _trailers(appid, trailers) {
    if (!trailers?.length) return ''

    const thumbsHtml = trailers.length > 1
        ? `<div class="trailers-list">
            ${trailers.map((t, i) => `
                <button class="trailers-thumb${i === 0 ? ' trailers-thumb--active' : ''}" data-index="${t.index}">
                    <div class="trailers-thumb-img-wrap">
                        ${t.thumbnail
                            ? `<img class="trailers-thumb-img" src="${t.thumbnail}" alt="" loading="lazy" onerror="this.style.display='none'">`
                            : ''}
                        <span class="trailers-play-icon">&#9654;</span>
                    </div>
                    <span class="trailers-thumb-name">${escapeHtml(t.name)}</span>
                </button>`).join('')}
           </div>`
        : ''

    return `
        <section class="game-section game-trailers" data-appid="${appid}">
            <h2 class="game-section-title">Trailers</h2>
            <div class="trailers-player-wrap">
                <video class="trailers-player" controls preload="metadata"
                       src="/relay/videos/steam/${appid}/0.mp4"></video>
            </div>
            ${thumbsHtml}
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

            player.src = `/relay/videos/steam/${appid}/${btn.dataset.index}.mp4`
            player.play().catch(() => {})
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
        <section class="game-section">
            <h2 class="game-section-title">Screenshots</h2>
            <div class="game-shots-grid">${imgsHtml}</div>
            <p class="game-section-empty game-shots-fallback">No screenshots available.</p>
        </section>`
}

// ── About This Game ───────────────────────────────────────────────────────────

function _about(game) {
    const html = game.store?.detailedDescription
    if (!html) return ''
    return `
        <section class="game-section game-about">
            <h2 class="game-section-title">About This Game</h2>
            <div class="game-about-body">${html}</div>
        </section>`
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

function _pcgw(pcgwData) {
    if (!pcgwData?.found) return ''

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
        <section class="game-section">
            <h2 class="game-section-title">
                PCGamingWiki${pcgwData.pageUrl
                    ? ` <a class="pcgw-wiki-link" href="${escapeHtml(pcgwData.pageUrl)}" target="_blank" rel="noopener">${_PI.extLink}</a>`
                    : ''}
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

function _playerCounts(data) {
    if (!data?.samples?.length) {
        return `
            <section class="game-section">
                <h2 class="game-section-title">Player Count</h2>
                <p class="game-section-empty">No player count data collected yet.</p>
            </section>`
    }

    const latest = data.samples[data.samples.length - 1]?.[1] ?? 0

    const tabs = _PC_GRANULARITIES.map(g =>
        `<button class="pc-tab${g.key === '7d' ? ' pc-tab--active' : ''}" data-granularity="${g.key}">${g.label}</button>`
    ).join('')

    return `
        <section class="game-section">
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
        <section class="game-section">
            <h2 class="game-section-title">My Review</h2>
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
                </div>
                ${text ? `<p class="rev-mine-text">${escapeHtml(text)}</p>` : ''}
            </div>
        </section>`
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

function _communityReviews(data) {
    const hasData = data && (data.totalReviews > 0 || data.reviews?.length > 0)

    if (!hasData) {
        return `
            <section class="game-section">
                <h2 class="game-section-title">Community Reviews</h2>
                <p class="game-section-empty">No review data cached yet.</p>
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
        <section class="game-section">
            <h2 class="game-section-title">Community Reviews</h2>
            ${summaryHtml}
            ${topHtml}
        </section>`
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
function _wishlistGroup(game) {
    if (game.source === 'library' || game.source === 'both') return ''

    const isSteam = game.wishlist && !game.wishlist.local
    const isLocal = game.wishlist?.local === true

    if (isSteam) {
        return `<div class="game-flags-group">
            <button class="game-flag game-wishlist-btn game-wishlist-btn--steam" disabled title="On Steam Wishlist">${_WL_STAR_FILL}</button>
        </div>`
    }

    const cls   = isLocal ? ' game-flag--active' : ''
    const title = isLocal ? 'Remove from Local Wishlist' : 'Add to Local Wishlist'
    const icon  = isLocal ? _WL_STAR_FILL : _WL_STAR
    return `<div class="game-flags-group">
        <button class="game-flag game-wishlist-btn${cls}" data-wishlist-appid="${game.appid}" title="${title}">${icon}</button>
    </div>`
}

function _initWishlistBtn(container, game) {
    const btn = container.querySelector('.game-wishlist-btn[data-wishlist-appid]')
    if (!btn) return

    btn.addEventListener('click', async () => {
        const appid   = btn.dataset.wishlistAppid
        const isLocal = btn.classList.contains('game-flag--active')
        const method  = isLocal ? 'DELETE' : 'POST'

        btn.classList.toggle('game-flag--active', !isLocal)
        btn.title = isLocal ? 'Add to Local Wishlist' : 'Remove from Local Wishlist'
        btn.innerHTML = isLocal ? _WL_STAR : _WL_STAR_FILL

        try {
            const res = await fetch(`/api/local-wishlist/${appid}`, { method })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
        } catch {
            // Revert
            btn.classList.toggle('game-flag--active', isLocal)
            btn.title = isLocal ? 'Remove from Local Wishlist' : 'Add to Local Wishlist'
            btn.innerHTML = isLocal ? _WL_STAR_FILL : _WL_STAR
        }
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

function _flagsBar(flags, game) {
    const groups = _FLAG_GROUPS.map((group, gi) => {
        const btns = group.map(f => {
            const active = flags?.[f.key] ? ' game-flag--active' : ''
            return `<button class="game-flag game-flag--${f.key}${active}" data-flag="${f.key}" title="${f.label}">${f.icon}</button>`
        }).join('')
        const divider = gi < _FLAG_GROUPS.length - 1 ? `<div class="game-flags-divider"></div>` : ''
        return `<div class="game-flags-group">${btns}</div>${divider}`
    }).join('')
    const wlGroup = _wishlistGroup(game)
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
        <section class="game-section rev-local-section">
            <h2 class="game-section-title">My Journal</h2>
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

    // Show more toggle
    const reviewText = section.querySelector('.rev-review-text')
    const showMoreBtn = section.querySelector('.rev-show-more')
    if (reviewText && showMoreBtn) {
        showMoreBtn.addEventListener('click', () => {
            const expanded = reviewText.classList.toggle('rev-review-text--expanded')
            showMoreBtn.textContent = expanded ? 'Show less' : 'Show more'
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function _fmtHours(h) {
    if (h == null) return '—'
    if (h >= 100)  return `${Math.round(h)}h`
    if (h >= 10)   return `${(Math.round(h * 2) / 2)}h`  // 0.5h precision
    return `${(Math.round(h * 10) / 10)}h`                // 0.1h precision
}
