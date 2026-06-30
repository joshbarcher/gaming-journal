<script lang="ts">
    import { onMount, onDestroy } from 'svelte'
    import { api } from '../../js/api.js'
    import { showError, confirmDialog } from '../../js/dialog.js'
    import { navigate } from '../../js/router.js'
    import type { Franchise, FranchiseEntry, SteamGame, FlagsStore } from '../../types.js'

    let { franchiseId } = $props()

    // ── State ──────────────────────────────────────────────────────────────────

    let franchise   = $state<Franchise | null>(null)
    let flagsRes    = $state<FlagsStore>({})
    let ownedMap    = $state<Map<number, SteamGame>>(new Map())
    let wishlistMap = $state<Map<number, SteamGame>>(new Map())
    let entries     = $state<FranchiseEntry[]>([])
    let loading     = $state(true)
    let error       = $state<string | null>(null)

    let bgAEl       = $state<HTMLDivElement | null>(null)
    let bgBEl       = $state<HTMLDivElement | null>(null)
    let entryListEl = $state<HTMLDivElement | null>(null)

    let searchQuery   = $state('')
    let searchFocused = $state(false)

    let _dragSrc: HTMLElement | null = null
    let _renameTimer: ReturnType<typeof setTimeout> | null = null

    // ── Helpers ────────────────────────────────────────────────────────────────

    const capsuleUrl = (appid: number) => `/relay/images/steam/games/${appid}/header.jpg`

    function fmtHours(mins: number | null | undefined) {
        if (!mins) return null
        const h = mins / 60
        if (h < 1)  return `${Math.round(mins)}m`
        if (h < 10) return `${h.toFixed(1)}h`
        return `${Math.round(h)}h`
    }

    const STATUS_LABELS = {
        completed: 'Completed', dropped: 'Dropped', 'in-progress': 'In Progress',
        playing: 'Playing', wishlist: 'Wishlisted', unplayed: null,
    }

    const TIMELINE_FILL = {
        completed:   { pct: 100, cls: 'completed'   },
        dropped:     { pct: 100, cls: 'dropped'     },
        'in-progress': { pct: 55, cls: 'in-progress' },
        playing:     { pct:  30, cls: 'playing'     },
        wishlist:    { pct:   0, cls: 'empty'       },
        unplayed:    { pct:   0, cls: 'empty'       },
    }

    function deriveStatus(appid: number) {
        const flags   = flagsRes[appid]
        const owned   = ownedMap.get(appid)
        const wl      = wishlistMap.get(appid)
        const playtime = owned?.playtimeMinutes ?? 0
        if (flags?.completed)  return 'completed'
        if (flags?.dropped)    return 'dropped'
        if (flags?.inProgress) return 'in-progress'
        if (playtime > 0)      return 'playing'
        if (wl && !owned)      return 'wishlist'
        return 'unplayed'
    }

    // ── Derived ────────────────────────────────────────────────────────────────

    let stats = $derived.by(() => {
        let completed = 0, dropped = 0, inProgress = 0, playing = 0, wishlist = 0, totalMins = 0
        for (const e of entries) {
            const owned = ownedMap.get(e.appid)
            totalMins += owned?.playtimeMinutes ?? 0
            const s = deriveStatus(e.appid)
            if (s === 'completed')   completed++
            else if (s === 'dropped')    dropped++
            else if (s === 'in-progress') inProgress++
            else if (s === 'playing')    playing++
            else if (s === 'wishlist')   wishlist++
        }
        return { completed, dropped, inProgress, playing, wishlist, totalMins, total: entries.length }
    })

    let heroHours = $derived(fmtHours(stats.totalMins))

    let timelineEntries = $derived(entries.map(e => {
        const status = deriveStatus(e.appid)
        const fill   = TIMELINE_FILL[status] ?? TIMELINE_FILL.unplayed
        return { ...e, status, fill, statusLabel: STATUS_LABELS[status] ?? 'Unplayed' }
    }))

    let completedCount = $derived(timelineEntries.filter(e => e.status === 'completed').length)
    let timelinePct    = $derived(entries.length > 0 ? Math.round(completedCount / entries.length * 100) : 0)

    let searchResults = $derived.by(() => {
        const q = searchQuery.trim().toLowerCase()
        if (q.length < 2) return []
        const existing = new Set(entries.map(e => e.appid))
        const results  = []
        for (const [appid, g] of ownedMap) {
            if (existing.has(appid)) continue
            if (g.name.toLowerCase().includes(q)) results.push({ appid, name: g.name, tag: 'owned' })
        }
        for (const [appid, g] of wishlistMap) {
            if (existing.has(appid) || ownedMap.has(appid)) continue
            if (g.name.toLowerCase().includes(q)) results.push({ appid, name: g.name, tag: 'wishlist' })
        }
        results.sort((a, b) => {
            const ai = a.name.toLowerCase().indexOf(q)
            const bi = b.name.toLowerCase().indexOf(q)
            return ai !== bi ? ai - bi : a.name.localeCompare(b.name)
        })
        return results.slice(0, 30)
    })

    let showDropdown = $derived(searchFocused && searchResults.length > 0)
    let noResults    = $derived(searchFocused && searchQuery.trim().length >= 2 && searchResults.length === 0)

    // ── Background cycler ──────────────────────────────────────────────────────

    $effect(() => {
        const a = bgAEl, b = bgBEl
        if (!a || !b || entries.length === 0) return

        const urls = []
        for (const e of entries) {
            const shots = ownedMap.get(e.appid)?.media?.screenshots ?? []
            if (shots.length > 0) urls.push(...shots.map((p: string) => `/relay${p}`))
            else                   urls.push(capsuleUrl(e.appid))
        }

        const shuffled = [...urls].sort(() => Math.random() - 0.5)
        let idx = 0, active = 'a'

        a.style.backgroundImage = `url('${shuffled[0]}')`
        a.style.opacity = '1'
        b.style.opacity = '0'

        if (shuffled.length < 2) return

        const timer = setInterval(() => {
            idx = (idx + 1) % shuffled.length
            const next     = active === 'a' ? 'b' : 'a'
            const nextEl   = next    === 'a' ? a : b
            const activeEl = active  === 'a' ? a : b
            nextEl.style.backgroundImage = `url('${shuffled[idx]}')`
            nextEl.style.opacity  = '1'
            activeEl.style.opacity = '0'
            active = next
        }, 6000)

        return () => clearInterval(timer)
    })

    // ── Entry drag action ──────────────────────────────────────────────────────

    function entryDrag(node: HTMLElement) {
        node.draggable = true

        function onDragstart(e: DragEvent) {
            _dragSrc = node
            node.classList.add('frc-entry--dragging')
            e.dataTransfer!.effectAllowed = 'move'
        }
        function onDragend() {
            node.classList.remove('frc-entry--dragging')
            entryListEl?.querySelectorAll('.frc-entry--drag-over-before, .frc-entry--drag-over-after').forEach(el =>
                el.classList.remove('frc-entry--drag-over-before', 'frc-entry--drag-over-after')
            )
            _dragSrc = null
            persistOrder()
        }
        function onDragover(e: DragEvent) {
            e.preventDefault()
            if (!_dragSrc || _dragSrc === node) return
            entryListEl?.querySelectorAll('.frc-entry--drag-over-before, .frc-entry--drag-over-after').forEach(el =>
                el.classList.remove('frc-entry--drag-over-before', 'frc-entry--drag-over-after')
            )
            const mid = node.getBoundingClientRect().top + node.getBoundingClientRect().height / 2
            node.classList.toggle('frc-entry--drag-over-before', e.clientY < mid)
            node.classList.toggle('frc-entry--drag-over-after',  e.clientY >= mid)
            e.dataTransfer!.dropEffect = 'move'
        }
        function onDragleave() {
            node.classList.remove('frc-entry--drag-over-before', 'frc-entry--drag-over-after')
        }
        function onDrop(e: DragEvent) {
            e.preventDefault()
            if (!_dragSrc || _dragSrc === node) return
            node.classList.remove('frc-entry--drag-over-before', 'frc-entry--drag-over-after')
            const mid = node.getBoundingClientRect().top + node.getBoundingClientRect().height / 2
            if (e.clientY < mid) node.before(_dragSrc)
            else                  node.after(_dragSrc)
        }

        node.addEventListener('dragstart', onDragstart)
        node.addEventListener('dragend',   onDragend)
        node.addEventListener('dragover',  onDragover)
        node.addEventListener('dragleave', onDragleave)
        node.addEventListener('drop',      onDrop)

        return {
            destroy() {
                node.removeEventListener('dragstart', onDragstart)
                node.removeEventListener('dragend',   onDragend)
                node.removeEventListener('dragover',  onDragover)
                node.removeEventListener('dragleave', onDragleave)
                node.removeEventListener('drop',      onDrop)
            }
        }
    }

    async function persistOrder() {
        if (!entryListEl) return
        const appids = [...entryListEl.querySelectorAll('.frc-entry')].map(el => Number((el as HTMLElement).dataset.appid))
        const map    = new Map(entries.map(e => [e.appid, e]))
        entries = appids.map(id => map.get(id)).filter((e): e is FranchiseEntry => !!e)
        try {
            await api.franchises.reorderEntries(franchiseId, appids)
        } catch (err) {
            console.error('Failed to persist entry order', err)
        }
    }

    // ── Mutations ──────────────────────────────────────────────────────────────

    function onTitleInput(e: Event) {
        clearTimeout(_renameTimer ?? undefined)
        const v = (e.target as HTMLInputElement).value.trim()
        if (!v) return
        _renameTimer = setTimeout(async () => {
            try { await api.franchises.update(franchiseId, { name: v }) } catch { /* silent */ }
        }, 600)
    }

    async function addEntry(game: { appid: number; name: string }) {
        try {
            const updated = await api.franchises.addEntry(franchiseId, { appid: game.appid, name: game.name })
            entries = updated.entries
        } catch (err) {
            showError(`Failed to add game: ${(err as Error).message}`)
        }
    }

    async function removeEntry(appid: number, name: string) {
        const ok = await confirmDialog(`Remove "${name}"?`, 'Remove this game from the franchise.', 'Remove')
        if (!ok) return
        try {
            const updated = await api.franchises.removeEntry(franchiseId, appid)
            entries = updated.entries
        } catch (err) {
            showError(`Failed to remove: ${(err as Error).message}`)
        }
    }

    async function deleteFranchise() {
        const ok = await confirmDialog(
            `Delete "${franchise?.name ?? ''}"?`,
            'This will permanently remove this franchise and all its entries.',
            'Delete'
        )
        if (!ok) return
        try {
            await api.franchises.delete(franchiseId)
            navigate('franchises')
        } catch (err) {
            showError(`Failed to delete franchise: ${(err as Error).message}`)
        }
    }

    // ── Load ───────────────────────────────────────────────────────────────────

    onMount(async () => {
        try {
            const [fr, flagsData, gamesData] = await Promise.all([
                api.franchises.get(franchiseId),
                fetch('/api/flags').then(r => r.json()).catch(() => ({})),
                fetch('/relay/api/games').then(r => r.json()).catch(() => []),
            ])
            if (!fr) throw new Error('Franchise not found')
            franchise   = fr
            flagsRes    = flagsData
            const games = Array.isArray(gamesData) ? gamesData : []
            ownedMap    = new Map(games.filter(g => g.source !== 'wishlist').map(g => [g.appid, g]))
            wishlistMap = new Map(games.filter(g => g.source === 'wishlist' || g.source === 'both').map(g => [g.appid, g]))
            entries     = [...fr.entries]
        } catch (err) {
            error = (err as Error).message
        } finally {
            loading = false
        }
    })

    onDestroy(() => { clearTimeout(_renameTimer ?? undefined) })
</script>

<svelte:head><title>{franchise?.name ?? 'Franchise'}</title></svelte:head>

{#if loading}
    <div class="page-loading">Loading franchise…</div>
{:else if error}
    <div class="page-error">Failed to load: {error}</div>
{:else if franchise}
<div class="frc-detail">

    <!-- Hero -->
    <div class="frc-hero">
        <div class="frc-hero-bg frc-hero-bg--a" bind:this={bgAEl}></div>
        <div class="frc-hero-bg frc-hero-bg--b" bind:this={bgBEl}></div>
        <div class="frc-hero-scrim"></div>
        <div class="frc-hero-content">
            <button class="frc-hero-back" onclick={() => navigate('franchises')}>← Franchises</button>
            <div class="frc-title-row">
                <input
                    class="frc-title-input"
                    type="text"
                    value={franchise.name}
                    placeholder="Franchise name"
                    maxlength="100"
                    oninput={onTitleInput}
                >
            </div>
            <div class="frc-hero-stats">
                <span class="frc-hero-stat">
                    <span class="frc-hero-stat-value">{stats.completed}</span>/{stats.total} completed
                </span>
                {#if heroHours}
                    <span class="frc-hero-stat">
                        <span class="frc-hero-stat-value">{heroHours}</span> played
                    </span>
                {/if}
            </div>
        </div>
    </div>

    <!-- Timeline -->
    <div class="frc-progress-section">
        <div class="frc-progress-label">Progress</div>
        {#if timelineEntries.length > 0}
            <div class="frc-timeline">
                <div class="frc-tl-pairs">
                    {#each timelineEntries as e}
                        <div class="frc-tl-pair frc-tl-cell--{e.status}">
                            <a
                                class="frc-tl-img-wrap"
                                href="/game/{e.appid}"
                                title="{e.name} · {e.statusLabel}"
                            >
                                <div class="frc-tl-img-box">
                                    <img
                                        class="frc-tl-img"
                                        src={capsuleUrl(e.appid)}
                                        alt=""
                                        loading="lazy"
                                        onerror={(ev) => { (ev.currentTarget as HTMLImageElement).style.opacity = '0' }}
                                    >
                                </div>
                            </a>
                            <div class="frc-tl-seg" title="{e.name} · {e.statusLabel}">
                                <div class="frc-tl-fill frc-tl-fill--{e.fill.cls}" style="width:{e.fill.pct}%"></div>
                            </div>
                        </div>
                    {/each}
                </div>
                <div class="frc-tl-footer">
                    <span class="frc-tl-pct">{timelinePct}% · {completedCount}/{entries.length} completed</span>
                </div>
            </div>
        {/if}
    </div>

    <!-- Add game search -->
    <div class="frc-add-section">
        <div class="frc-add-label">Add Game</div>
        <div class="frc-search-wrap">
            <input
                class="frc-search-input"
                type="text"
                placeholder="Search your library or wishlist…"
                autocomplete="off"
                bind:value={searchQuery}
                onfocus={() => searchFocused = true}
                onblur={() => setTimeout(() => { searchFocused = false }, 200)}
                onkeydown={(e) => { if (e.key === 'Escape') { searchQuery = ''; searchFocused = false } }}
            >
            {#if showDropdown}
                <div class="frc-search-results">
                    {#each searchResults as r}
                        <div
                            class="frc-search-item"
                            onmousedown={(e) => { e.preventDefault(); addEntry(r) }}
                        >
                            <img src={capsuleUrl(r.appid)} alt="" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}>
                            <span class="frc-search-item-name">{r.name}</span>
                            <span class="frc-search-item-tag {r.tag === 'owned' ? 'frc-search-item-tag--owned' : ''}">{r.tag}</span>
                        </div>
                    {/each}
                </div>
            {:else if noResults}
                <div class="frc-search-results">
                    <div class="frc-search-no-results">No matching games found</div>
                </div>
            {/if}
        </div>
    </div>

    <!-- Entry list -->
    <div class="frc-entries-label">Entries</div>
    <div class="frc-entries" bind:this={entryListEl}>
        {#each entries as entry, idx (entry.appid)}
            {@const owned    = ownedMap.get(entry.appid)}
            {@const wl       = wishlistMap.get(entry.appid)}
            {@const playtime = owned?.playtimeMinutes ?? 0}
            {@const status   = deriveStatus(entry.appid)}
            {@const hrs      = fmtHours(playtime)}
            {@const label    = STATUS_LABELS[status]}
            <div
                class="frc-entry"
                data-appid={entry.appid}
                use:entryDrag
            >
                <span class="frc-entry-handle" title="Drag to reorder">⠿</span>
                <span class="frc-entry-num">{idx + 1}</span>
                <img
                    class="frc-entry-thumb"
                    src={capsuleUrl(entry.appid)}
                    alt=""
                    loading="lazy"
                    onerror={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
                >
                <div class="frc-entry-info">
                    <span class="frc-entry-name" onclick={() => navigate(`game/${entry.appid}`)}>{entry.name}</span>
                    <div class="frc-entry-meta">
                        {#if hrs}<span class="frc-entry-hours">{hrs}</span>{/if}
                        {#if label}<span class="frc-status-badge frc-status-badge--{status}">{label}</span>{/if}
                    </div>
                </div>
                <button class="frc-entry-remove" title="Remove from franchise" onclick={() => removeEntry(entry.appid, entry.name)}>×</button>
            </div>
        {/each}
    </div>

    <!-- Delete -->
    <div class="frc-delete-wrap">
    <button class="frc-delete-btn" onclick={deleteFranchise}>
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6"/><path d="M14 11v6"/>
            <path d="M9 6V4h6v2"/>
        </svg>
        Delete Franchise
    </button>
    </div>

</div>
{/if}
