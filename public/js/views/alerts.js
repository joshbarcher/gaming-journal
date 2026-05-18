import { escapeHtml } from '../utils.js'

export async function renderAlerts(container) {
    container.innerHTML = `<p class="page-loading">Loading alerts…</p>`

    let data
    try {
        const res = await fetch('/api/alerts')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        data = await res.json()
    } catch (err) {
        container.innerHTML = `<p class="page-error">Failed to load alerts: ${escapeHtml(err.message)}</p>`
        return
    }

    const { onSale = [], watching = [] } = data

    if (onSale.length === 0 && watching.length === 0) {
        container.innerHTML = `
            <div class="page-header">
                <h1 class="page-title">Sale Alerts</h1>
            </div>
            <p class="page-empty alerts-empty">
                No games flagged for sale alerts yet. Open any game page and toggle the
                <strong>Bell</strong> flag to start watching it.
            </p>`
        return
    }

    container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">Sale Alerts</h1>
            ${onSale.length > 0
                ? `<p class="page-subtitle">${onSale.length} game${onSale.length !== 1 ? 's' : ''} on sale now</p>`
                : `<p class="page-subtitle">No watched games are on sale right now</p>`}
        </div>

        ${onSale.length > 0 ? `
        <div class="alerts-section">
            <h2 class="alerts-section-title">On Sale Now</h2>
            <div class="alerts-onsale-grid">
                ${onSale.map(_saleCard).join('')}
            </div>
        </div>` : ''}

        ${watching.length > 0 ? `
        <div class="alerts-section">
            ${onSale.length > 0 ? `<h2 class="alerts-section-title alerts-section-title--muted">Watching</h2>` : ''}
            <div class="alerts-watching-list">
                ${watching.map(_watchRow).join('')}
            </div>
        </div>` : ''}`
}

function _saleCard(game) {
    const cut   = game.bestPrice?.cut   ?? 0
    const price = game.bestPrice?.price ?? null
    const store = game.bestPrice?.store ?? ''
    const url   = game.bestPrice?.url   ?? `/game/${game.appid}`
    const hl    = game.historicalLow

    const hlHtml = hl
        ? `<span class="alerts-card-hl">All-time low: $${hl.price.toFixed(2)} · ${escapeHtml(hl.store)}${hl.date ? ` (${hl.date.slice(0, 4)})` : ''}</span>`
        : ''

    return `
        <a class="alerts-card" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
            <div class="alerts-card-img-wrap">
                <img class="alerts-card-img"
                     src="/relay/images/steam/games/${game.appid}/header.jpg"
                     alt=""
                     onerror="this.style.opacity='0'">
                <span class="alerts-card-cut">-${cut}%</span>
            </div>
            <div class="alerts-card-body">
                <span class="alerts-card-name">${escapeHtml(game.name)}</span>
                <div class="alerts-card-pricing">
                    ${price != null ? `<span class="alerts-card-price">$${price.toFixed(2)}</span>` : ''}
                    ${store ? `<span class="alerts-card-store">${escapeHtml(store)}</span>` : ''}
                </div>
                ${hlHtml}
            </div>
        </a>`
}

function _watchRow(game) {
    const price = game.bestPrice?.price ?? null
    const store = game.bestPrice?.store ?? ''
    const url   = game.bestPrice?.url   ?? `/game/${game.appid}`

    return `
        <a class="alerts-watch-row" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
            <img class="alerts-watch-img"
                 src="/relay/images/steam/games/${game.appid}/header.jpg"
                 alt=""
                 onerror="this.style.opacity='0'">
            <span class="alerts-watch-name">${escapeHtml(game.name)}</span>
            <span class="alerts-watch-price">
                ${price != null ? `$${price.toFixed(2)}` : '—'}
                ${store ? `<span class="alerts-watch-store">· ${escapeHtml(store)}</span>` : ''}
            </span>
        </a>`
}
