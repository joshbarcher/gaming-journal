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

function _deriveStatus(flags, playtime, isWishlist) {
    if (!flags && isWishlist) return 'wishlist'
    if (!flags) return 'unplayed'
    if (flags.completed) return 'completed'
    if (flags.dropped)   return 'dropped'
    if (flags.onHold)    return 'on-hold'
    if (playtime > 0)    return 'playing'
    if (isWishlist)      return 'wishlist'
    return 'unplayed'
}

const _STATUS_LABELS = {
    completed: 'Completed',
    dropped:   'Dropped',
    'on-hold': 'In Progress',
    playing:   'Playing',
    wishlist:  'Wishlisted',
    unplayed:  null,
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function _loadData(franchiseId) {
    // /relay/api/games returns the enriched model with media.screenshots
    const [franchise, flagsRes, gamesRes] = await Promise.all([
        api.franchises.get(franchiseId),
        fetch('/api/flags').then(r => r.json()).catch(() => ({})),
        fetch('/relay/api/games').then(r => r.json()).catch(() => []),
    ])

    if (!franchise) throw new Error('Franchise not found')

    const games = Array.isArray(gamesRes) ? gamesRes : []

    // Enriched model uses playtimeMinutes; split into owned vs wishlist-only
    const ownedMap    = new Map(games.filter(g => g.source !== 'wishlist').map(g => [g.appid, g]))
    const wishlistMap = new Map(games.filter(g => g.source === 'wishlist' || g.source === 'both').map(g => [g.appid, g]))

    return { franchise, flagsRes, ownedMap, wishlistMap }
}

// ── Stats derivation ──────────────────────────────────────────────────────────

function _computeStats(entries, flagsRes, ownedMap, wishlistMap) {
    let completed = 0, dropped = 0, onHold = 0, playing = 0, wishlist = 0, totalMins = 0
    for (const e of entries) {
        const flags    = flagsRes[e.appid]
        const owned    = ownedMap.get(e.appid)
        const wl       = wishlistMap.get(e.appid)
        const playtime = owned?.playtimeMinutes ?? 0
        totalMins += playtime
        const status = _deriveStatus(flags, playtime, !!wl && !owned)
        if (status === 'completed') completed++
        else if (status === 'dropped')  dropped++
        else if (status === 'on-hold')  onHold++
        else if (status === 'playing')  playing++
        else if (status === 'wishlist') wishlist++
    }
    return { completed, dropped, onHold, playing, wishlist, totalMins, total: entries.length }
}

// ── Timeline progress ─────────────────────────────────────────────────────────

const _TIMELINE_FILL = {
    completed: { pct: 100, cls: 'completed' },
    dropped:   { pct: 100, cls: 'dropped'   },
    'on-hold': { pct:  55, cls: 'on-hold'   },
    playing:   { pct:  30, cls: 'playing'   },
    wishlist:  { pct:   0, cls: 'empty'     },
    unplayed:  { pct:   0, cls: 'empty'     },
}

function _renderTimeline(entries, flagsRes, ownedMap, wishlistMap) {
    if (entries.length === 0) return ''

    let completedCount = 0
    const cellsHtml = entries.map(entry => {
        const { appid, name } = entry
        const flags    = flagsRes[appid]
        const owned    = ownedMap.get(appid)
        const wl       = wishlistMap.get(appid)
        const playtime = owned?.playtimeMinutes ?? 0
        const status   = _deriveStatus(flags, playtime, !!wl && !owned)
        const fill     = _TIMELINE_FILL[status] ?? _TIMELINE_FILL.unplayed
        if (status === 'completed') completedCount++

        const statusLabel = _STATUS_LABELS[status] ?? 'Unplayed'
        return `
            <div class="frc-tl-cell frc-tl-cell--${status}" title="${escapeHtml(name)} · ${statusLabel}">
                <img class="frc-tl-img"
                     src="${_capsuleUrl(appid)}"
                     alt=""
                     loading="lazy"
                     onerror="this.style.opacity='0'">
                <div class="frc-tl-track">
                    <div class="frc-tl-fill frc-tl-fill--${fill.cls}" style="width:${fill.pct}%"></div>
                </div>
            </div>`
    }).join('')

    const pct = Math.round(completedCount / entries.length * 100)

    return `
        <div class="frc-timeline">
            <div class="frc-tl-cells">${cellsHtml}</div>
            <div class="frc-tl-footer">
                <span class="frc-tl-pct">${pct}% · ${completedCount}/${entries.length} completed</span>
            </div>
        </div>`
}

// ── Entry row ─────────────────────────────────────────────────────────────────

function _buildEntryRow(entry, idx, flagsRes, ownedMap, wishlistMap, onRemove, navigate) {
    const { appid, name } = entry
    const flags    = flagsRes[appid]
    const owned    = ownedMap.get(appid)
    const wl       = wishlistMap.get(appid)
    const playtime = owned?.playtimeMinutes ?? 0
    const status   = _deriveStatus(flags, playtime, !!wl && !owned)
    const hrs      = _fmtHours(playtime)
    const label    = _STATUS_LABELS[status]

    const row = document.createElement('div')
    row.className = 'frc-entry'
    row.draggable = true
    row.dataset.appid = appid

    row.innerHTML = `
        <span class="frc-entry-handle" title="Drag to reorder">⠿</span>
        <span class="frc-entry-num">${idx + 1}</span>
        <img class="frc-entry-thumb"
             src="${_capsuleUrl(appid)}"
             alt=""
             loading="lazy"
             onerror="this.style.visibility='hidden'">
        <div class="frc-entry-info">
            <span class="frc-entry-name">${escapeHtml(name)}</span>
            <div class="frc-entry-meta">
                ${hrs ? `<span class="frc-entry-hours">${hrs}</span>` : ''}
                ${label ? `<span class="frc-status-badge frc-status-badge--${status}">${label}</span>` : ''}
            </div>
        </div>
        <button class="frc-entry-remove" title="Remove from franchise">×</button>`

    row.querySelector('.frc-entry-name').addEventListener('click', () => navigate(`game/${appid}`))
    row.querySelector('.frc-entry-remove').addEventListener('click', () => onRemove(appid, name))
    return row
}

// ── Drag-and-drop for entries ─────────────────────────────────────────────────

let _dragSrc = null

function _attachEntryDrag(row, list, onReorder) {
    row.addEventListener('dragstart', (e) => {
        _dragSrc = row
        row.classList.add('frc-entry--dragging')
        e.dataTransfer.effectAllowed = 'move'
    })

    row.addEventListener('dragend', () => {
        row.classList.remove('frc-entry--dragging')
        list.querySelectorAll('.frc-entry--drag-over-before, .frc-entry--drag-over-after').forEach(el => {
            el.classList.remove('frc-entry--drag-over-before', 'frc-entry--drag-over-after')
        })
        _dragSrc = null
        onReorder()
    })

    row.addEventListener('dragover', (e) => {
        e.preventDefault()
        if (!_dragSrc || _dragSrc === row) return
        list.querySelectorAll('.frc-entry--drag-over-before, .frc-entry--drag-over-after').forEach(el => {
            el.classList.remove('frc-entry--drag-over-before', 'frc-entry--drag-over-after')
        })
        // Determine above or below midpoint
        const rect = row.getBoundingClientRect()
        const mid  = rect.top + rect.height / 2
        if (e.clientY < mid) {
            row.classList.add('frc-entry--drag-over-before')
        } else {
            row.classList.add('frc-entry--drag-over-after')
        }
        e.dataTransfer.dropEffect = 'move'
    })

    row.addEventListener('dragleave', () => {
        row.classList.remove('frc-entry--drag-over-before', 'frc-entry--drag-over-after')
    })

    row.addEventListener('drop', (e) => {
        e.preventDefault()
        if (!_dragSrc || _dragSrc === row) return
        row.classList.remove('frc-entry--drag-over-before', 'frc-entry--drag-over-after')
        const rect = row.getBoundingClientRect()
        const mid  = rect.top + rect.height / 2
        if (e.clientY < mid) {
            row.before(_dragSrc)
        } else {
            row.after(_dragSrc)
        }
    })
}

// ── Game search ───────────────────────────────────────────────────────────────

function _buildSearchDropdown(query, ownedMap, wishlistMap, existingAppids, onPick) {
    const q = query.toLowerCase()
    const results = []

    for (const [appid, g] of ownedMap) {
        if (existingAppids.has(appid)) continue
        if (g.name.toLowerCase().includes(q)) results.push({ appid, name: g.name, tag: 'owned' })
    }
    for (const [appid, g] of wishlistMap) {
        if (existingAppids.has(appid)) continue
        if (ownedMap.has(appid)) continue // already shown above
        if (g.name.toLowerCase().includes(q)) results.push({ appid, name: g.name, tag: 'wishlist' })
    }

    results.sort((a, b) => {
        const ai = a.name.toLowerCase().indexOf(q)
        const bi = b.name.toLowerCase().indexOf(q)
        if (ai !== bi) return ai - bi
        return a.name.localeCompare(b.name)
    })

    const dropdown = document.createElement('div')
    dropdown.className = 'frc-search-results'

    if (results.length === 0) {
        dropdown.innerHTML = `<div class="frc-search-no-results">No matching games found</div>`
        return dropdown
    }

    for (const r of results.slice(0, 30)) {
        const item = document.createElement('div')
        item.className = 'frc-search-item'
        item.innerHTML = `
            <img src="${_capsuleUrl(r.appid)}" alt="" onerror="this.style.display='none'">
            <span class="frc-search-item-name">${escapeHtml(r.name)}</span>
            <span class="frc-search-item-tag ${r.tag === 'owned' ? 'frc-search-item-tag--owned' : ''}">${r.tag}</span>`
        item.addEventListener('mousedown', (e) => {
            e.preventDefault() // prevent input blur
            onPick(r)
        })
        dropdown.appendChild(item)
    }

    return dropdown
}

// ── Main render ───────────────────────────────────────────────────────────────

export async function renderFranchise(franchiseId, container, navigate) {
    container.innerHTML = `<div class="page-loading">Loading franchise…</div>`

    let franchise, flagsRes, ownedMap, wishlistMap
    try {
        ;({ franchise, flagsRes, ownedMap, wishlistMap } = await _loadData(franchiseId))
    } catch (err) {
        container.innerHTML = `<div class="page-error">Failed to load: ${escapeHtml(err.message)}</div>`
        return
    }

    let entries = [...franchise.entries]

    // ── Outer wrapper ─────────────────────────────────────────────────────────
    container.innerHTML = ''
    const wrap = document.createElement('div')
    wrap.className = 'frc-detail'
    container.appendChild(wrap)

    // ── Hero ──────────────────────────────────────────────────────────────────
    const hero = document.createElement('div')
    hero.className = 'frc-hero'
    hero.innerHTML = `
        <div class="frc-hero-bg frc-hero-bg--a" id="frc-hero-bg-a"></div>
        <div class="frc-hero-bg frc-hero-bg--b" id="frc-hero-bg-b"></div>
        <div class="frc-hero-scrim"></div>
        <div class="frc-hero-content">
            <button class="frc-hero-back" id="frc-back">&#8592; Franchises</button>
            <div class="frc-title-row">
                <input class="frc-title-input" id="frc-title" type="text" value="${escapeHtml(franchise.name)}" placeholder="Franchise name" maxlength="100">
            </div>
            <div class="frc-hero-stats" id="frc-hero-stats"></div>
        </div>`
    wrap.appendChild(hero)

    hero.querySelector('#frc-back').addEventListener('click', () => {
        clearInterval(_bgCycleTimer)
        navigate('franchises')
    })

    // Title rename
    const titleInput = hero.querySelector('#frc-title')
    let _renameTimer = null
    titleInput.addEventListener('input', () => {
        clearTimeout(_renameTimer)
        _renameTimer = setTimeout(async () => {
            const v = titleInput.value.trim()
            if (!v) return
            try {
                await api.franchises.update(franchiseId, { name: v })
            } catch { /* silent */ }
        }, 600)
    })

    // ── Progress ──────────────────────────────────────────────────────────────
    const progressSection = document.createElement('div')
    progressSection.className = 'frc-progress-section'
    progressSection.innerHTML = `<div class="frc-progress-label">Progress</div><div id="frc-progress-bar"></div>`
    wrap.appendChild(progressSection)

    // ── Add game search ───────────────────────────────────────────────────────
    const addSection = document.createElement('div')
    addSection.className = 'frc-add-section'
    addSection.innerHTML = `
        <div class="frc-add-label">Add Game</div>
        <div class="frc-search-wrap">
            <input class="frc-search-input" id="frc-search" type="text" placeholder="Search your library or wishlist…" autocomplete="off">
        </div>`
    wrap.appendChild(addSection)

    // ── Entry list ────────────────────────────────────────────────────────────
    const entriesLabel = document.createElement('div')
    entriesLabel.className = 'frc-entries-label'
    entriesLabel.textContent = 'Entries'
    wrap.appendChild(entriesLabel)

    const entryList = document.createElement('div')
    entryList.className = 'frc-entries'
    wrap.appendChild(entryList)

    // ── Delete franchise ──────────────────────────────────────────────────────
    const deleteBtn = document.createElement('button')
    deleteBtn.className = 'frc-delete-btn'
    deleteBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        Delete Franchise`
    wrap.appendChild(deleteBtn)

    deleteBtn.addEventListener('click', async () => {
        const ok = await confirmDialog(
            `Delete "${franchise.name}"?`,
            'This will permanently remove this franchise and all its entries.',
            'Delete'
        )
        if (!ok) return
        try {
            await api.franchises.delete(franchiseId)
            navigate('franchises')
        } catch (err) {
            showError(`Failed to delete franchise: ${err.message}`)
        }
    })

    // ── State update helpers ──────────────────────────────────────────────────

    function _refreshStats() {
        const stats = _computeStats(entries, flagsRes, ownedMap, wishlistMap)

        // Hero stats
        const heroStats = hero.querySelector('#frc-hero-stats')
        const hrs = _fmtHours(stats.totalMins)
        heroStats.innerHTML = `
            <span class="frc-hero-stat">
                <span class="frc-hero-stat-value">${stats.completed}</span>/${stats.total} completed
            </span>
            ${hrs ? `<span class="frc-hero-stat"><span class="frc-hero-stat-value">${hrs}</span> played</span>` : ''}`

        // Progress timeline
        progressSection.querySelector('#frc-progress-bar').innerHTML = _renderTimeline(entries, flagsRes, ownedMap, wishlistMap)
    }

    // ── Hero background cycler ────────────────────────────────────────────────
    let _bgCycleTimer = null
    let _bgIndex      = 0
    let _bgActive     = 'a'  // which layer is currently visible

    const _bgA = hero.querySelector('#frc-hero-bg-a')
    const _bgB = hero.querySelector('#frc-hero-bg-b')

    function _bgLayer(id) { return id === 'a' ? _bgA : _bgB }

    function _startBgCycle() {
        clearInterval(_bgCycleTimer)

        // Collect all screenshots from every entry, fall back to header capsule
        const urls = []
        for (const e of entries) {
            const shots = ownedMap.get(e.appid)?.media?.screenshots ?? []
            if (shots.length > 0) {
                urls.push(...shots.map(p => `/relay${p}`))
            } else {
                urls.push(_capsuleUrl(e.appid))
            }
        }
        if (urls.length === 0) return

        // Shuffle for variety
        const shuffled = [...urls].sort(() => Math.random() - 0.5)
        _bgIndex  = 0
        _bgActive = 'a'

        _bgA.style.backgroundImage = `url('${shuffled[0]}')`
        _bgA.style.opacity = '1'
        _bgB.style.opacity = '0'

        if (shuffled.length < 2) return

        _bgCycleTimer = setInterval(() => {
            _bgIndex = (_bgIndex + 1) % shuffled.length
            const next     = _bgActive === 'a' ? 'b' : 'a'
            const nextEl   = _bgLayer(next)
            const activeEl = _bgLayer(_bgActive)

            nextEl.style.backgroundImage = `url('${shuffled[_bgIndex]}')`
            nextEl.style.opacity = '1'
            activeEl.style.opacity = '0'
            _bgActive = next
        }, 6000)
    }

    function _refreshHeroBg() {
        _startBgCycle()
    }

    async function _persistOrder() {
        const appids = [...entryList.querySelectorAll('.frc-entry')].map(el => Number(el.dataset.appid))
        // Sync local entries order
        const map = new Map(entries.map(e => [e.appid, e]))
        entries = appids.map(id => map.get(id)).filter(Boolean)
        _refreshStats()
        _refreshHeroBg()
        // Renumber
        entryList.querySelectorAll('.frc-entry-num').forEach((el, i) => { el.textContent = i + 1 })
        try {
            await api.franchises.reorderEntries(franchiseId, appids)
        } catch (err) {
            console.error('Failed to persist entry order', err)
        }
    }

    function _rebuildEntryList() {
        entryList.innerHTML = ''
        entries.forEach((entry, idx) => {
            const row = _buildEntryRow(
                entry, idx, flagsRes, ownedMap, wishlistMap,
                async (appid, name) => {
                    const ok = await confirmDialog(`Remove "${name}"?`, 'Remove this game from the franchise.', 'Remove')
                    if (!ok) return
                    try {
                        const updated = await api.franchises.removeEntry(franchiseId, appid)
                        entries = updated.entries
                        _rebuildEntryList()
                        _refreshStats()
                        _refreshHeroBg()
                    } catch (err) {
                        showError(`Failed to remove: ${err.message}`)
                    }
                },
                navigate
            )
            _attachEntryDrag(row, entryList, _persistOrder)
            entryList.appendChild(row)
        })
    }

    // ── Search logic ──────────────────────────────────────────────────────────
    const searchInput = addSection.querySelector('#frc-search')
    let _searchDropdown = null
    let _searchTimer    = null

    function _closeDropdown() {
        if (_searchDropdown) { _searchDropdown.remove(); _searchDropdown = null }
    }

    function _openDropdown() {
        const q = searchInput.value.trim()
        _closeDropdown()
        if (q.length < 2) return
        const existing = new Set(entries.map(e => e.appid))
        _searchDropdown = _buildSearchDropdown(q, ownedMap, wishlistMap, existing, async (game) => {
            try {
                const updated = await api.franchises.addEntry(franchiseId, { appid: game.appid, name: game.name })
                entries = updated.entries
                _rebuildEntryList()
                _refreshStats()
                _refreshHeroBg()
                // Rebuild dropdown in-place — new entry is now excluded automatically
                _openDropdown()
                searchInput.focus()
            } catch (err) {
                showError(`Failed to add game: ${err.message}`)
            }
        })
        addSection.querySelector('.frc-search-wrap').appendChild(_searchDropdown)
    }

    searchInput.addEventListener('input', () => {
        clearTimeout(_searchTimer)
        _closeDropdown()
        _searchTimer = setTimeout(_openDropdown, 200)
    })

    // Re-open the last search when the user clicks back into the field
    searchInput.addEventListener('focus', () => {
        if (!_searchDropdown && searchInput.value.trim().length >= 2) {
            searchInput.dispatchEvent(new Event('input'))
        }
    })

    searchInput.addEventListener('blur', () => {
        // Delay so a click on a dropdown item fires before the dropdown is removed
        setTimeout(() => {
            if (!searchInput.matches(':focus')) _closeDropdown()
        }, 200)
    })

    searchInput.addEventListener('keydown', e => {
        if (e.key === 'Escape') { _closeDropdown(); searchInput.blur() }
    })

    // ── Initial render ────────────────────────────────────────────────────────
    _rebuildEntryList()
    _refreshStats()
    _refreshHeroBg()
}
