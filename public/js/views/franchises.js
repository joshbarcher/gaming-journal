import { api } from '../api.js'
import { escapeHtml } from '../utils.js'
import { showError, confirmDialog } from '../dialog.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function _capsuleUrl(appid) {
    return `/relay/images/steam/games/${appid}/header.jpg`
}

function _fmtHours(mins) {
    if (!mins) return null
    const h = mins / 60
    if (h < 1)  return `${Math.round(mins)}m`
    if (h < 10) return `${h.toFixed(1)}h`
    return `${Math.round(h)}h`
}

function _deriveStatus(flags, playtime) {
    if (!flags) return 'unplayed'
    if (flags.completed) return 'completed'
    if (flags.dropped)   return 'dropped'
    if (flags.onHold)    return 'on-hold'
    if (playtime > 0)    return 'playing'
    return 'unplayed'
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function _loadData() {
    const [franchises, flagsRes, gamesRes] = await Promise.all([
        api.franchises.list(),
        fetch('/api/flags').then(r => r.json()),
        fetch('/relay/api/steam/games').then(r => r.json()),
    ])

    const games = Array.isArray(gamesRes) ? gamesRes
        : Array.isArray(gamesRes.games)   ? gamesRes.games
        : []

    const ownedMap = new Map(games.map(g => [g.appid, g]))

    return { franchises, flagsRes, ownedMap }
}

// ── Card rendering ────────────────────────────────────────────────────────────

// Pick N indices spread evenly across the array
function _spreadIndices(len, n) {
    if (len === 0) return []
    if (len <= n)  return Array.from({ length: len }, (_, i) => i)
    return Array.from({ length: n }, (_, i) => Math.round(i * (len - 1) / (n - 1)))
}

function _buildMosaic(entries, ownedMap) {
    const wrap = document.createElement('div')
    wrap.className = 'frc-card-mosaic'

    if (entries.length > 0) {
        const count = document.createElement('span')
        count.className = 'frc-card-mosaic-count'
        count.textContent = `${entries.length} game${entries.length !== 1 ? 's' : ''}`
        wrap.appendChild(count)
    }

    // Build 4 slots, each trying spread candidates then falling back linearly
    const SLOTS = 4
    const spreadIdx = _spreadIndices(entries.length, SLOTS)

    // Track which appids are already claimed so we don't duplicate
    const used = new Set(spreadIdx.map(i => entries[i]?.appid))

    // Fallback queue: all appids not in spread candidates, in order
    const fallbackQueue = entries
        .map(e => e.appid)
        .filter(id => !used.has(id))

    for (let slot = 0; slot < SLOTS; slot++) {
        const cell = document.createElement('div')
        cell.className = 'frc-card-mosaic-cell'
        // Insert cells before the count badge so it stays on top
        wrap.insertBefore(cell, wrap.querySelector('.frc-card-mosaic-count'))

        const primaryAppid = entries[spreadIdx[slot]]?.appid
        const candidates   = primaryAppid
            ? [primaryAppid, ...fallbackQueue]
            : [...fallbackQueue]

        let candidateIdx = 0

        function tryNext() {
            while (candidateIdx < candidates.length) {
                const appid = candidates[candidateIdx++]
                const img   = document.createElement('img')
                img.className = 'frc-card-mosaic-img'
                img.alt       = ''
                img.src       = _capsuleUrl(appid)
                img.addEventListener('error', tryNext)
                img.addEventListener('load',  () => {
                    cell.innerHTML = ''
                    cell.appendChild(img)
                })
                return
            }
            // All candidates exhausted — show placeholder
            cell.innerHTML = '<div class="frc-card-mosaic-placeholder"></div>'
        }

        tryNext()
    }

    return wrap
}

function _buildCard(franchise, flagsRes, ownedMap, navigate) {
    const { id, name, entries = [] } = franchise

    let completed = 0, totalHours = 0
    for (const e of entries) {
        const flags   = flagsRes[e.appid]
        const playtime = ownedMap.get(e.appid)?.playtime_forever ?? 0
        if (flags?.completed) completed++
        totalHours += playtime
    }

    const pct = entries.length ? Math.round((completed / entries.length) * 100) : 0
    const hrs = _fmtHours(totalHours)

    const card = document.createElement('div')
    card.className = 'frc-card'
    card.appendChild(_buildMosaic(entries, ownedMap))

    const body = document.createElement('div')
    body.className = 'frc-card-body'
    body.innerHTML = `
        <div class="frc-card-name">${escapeHtml(name)}</div>
        <div class="frc-card-stats">
            <span class="frc-card-stat">
                <span class="frc-card-stat-value">${completed}</span>/<span>${entries.length}</span> completed
            </span>
            ${hrs ? `<span class="frc-card-stat"><span class="frc-card-stat-value">${hrs}</span> played</span>` : ''}
        </div>
        <div class="frc-card-bar-track">
            <div class="frc-card-bar-fill" style="width:${pct}%"></div>
        </div>`
    card.appendChild(body)

    card.addEventListener('click', () => navigate(`franchise/${id}`))
    return card
}

// ── Create franchise dialog ───────────────────────────────────────────────────

async function _promptCreate() {
    return new Promise(resolve => {
        const overlay = document.createElement('div')
        overlay.className = 'dialog-overlay'
        overlay.innerHTML = `
            <div class="dialog-box" style="max-width:380px">
                <h2 class="dialog-title">New Franchise</h2>
                <p class="dialog-body" style="margin-bottom:12px">Enter a name for your new franchise series:</p>
                <input class="dialog-input" id="frc-create-name" type="text" placeholder="e.g. Monster Hunter" autocomplete="off" maxlength="100">
                <div class="dialog-actions">
                    <button class="dialog-btn dialog-btn--cancel" id="frc-cancel">Cancel</button>
                    <button class="dialog-btn dialog-btn--confirm" id="frc-confirm">Create</button>
                </div>
            </div>`

        document.body.appendChild(overlay)
        const input   = overlay.querySelector('#frc-create-name')
        const confirm = overlay.querySelector('#frc-confirm')
        const cancel  = overlay.querySelector('#frc-cancel')

        requestAnimationFrame(() => input.focus())

        const finish = (val) => { overlay.remove(); resolve(val) }

        confirm.addEventListener('click', () => {
            const v = input.value.trim()
            if (v) finish(v)
            else input.focus()
        })
        cancel.addEventListener('click', () => finish(null))
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); const v = input.value.trim(); if (v) finish(v) }
            if (e.key === 'Escape') finish(null)
        })
        overlay.addEventListener('mousedown', e => { if (e.target === overlay) finish(null) })
    })
}

// ── Main render ───────────────────────────────────────────────────────────────

export async function renderFranchises(container, navigate) {
    container.innerHTML = `<div class="page-loading">Loading franchises…</div>`

    let franchises, flagsRes, ownedMap
    try {
        ;({ franchises, flagsRes, ownedMap } = await _loadData())
    } catch (err) {
        container.innerHTML = `<div class="page-error">Failed to load: ${escapeHtml(err.message)}</div>`
        return
    }

    // ── Layout ────────────────────────────────────────────────────────────────
    container.innerHTML = ''

    const header = document.createElement('div')
    header.className = 'frc-list-header'
    header.innerHTML = `
        <div class="frc-list-header-body">
            <p class="frc-list-eyebrow">Collection</p>
            <h1 class="frc-list-title">Franchises</h1>
            <p class="frc-list-subtitle">${franchises.length} franchise${franchises.length !== 1 ? 's' : ''}</p>
        </div>
        <button class="frc-new-btn" id="frc-new-btn">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Franchise
        </button>`
    container.appendChild(header)

    const grid = document.createElement('div')
    grid.className = 'frc-grid'
    container.appendChild(grid)

    const renderGrid = (list) => {
        grid.innerHTML = ''
        if (list.length === 0) {
            grid.innerHTML = `
                <div class="frc-empty">
                    <div class="frc-empty-icon">🎮</div>
                    <p class="frc-empty-text">No franchises yet</p>
                    <p class="frc-empty-sub">Create your first franchise to start tracking a game series.</p>
                </div>`
            return
        }
        for (const f of list) {
            grid.appendChild(_buildCard(f, flagsRes, ownedMap, navigate))
        }
    }

    renderGrid(franchises)

    header.querySelector('#frc-new-btn').addEventListener('click', async () => {
        const name = await _promptCreate()
        if (!name) return
        try {
            const f = await api.franchises.create({ name })
            franchises.push(f)
            renderGrid(franchises)
            navigate(`franchise/${f.id}`)
        } catch (err) {
            showError(`Failed to create franchise: ${err.message}`)
        }
    })
}
