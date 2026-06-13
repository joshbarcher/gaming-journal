// Pure HTML-rendering functions. No DOM manipulation, no event listeners.
import { escapeHtml } from '../utils.js'
import type {
    SteamGame,
    ItadData,
    NewsItem,
    NewsData,
    ProtonData,
    PcgwData,
    SteamReviewAuthor,
    SteamUserReview,
    SteamUserReviewEntry,
    CommunityReviewSummary,
    CommunityReviewItem,
    CommunityReviews,
    Trailer,
} from '../../types.js'

export type { ItadData, ProtonData, PcgwData }

// GameData is a minimal alias used by the render functions — SteamGame is a superset
export type GameData = SteamGame

// ── Release status ────────────────────────────────────────────────────────────

export function releaseStatus(game: GameData): string {
    if (!game.store || game.store.unavailable) return 'unknown'
    if ((game.store.categories ?? []).includes('Early Access')) return 'early_access'
    const dateStr = (game.store.releaseDate ?? '').trim()
    if (!dateStr) return 'unknown'
    const lower = dateStr.toLowerCase()
    if (['coming soon', 'to be announced', 'tba', 'tbd'].includes(lower)) return 'coming_soon'
    if (/^q[1-4]\s*\d{4}$/i.test(dateStr)) return 'coming_soon'
    if (/^\d{4}$/.test(dateStr)) return parseInt(dateStr, 10) > new Date().getFullYear() ? 'coming_soon' : 'released'
    const parsed = new Date(dateStr)
    if (!isNaN(parsed.getTime())) return parsed > new Date() ? 'coming_soon' : 'released'
    return 'unknown'
}

export function releaseBanner(game: GameData): string {
    const status = releaseStatus(game)
    if (status === 'coming_soon') {
        const dateStr  = game.store?.releaseDate ?? ''
        const lower    = dateStr.toLowerCase()
        const datePart = (dateStr && !['coming soon', 'tba', 'tbd'].includes(lower))
            ? ` — ${escapeHtml(dateStr)}` : ''
        return `<div class="game-release-banner game-release-banner--soon"><span class="game-release-banner-icon">&#x231B;</span>Coming Soon${datePart}</div>`
    }
    if (status === 'early_access') {
        const dateStr  = game.store?.releaseDate ?? ''
        const datePart = dateStr ? ` — in Early Access since ${escapeHtml(dateStr)}` : ''
        return `<div class="game-release-banner game-release-banner--ea"><span class="game-release-banner-icon">&#x25CE;</span>Early Access${datePart}</div>`
    }
    return ''
}

// ── Formatters ────────────────────────────────────────────────────────────────

export function fmtHours(h: number | null | undefined): string {
    if (h == null) return '—'
    if (h >= 100)  return `${Math.round(h)}h`
    if (h >= 10)   return `${(Math.round(h * 2) / 2)}h`
    return `${(Math.round(h * 10) / 10)}h`
}

export function fmtCount(n: number | null | undefined): string {
    if (n == null) return '0'
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
    return String(n)
}

export function fmtPlayerCount(n: number | null | undefined): string {
    if (!n) return '—'
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
    if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
    return n.toLocaleString()
}

export function scoreColor(n: number | null | undefined): { clr: string; bg: string } | null {
    if (n == null) return null
    if (n >= 75) return { clr: '#4caf50', bg: 'rgba(76,175,80,0.13)' }
    if (n >= 50) return { clr: '#c9a84c', bg: 'rgba(201,168,76,0.13)' }
    return             { clr: '#e05050', bg: 'rgba(224,80,80,0.13)' }
}

export function scoreChip(source: string, score: number | null | undefined, display: string, id = ''): string {
    const idAttr = id ? ` id="${id}"` : ''
    if (score == null) {
        return `<div class="gdp-score-chip gdp-score-chip--missing"${idAttr}><span class="gdp-score-chip-source">${source}</span><span class="gdp-score-chip-value">—</span></div>`
    }
    const c = scoreColor(score)!
    return `<div class="gdp-score-chip"${idAttr} style="--chip-clr:${c.clr};--chip-bg:${c.bg}"><span class="gdp-score-chip-source">${source}</span><span class="gdp-score-chip-value">${display}</span></div>`
}

function _gdpRow(label: string, value: string, raw = false): string {
    return `<div class="gdp-row"><span class="gdp-label">${escapeHtml(label)}</span><span class="gdp-value">${raw ? value : escapeHtml(value)}</span></div>`
}

// ── About ─────────────────────────────────────────────────────────────────────

export function renderAbout(game: GameData): string {
    const html = game.store?.detailedDescription
    if (html) {
        return `<section class="game-section game-about" id="game-sec-about"><h2 class="game-section-title">About This Game</h2><div class="game-about-body">${html}</div></section>`
    }
    return ''
}

// ── Trailers ──────────────────────────────────────────────────────────────────

export function renderTrailers(appid: number, trailers: Trailer[] | null | undefined): string {
    if (!trailers?.length) return ''

    const firstThumb = trailers[0]?.thumbnail ?? ''
    const playerHtml = `<div class="trailers-player-wrap"><video class="trailers-player" controls preload="metadata" src="/relay/videos/steam/${appid}/0.mp4"${firstThumb ? ` poster="${firstThumb}"` : ''}></video></div>`

    if (trailers.length === 1) {
        return `<section class="game-section game-trailers" id="game-sec-trailers" data-appid="${appid}"><h2 class="game-section-title">Trailers</h2><div class="trailers-single">${playerHtml}</div></section>`
    }

    const listHtml = `<div class="trailers-list">${trailers.map((t, i) => `<button class="trailers-thumb${i === 0 ? ' trailers-thumb--active' : ''}" data-index="${t.index}" data-thumbnail="${t.thumbnail ?? ''}"><div class="trailers-thumb-img-wrap">${t.thumbnail ? `<img class="trailers-thumb-img" src="${t.thumbnail}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}<span class="trailers-play-icon">&#9654;</span></div><span class="trailers-thumb-name">${escapeHtml(t.name)}</span></button>`).join('')}</div>`

    return `<section class="game-section game-trailers" id="game-sec-trailers" data-appid="${appid}"><h2 class="game-section-title">Trailers</h2><div class="trailers-layout">${playerHtml}${listHtml}</div></section>`
}

export function initTrailers(container: Element): void {
    const section = container.querySelector('.game-trailers') as HTMLElement | null
    if (!section) return
    const appid  = section.dataset.appid
    const player = section.querySelector('.trailers-player') as HTMLVideoElement | null
    if (!player) return
    const thumbs = section.querySelectorAll<HTMLButtonElement>('.trailers-thumb')
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

// ── Screenshots ───────────────────────────────────────────────────────────────

export function renderScreenshots(game: GameData): string {
    const apiShots = (game.media?.screenshots ?? []).filter(Boolean)
    const urls = apiShots.length > 0
        ? apiShots
        : Array.from({ length: 25 }, (_, i) => `/relay/images/steam/screenshots/${game.appid}/${i}.jpg`)
    const imgsHtml = urls.map(url =>
        `<div class="game-shot-item"><img class="game-shot-img" src="${url}" alt="Screenshot" onerror="this.closest('.game-shot-item').remove()"></div>`
    ).join('')
    return `<section class="game-section" id="game-sec-screenshots"><h2 class="game-section-title">Screenshots</h2><div class="game-shots-grid">${imgsHtml}</div><p class="game-section-empty game-shots-fallback">No screenshots available.</p></section>`
}

// ── My Review (Steam) ─────────────────────────────────────────────────────────

const SVG_THUMB_UP   = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>`
const SVG_THUMB_DOWN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>`

export function renderMyReview(entry: SteamUserReviewEntry | null | undefined): string {
    const r = entry?.review ?? null
    if (!r) return ''

    const recommended = r.voted_up
    const text        = r.review ?? ''
    const hours       = r.author?.playtime_at_review != null ? Math.round(r.author.playtime_at_review / 60) : null
    const date        = r.timestamp_created
        ? new Date(r.timestamp_created * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
        : entry?.fetchedAt ? new Date(entry.fetchedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : null
    const helpful     = (r.votes_up ?? 0) > 0 ? `${fmtCount(r.votes_up)} found helpful` : null
    const ea          = r.written_during_early_access ? `<span class="rev-card-badge">Early Access</span>` : ''
    const thumb    = recommended ? SVG_THUMB_UP : SVG_THUMB_DOWN
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

export function initSteamReview(container: Element): void {
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

function _ratioBar(ratio: number | null | undefined): string {
    if (ratio == null) return ''
    const pct   = Math.round(ratio)
    const color = pct >= 80 ? 'var(--clr-review-pos)' : pct >= 60 ? 'var(--clr-review-mix)' : 'var(--clr-review-neg)'
    return `<div class="rev-ratio-wrap"><div class="rev-ratio-bar"><div class="rev-ratio-fill" style="width:${pct}%;background:${color}"></div></div><span class="rev-ratio-pct" style="color:${color}">${pct}%</span></div>`
}

function _reviewCard(r: CommunityReviewItem): string {
    const thumb    = r.votedUp ? SVG_THUMB_UP : SVG_THUMB_DOWN
    const thumbCls = r.votedUp ? 'rev-card-thumb--pos' : 'rev-card-thumb--neg'
    const date     = new Date(r.postedAt ?? r.fetchedAt ?? Date.now()).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    const hours    = r.hoursAtReview ?? (r.review ? Math.round((r.review.author?.playtime_at_review ?? 0) / 60) : null)
    const hoursStr = hours != null ? `${hours.toLocaleString()}h at review` : ''
    const helpful  = (r.votesUp ?? 0) > 0 ? `${fmtCount(r.votesUp)} found helpful` : ''
    const text     = r.text ?? ''
    const ea       = r.earlyAccess ? `<span class="rev-card-badge">Early Access</span>` : ''

    return `
        <div class="rev-card">
            <div class="rev-card-header">
                <span class="rev-card-thumb ${thumbCls}">${thumb}</span>
                <div class="rev-card-meta">
                    ${hoursStr ? `<span class="rev-card-hours">${escapeHtml(hoursStr)}</span>` : ''}
                    <span class="rev-card-date">${escapeHtml(date)}</span>
                    ${ea}
                </div>
                ${helpful ? `<span class="rev-card-helpful">${escapeHtml(helpful)}</span>` : ''}
            </div>
            <p class="rev-card-text">${escapeHtml(text)}</p>
        </div>`
}

export function renderCommunityReviews(data: CommunityReviews | null, game: GameData): string {
    if (releaseStatus(game) === 'coming_soon') return ''

    const section = (body: string) => `<section class="game-section" id="game-sec-community-reviews"><h2 class="game-section-title">Community Reviews</h2>${body}</section>`

    if (!data?.totalReviews) {
        return section(`<p class="game-section-empty">${data === null ? 'Loading community reviews…' : 'No community reviews on Steam yet.'}</p>`)
    }

    const s = data?.summary
    const summaryHtml = s && (data.totalReviews ?? 0) > 0 ? `
        <div class="rev-summary">
            <div class="rev-summary-score">
                <span class="rev-summary-desc">${escapeHtml(s.scoreDesc ?? '')}</span>
                <span class="rev-summary-counts">${fmtCount(s.totalPositive)} positive &middot; ${fmtCount(s.totalNegative)} negative &middot; ${fmtCount(data.totalReviews)} total</span>
            </div>
            ${_ratioBar(s.ratio)}
        </div>` : ''

    const topHtml = data.reviews?.length
        ? `<div class="rev-list">${data.reviews.map(r => _reviewCard(r)).join('')}</div>`
        : `<p class="game-section-empty">No English reviews cached yet.</p>`

    return section(summaryHtml + topHtml)
}

// ── ITAD Prices ───────────────────────────────────────────────────────────────

const SVG_CLOCK = `<svg class="itad-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`

const HIDDEN_STORES = new Set(['gamesplanet uk', 'gamesplanet fr', 'gamesplanet de'])
const STORE_ICONS: Record<string, string> = {
    'humble store':   'humblestore',
    'gamesplanet us': 'gamesplanet',
    'steam':          'steam',
    'greenmangaming': 'greenmangaming',
    'fanatical':      'fanatical',
    'gamebillet':     'gamebillet.webp',
}

function _storeIconHtml(storeName: string): string {
    const file = STORE_ICONS[storeName.toLowerCase()]
    if (!file) return ''
    const src = file.includes('.') ? file : `${file}.svg`
    return `<img class="itad-store-icon" data-store="${file}" src="/images/stores/${src}" alt="">`
}

export function renderItad(itad: ItadData | null | undefined, game: GameData): string {
    const refreshBtn = `<button class="game-refresh-btn" data-role="itad-refresh" title="Refresh price data">↻</button>`
    if (!itad?.deals?.length) {
        return `<section class="game-section" id="game-sec-prices"><h2 class="game-section-title">Prices${refreshBtn}</h2><p class="game-section-empty">No price data available for this game.</p></section>`
    }
    const deals = itad.deals.filter(d => !HIDDEN_STORES.has(d.store.toLowerCase()))
    const hl = itad.historicalLow
    const historicHtml = hl ? `<div class="itad-historic">${SVG_CLOCK}<span class="itad-historic-label">All-time low</span><span class="itad-historic-price">$${hl.price.toFixed(2)}</span><span class="itad-historic-cut">-${hl.cut}%</span><span class="itad-historic-meta">${escapeHtml(hl.store)}${hl.date ? ` · ${hl.date.slice(0, 4)}` : ''}</span></div>` : ''
    const cardsHtml = deals.map((d, i) => {
        const cutClass = d.cut >= 50 ? 'itad-cut--high' : 'itad-cut--mid'
        const cutHtml  = d.cut > 0 ? `<span class="itad-cut ${cutClass}">-${d.cut}%</span>` : ''
        const wasHtml  = d.cut > 0 ? `<span class="itad-was">$${d.regular.toFixed(2)}</span>` : ''
        const priceStr = d.price === 0 ? 'Free' : `$${d.price.toFixed(2)}`
        return `<a class="itad-card${i === 0 ? ' itad-card--best' : ''}" href="${escapeHtml(d.url)}" target="_blank" rel="noopener noreferrer"><div class="itad-card-logo">${_storeIconHtml(d.store)}</div><span class="itad-card-name">${escapeHtml(d.store)}</span><span class="itad-card-price">${priceStr}</span>${cutHtml || wasHtml ? `<div class="itad-card-meta">${cutHtml}${wasHtml}</div>` : ''}</a>`
    }).join('')
    return `<section class="game-section" id="game-sec-prices"><h2 class="game-section-title">Prices${refreshBtn}</h2>${historicHtml}<div class="itad-cards">${cardsHtml}</div></section>`
}

export function renderGdpPrices(itad: ItadData | null | undefined, game: GameData): string {
    const inner: string[] = []
    inner.push(`<div class="gdp-divider"></div>`)
    if (itad?.bestPrice) {
        const bp = itad.bestPrice
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
    return inner.join('')
}

// ── News ──────────────────────────────────────────────────────────────────────

const BB_RE = /\[(?:b|i|u|s|h[1-6]|url|img|list|quote|code|spoiler|strike)[=\]]/i

export function newsBBCodeDirty(news: NewsData | null | undefined): boolean {
    return news?.items?.some(item => BB_RE.test(item.contents ?? '')) ?? false
}

export function renderNews(news: NewsData | null | undefined): string {
    const items = news?.items
    if (!items?.length) return ''

    const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const listHtml = items.map((item, i) => {
        const date = item.date ? fmt.format(new Date(item.date * 1000)) : ''
        return `<button class="news-item${i === 0 ? ' news-item--active' : ''}" data-index="${i}"><span class="news-item-feed">${escapeHtml(item.feedlabel)}</span><span class="news-item-title">${escapeHtml(item.title)}</span><span class="news-item-date">${date}</span></button>`
    }).join('')

    const first = items[0]
    const firstDate = first.date ? fmt.format(new Date(first.date * 1000)) : ''
    const panelHtml = `<div class="news-panel"><div class="news-panel-meta"><span class="news-panel-feed">${escapeHtml(first.feedlabel)}</span><span class="news-panel-date">${firstDate}</span>${first.url ? `<a class="news-panel-link" href="${first.url}" target="_blank" rel="noopener noreferrer">Read full article ↗</a>` : ''}</div><h3 class="news-panel-title">${escapeHtml(first.title)}</h3><div class="news-panel-body">${first.contents ?? ''}</div></div>`
    const newsJson = JSON.stringify(items).replace(/"/g, '&quot;')

    return `<section class="game-section game-news" id="game-sec-news" data-news="${newsJson}"><h2 class="game-section-title">News</h2><div class="news-layout"><div class="news-list">${listHtml}</div>${panelHtml}</div></section>`
}

export function initNews(container: Element): void {
    const section = container.querySelector('.game-news') as HTMLElement | null
    if (!section) return
    const items = section.querySelectorAll<HTMLButtonElement>('.news-item')
    const panel = section.querySelector('.news-panel')
    if (!items.length || !panel) return
    const raw: NewsItem[] = JSON.parse(section.dataset.news ?? '[]')
    const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    items.forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('news-item--active')) return
            items.forEach(b => b.classList.remove('news-item--active'))
            btn.classList.add('news-item--active')
            const item = raw[Number(btn.dataset.index)]
            if (!item) return
            const date = item.date ? fmt.format(new Date(item.date * 1000)) : ''
            const link = item.url ? `<a class="news-panel-link" href="${item.url}" target="_blank" rel="noopener noreferrer">Read full article ↗</a>` : ''
            panel.querySelector('.news-panel-meta')!.innerHTML = `<span class="news-panel-feed">${escapeHtml(item.feedlabel)}</span><span class="news-panel-date">${date}</span>${link}`
            panel.querySelector('.news-panel-title')!.textContent = item.title
            panel.querySelector('.news-panel-body')!.innerHTML = item.contents ?? ''
        })
    })
}

// ── ProtonDB ──────────────────────────────────────────────────────────────────

const SVG_AWARD       = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"/><circle cx="12" cy="8" r="6"/></svg>`
const SVG_SHIELD_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>`
const SVG_PERCENT      = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>`
const SVG_USERS        = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`
const SVG_EXT          = `<svg class="pcgw-icon pcgw-icon--xs" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`

function _protonCap(s: string | null | undefined): string | null { return s ? s.charAt(0).toUpperCase() + s.slice(1) : null }
function _protonLogPct(n: number): string { return (Math.log(Math.max(1, Math.min(n, 5000))) / Math.log(5000) * 100).toFixed(1) }

export function renderProtonBadge(protonData: ProtonData | null | undefined, appid: number): string {
    if (!protonData?.tier) return ''
    const tier = protonData.tier
    return `<a class="proton-badge proton-badge--${tier}" href="https://www.protondb.com/app/${appid}" target="_blank" rel="noopener noreferrer" title="ProtonDB — ${_protonCap(tier)}"><span class="proton-badge-tier">${_protonCap(tier)}</span><span class="proton-badge-icon">${SVG_AWARD}</span><span class="proton-badge-sub">Linux / Proton</span></a>`
}

export function renderProtondb(protonData: ProtonData | null | undefined, game: GameData): string {
    if (!protonData?.tier) return ''
    const tier     = protonData.tier
    const total    = protonData.total ?? 0
    const scoreStr = protonData.score != null ? Math.round(protonData.score * 100) + '%' : '—'
    const refreshBtn = `<button class="game-refresh-btn" data-role="protondb-refresh" title="Refresh ProtonDB data">↻</button>`
    const markerPct  = _protonLogPct(total)
    const LOG_TICKS  = [
        { label: '1',   pct: _protonLogPct(1) },
        { label: '10',  pct: _protonLogPct(10) },
        { label: '100', pct: _protonLogPct(100) },
        { label: '1K',  pct: _protonLogPct(1000) },
        { label: '5K+', pct: '100.0' },
    ]
    const ticksHtml = LOG_TICKS.map(t => `<span class="protondb-tick" style="left:${t.pct}%">${t.label}</span>`).join('')

    return `
        <section class="game-section" id="game-sec-protondb">
            <h2 class="game-section-title">Linux Compatibility<a class="pcgw-wiki-link" href="https://www.protondb.com/app/${game.appid}" target="_blank" rel="noopener">${SVG_EXT}</a>${refreshBtn}</h2>
            <div class="protondb-row protondb-row--${tier}">
                <div class="protondb-col protondb-col--badge proton-badge--${tier}">
                    <span class="protondb-col-icon protondb-badge-icon">${SVG_AWARD}</span>
                    <span class="protondb-badge-name">${_protonCap(tier)}</span>
                </div>
                <div class="protondb-col protondb-col--stat">
                    <span class="protondb-col-icon">${SVG_SHIELD_CHECK}</span>
                    <span class="protondb-col-text"><span class="protondb-col-value">${_protonCap(protonData.confidence ?? '—')}</span><span class="protondb-col-label">Confidence</span></span>
                </div>
                <div class="protondb-col protondb-col--stat">
                    <span class="protondb-col-icon">${SVG_PERCENT}</span>
                    <span class="protondb-col-text"><span class="protondb-col-value">${scoreStr}</span><span class="protondb-col-label">Score</span></span>
                </div>
                <div class="protondb-col protondb-col--stat">
                    <span class="protondb-col-icon">${SVG_USERS}</span>
                    <span class="protondb-col-text"><span class="protondb-col-value">${total.toLocaleString()}</span><span class="protondb-col-label">Reports</span></span>
                </div>
                <div class="protondb-col protondb-col--bar">
                    <span class="protondb-bar-label">Community Reports</span>
                    <div class="protondb-bar-area">
                        <div class="protondb-bar-track"><div class="protondb-bar-fill" style="width:${markerPct}%"></div><div class="protondb-bar-marker" style="left:${markerPct}%"><span class="protondb-bar-count">${total.toLocaleString()}</span></div></div>
                        <div class="protondb-ticks-row">${ticksHtml}</div>
                    </div>
                </div>
            </div>
        </section>`
}

// ── PCGamingWiki ──────────────────────────────────────────────────────────────

const PI: Record<string, string> = {
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

function _pcgwBadge(val: string | undefined): string | null {
    if (val === 'true')     return `<span class="pcgw-badge pcgw-badge--yes">Yes</span>`
    if (val === 'false')    return `<span class="pcgw-badge pcgw-badge--no">No</span>`
    if (val === 'hackable') return `<span class="pcgw-badge pcgw-badge--hack">Hackable</span>`
    return null
}

function _pcgwRows(obj: Record<string, string> | undefined, defs: [string, string][]): string {
    return defs.filter(([key]) => obj?.[key] != null).map(([key, label]) => {
        const badge = _pcgwBadge(obj![key])
        return badge ? `<div class="pcgw-row"><span class="pcgw-row-label">${label}</span>${badge}</div>` : ''
    }).join('')
}

function _pathCard(title: string, icon: string, pathObj: Record<string, string> | undefined): string {
    const entries = Object.entries(pathObj ?? {})
    if (!entries.length) return ''
    const rows = entries.map(([os, path]) => `<div class="pcgw-path-row"><span class="pcgw-path-os">${escapeHtml(os)}</span><code class="pcgw-path-code">${escapeHtml(path)}</code></div>`).join('')
    return `<div class="pcgw-path-card"><div class="pcgw-card-title">${icon}${title}</div>${rows}</div>`
}

export function renderPcgw(pcgwData: PcgwData | null | undefined, game: GameData): string {
    if (!pcgwData?.found) return ''
    const v = pcgwData.video ?? {}, inp = pcgwData.input ?? {}, cl = pcgwData.cloud ?? {}
    const av = pcgwData.availability ?? {}, paths = pcgwData.paths ?? {}, fixes = pcgwData.fixes ?? []
    const refreshBtn = `<button class="game-refresh-btn" data-role="pcgw-refresh" title="Refresh PCGamingWiki data">↻</button>`

    const videoFeatures = [
        { key: 'widescreen', icon: PI.monitor,  label: 'Widescreen' },
        { key: 'ultrawide',  icon: PI.monitor,  label: 'Ultrawide' },
        { key: 'uhd4k',      icon: PI.maximize, label: '4K UHD' },
        { key: 'hdr',        icon: PI.sun,      label: 'HDR' },
        { key: 'fps60',      icon: PI.zap,      label: '60 FPS' },
        { key: 'fps120',     icon: PI.activity, label: '120+ FPS' },
        { key: 'vsync',      icon: PI.refresh,  label: 'VSync' },
        { key: 'aa',         icon: PI.sparkles, label: 'Anti-Aliasing' },
        { key: 'af',         icon: PI.layers,   label: 'Aniso. Filtering' },
        { key: 'fov',        icon: PI.aim,      label: 'FOV Control' },
        { key: 'rayTracing', icon: PI.aperture, label: 'Ray Tracing' },
        { key: 'frameGen',   icon: PI.film,     label: 'Frame Generation' },
        { key: 'upscaling',  icon: PI.arrowUp,  label: 'Upscaling' },
        { key: 'colorBlind', icon: PI.eye,      label: 'Color Blind Mode' },
    ].filter(f => v[f.key] != null)
    const videoHtml = videoFeatures.map(f => { const b = _pcgwBadge(v[f.key]); return b ? `<div class="pcgw-feature-tile">${f.icon}<span class="pcgw-tile-label">${f.label}</span>${b}</div>` : '' }).join('')

    const mouseRows = _pcgwRows(inp.mouse, [['sensitivity','Sensitivity'],['acceleration','Raw input / no accel'],['inMenus','Works in menus'],['yInversion','Y-axis inversion'],['kbmPrompts','KB/M prompts']])
    const kbRows    = _pcgwRows(inp.keyboard, [['remapping','Key remapping'],['steamInput','Steam Input']])
    const ctrlRows  = _pcgwRows(inp.controller, [['support','Controller support'],['fullSupport','Full controller'],['remapping','Button remapping'],['sensitivity','Sensitivity'],['yInversion','Y-axis inversion'],['hotplugging','Hot-plugging'],['simultaneousInput','Simultaneous input'],['hapticFeedback','Haptic feedback'],['promptOverride','Prompt override'],['xinput','XInput'],['dinput','DirectInput'],['playstation','PlayStation'],['nintendo','Nintendo']]) + _pcgwRows(inp.platform, [['xboxPrompts','Xbox prompts'],['impulseTriggers','Impulse triggers'],['playstationPrompts','PlayStation prompts'],['lightBar','Light bar'],['adaptiveTriggers','Adaptive triggers'],['dualSenseHaptics','DualSense haptics'],['motionSensors','Motion sensors'],['steamDeckPrompts','Steam Deck prompts'],['touchscreen','Touchscreen']])
    const inputCards = [
        { title: 'Mouse',      icon: PI.mouse,    rows: mouseRows, multiCol: false },
        { title: 'Keyboard',   icon: PI.keyboard, rows: kbRows,    multiCol: false },
        { title: 'Controller', icon: PI.gamepad,  rows: ctrlRows,  multiCol: true  },
    ].filter(c => c.rows).map(c => `<div class="pcgw-input-card${c.multiCol ? ' pcgw-input-card--fit' : ''}"><div class="pcgw-card-title">${c.icon}${c.title}</div>${c.multiCol ? `<div class="pcgw-rows-multicol">${c.rows}</div>` : c.rows}</div>`).join('')

    const drmChips  = (av.drm ?? []).map(d => `<span class="pcgw-chip">${escapeHtml(d)}</span>`).join('')
    const cloudRows = _pcgwRows(cl, [['steam','Steam'],['gogGalaxy','GOG Galaxy'],['epicGames','Epic Games'],['eaApp','EA App'],['xbox','Xbox'],['ubisoftConnect','Ubisoft Connect'],['xboxCloud','Xbox Cloud'],['oneDrive','OneDrive']])
    const fixesHtml = fixes.map(f => `<details class="pcgw-fix"><summary>${PI.wrench}${escapeHtml(f.title)}</summary><div class="pcgw-fix-body">${f.html}</div></details>`).join('')

    return `
        <section class="game-section" id="game-sec-pcgw">
            <h2 class="game-section-title">PCGamingWiki${pcgwData.pageUrl ? ` <a class="pcgw-wiki-link" href="${escapeHtml(pcgwData.pageUrl)}" target="_blank" rel="noopener">${PI.extLink}</a>` : ''}${refreshBtn}</h2>
            ${videoHtml ? `<div class="pcgw-block"><h3 class="pcgw-block-title">${PI.monitor}Video &amp; Display</h3><div class="pcgw-feature-grid">${videoHtml}</div></div>` : ''}
            ${inputCards ? `<div class="pcgw-block"><h3 class="pcgw-block-title">${PI.gamepad}Input</h3><div class="pcgw-input-grid">${inputCards}</div></div>` : ''}
            ${drmChips || cloudRows ? `<div class="pcgw-block"><h3 class="pcgw-block-title">${PI.shield}Availability &amp; Cloud Saves</h3><div class="pcgw-avail-grid">${drmChips ? `<div class="pcgw-input-card"><div class="pcgw-card-title">${PI.shield}DRM</div><div class="pcgw-chip-row">${drmChips}</div></div>` : ''}${cloudRows ? `<div class="pcgw-input-card"><div class="pcgw-card-title">${PI.cloud}Cloud Saves</div>${cloudRows}</div>` : ''}</div></div>` : ''}
            <div class="pcgw-block pcgw-block--files" id="Game_data"><h3 class="pcgw-block-title">${PI.save}Save &amp; Config Locations</h3><div class="pcgw-paths-grid">${_pathCard('Save Game', PI.save, paths.saveGame)}${_pathCard('Config File', PI.folder, paths.config)}</div></div>
            ${fixesHtml ? `<div class="pcgw-block"><h3 class="pcgw-block-title">${PI.wrench}Fixes &amp; Tweaks</h3><div class="pcgw-fixes">${fixesHtml}</div></div>` : ''}
        </section>`
}
