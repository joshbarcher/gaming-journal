<script lang="ts">
    import { onMount, onDestroy } from 'svelte'
    import type { NexusMod, NexusModsPage, NexusDeep } from '../../types.js'
    import Breadcrumb from '../Breadcrumb.svelte'
    import { getScrollInstance } from '$lib/actions/scrollbar.js'
    import { fmtCompact, fmtSize, nexusThumb, nexusImgError } from '../../js/nexusFormat.js'

    let { appid } = $props()

    const SORTS = [
        { key: 'endorsements', label: 'Most Endorsed' },
        { key: 'downloads',    label: 'Most Downloaded' },
        { key: 'updated',      label: 'Recently Updated' },
        { key: 'added',        label: 'Newest' },
        { key: 'name',         label: 'Name (A–Z)' },
        { key: 'size',         label: 'Largest' },
    ]
    const LIMIT = 24

    const SVG_EXT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`
    const SVG_ENDORSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"/><circle cx="12" cy="8" r="6"/></svg>`
    const SVG_DL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`

    // ── Shared state ─────────────────────────────────────────────────────────────
    let gameName   = $state('')
    let sort       = $state('endorsements')
    let query      = $state('')     // raw input
    let activeQ    = $state('')     // debounced/applied
    let deep       = $state(false)
    let notOnNexus = $state(false)

    // ── Live (normal) mode ────────────────────────────────────────────────────────
    let mods       = $state<NexusMod[]>([])
    let totalCount = $state(0)
    let offset     = $state(0)
    let loading    = $state(false)
    let done       = $state(false)
    let error      = $state(false)

    // ── Deep mode ──────────────────────────────────────────────────────────────────
    let deepMods    = $state<NexusMod[]>([])
    let deepStatus  = $state<'idle' | 'running' | 'done' | 'error'>('idle')
    let deepPulled  = $state(0)
    let deepTotal   = $state(0)
    let deepCapped  = $state(false)
    let category    = $state('')
    let tag         = $state('')
    // 3-state adult filter: 'hide' = no 18+, 'all' = 18+ and regular, 'only' = 18+ only.
    let adultMode   = $state<'hide' | 'all' | 'only'>('all')
    let visibleCount = $state(LIMIT)
    let pollTimer: ReturnType<typeof setInterval> | null = null

    let sentinel: HTMLElement | null = null
    let io: IntersectionObserver | undefined
    let debounceT: ReturnType<typeof setTimeout> | null = null

    // ── Deep: client-side filter + sort over the full pulled set ────────────────────
    function sortMods(arr: NexusMod[], key: string): NexusMod[] {
        const c = [...arr]
        switch (key) {
            case 'downloads': return c.sort((a, b) => b.downloads - a.downloads)
            case 'updated':   return c.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
            case 'added':     return c.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
            case 'name':      return c.sort((a, b) => a.name.localeCompare(b.name))
            case 'size':      return c.sort((a, b) => (b.fileSize ?? 0) - (a.fileSize ?? 0))
            default:          return c.sort((a, b) => b.endorsements - a.endorsements)
        }
    }
    let categories = $derived([...new Set(deepMods.map(m => m.category).filter(Boolean))].sort() as string[])
    // Tags across the pulled set, most-common first (so "Costumes", "Scripts"… surface at the top).
    let tagOptions = $derived.by(() => {
        const counts = new Map<string, number>()
        for (const m of deepMods) for (const t of (m.tags ?? [])) counts.set(t, (counts.get(t) ?? 0) + 1)
        return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    })
    let deepFiltered = $derived.by(() => {
        let arr = deepMods
        const q = activeQ.toLowerCase()
        if (q)         arr = arr.filter(m => m.name.toLowerCase().includes(q))
        if (category)  arr = arr.filter(m => m.category === category)
        if (tag)       arr = arr.filter(m => m.tags?.includes(tag))
        if (adultMode === 'hide')      arr = arr.filter(m => !m.adult)
        else if (adultMode === 'only') arr = arr.filter(m => m.adult)
        return sortMods(arr, sort)
    })
    let deepVisible = $derived(deepFiltered.slice(0, visibleCount))

    // What the grid renders + the header count.
    let shown       = $derived(deep ? deepVisible : mods)
    let headerCount = $derived(deep ? deepFiltered.length : totalCount)

    // ── Data loading ─────────────────────────────────────────────────────────────
    async function loadMeta() {
        try {
            const r = await fetch(`/relay/api/nexus/${appid}`)
            if (r.ok) { const e = await r.json(); gameName = e.steamName ?? e.nexusName ?? 'Game'; notOnNexus = e.domainName == null }
        } catch { /* breadcrumb falls back to "Game" */ }
    }

    async function loadPage(reset = false) {
        if (deep || loading) return
        if (reset) { offset = 0; mods = []; done = false; error = false }
        else if (done) return
        loading = true
        try {
            const url = `/relay/api/nexus/${appid}/mods?sort=${sort}&offset=${offset}&limit=${LIMIT}&q=${encodeURIComponent(activeQ)}`
            const r = await fetch(url)
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            const pageData: NexusModsPage = await r.json()
            notOnNexus = pageData.domainName == null
            totalCount = pageData.totalCount
            mods       = reset ? pageData.mods : [...mods, ...pageData.mods]
            offset     = mods.length
            if (pageData.mods.length < LIMIT || mods.length >= totalCount) done = true
        } catch { error = true; done = true }
        finally { loading = false }
    }

    // ── Deep pull: start + poll ────────────────────────────────────────────────────
    async function pollDeep() {
        try {
            const r = await fetch(`/relay/api/nexus/${appid}/deep`)
            if (!r.ok) return
            const d: NexusDeep = await r.json()
            deepMods   = d.mods ?? []
            deepPulled = d.pulled ?? deepMods.length
            deepTotal  = d.total ?? 0
            deepCapped = d.capped ?? false
            // 'idle' just means the crawl hasn't flushed its first page yet — stay "running".
            if (d.status && d.status !== 'idle') deepStatus = d.status
            if (d.status === 'done' || d.status === 'error') stopPolling()
        } catch { /* keep last snapshot */ }
    }
    function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null } }
    async function startDeep() {
        deepStatus = 'running'
        try { await fetch(`/relay/api/nexus/${appid}/deep`, { method: 'POST' }) } catch { /* poll will report */ }
        await pollDeep()
        if (!pollTimer) pollTimer = setInterval(pollDeep, 1500)   // poll until done/error stops it
    }

    function toggleDeep() {
        deep = !deep
        visibleCount = LIMIT
        if (deep) { if (deepStatus === 'idle') startDeep(); else pollDeep() }
        else stopPolling()
    }

    // Controls: reset the visible window (deep) or reload from the server (live).
    function afterControlChange() {
        visibleCount = LIMIT
        if (!deep) loadPage(true)
    }
    function onSortChange(e: Event)   { sort = (e.currentTarget as HTMLSelectElement).value; afterControlChange() }
    function onCategoryChange(e: Event){ category = (e.currentTarget as HTMLSelectElement).value; visibleCount = LIMIT }
    function onTagChange(e: Event)    { tag = (e.currentTarget as HTMLSelectElement).value; visibleCount = LIMIT }
    function setAdult(mode: 'hide' | 'all' | 'only') { adultMode = mode; visibleCount = LIMIT }
    function onSearchInput(e: Event) {
        query = (e.currentTarget as HTMLInputElement).value
        if (debounceT) clearTimeout(debounceT)
        debounceT = setTimeout(() => { activeQ = query.trim(); afterControlChange() }, deep ? 120 : 350)
    }

    onMount(() => {
        loadMeta()
        loadPage(true)
        const scrollEl = (getScrollInstance()?.elements().viewport as HTMLElement) ?? document.getElementById('main-content')
        io = new IntersectionObserver(entries => {
            if (!entries[0].isIntersecting) return
            if (deep) { if (visibleCount < deepFiltered.length) visibleCount += LIMIT }
            else loadPage(false)
        }, { root: scrollEl ?? null, rootMargin: '700px' })
        if (sentinel) io.observe(sentinel)
    })
    onDestroy(() => { io?.disconnect(); stopPolling(); if (debounceT) clearTimeout(debounceT) })

    function bindSentinel(el: HTMLElement) { sentinel = el; io?.observe(el) }
    function modUrl(m: NexusMod) { return `/game/${appid}/mods/${m.modId}` }
</script>

<svelte:head><title>Mods — {gameName}</title></svelte:head>

<div class="nxmp-page">
    <Breadcrumb crumbs={[
        { label: 'Home', href: '/' },
        { label: gameName || 'Game', href: `/game/${appid}` },
        { label: 'Mods' },
    ]} />

    <header class="nxmp-head">
        <h1 class="nxmp-title">Mods{#if headerCount} <span class="nxmp-count">{headerCount.toLocaleString()}</span>{/if}</h1>
        <div class="nxmp-controls">
            <div class="nxmp-search">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="search" placeholder={deep ? 'Search all pulled mods…' : 'Search mods…'} value={query} oninput={onSearchInput} aria-label="Search mods" />
            </div>
            <select class="nxmp-sort" value={sort} onchange={onSortChange} aria-label="Sort mods">
                {#each SORTS as s}<option value={s.key}>{s.label}</option>{/each}
            </select>
            {#if deep && categories.length}
                <select class="nxmp-sort" value={category} onchange={onCategoryChange} aria-label="Filter by category">
                    <option value="">All categories</option>
                    {#each categories as c}<option value={c}>{c}</option>{/each}
                </select>
            {/if}
            {#if deep && tagOptions.length}
                <select class="nxmp-sort" value={tag} onchange={onTagChange} aria-label="Filter by tag">
                    <option value="">All tags</option>
                    {#each tagOptions as [t, n]}<option value={t}>{t} ({n})</option>{/each}
                </select>
            {/if}
            {#if deep}
                <div class="nxmp-seg" role="group" aria-label="Adult content filter">
                    <button type="button" class:nxmp-seg--on={adultMode === 'hide'} onclick={() => setAdult('hide')} title="Hide adult mods">No 18+</button>
                    <button type="button" class:nxmp-seg--on={adultMode === 'all'} onclick={() => setAdult('all')} title="Show adult and regular mods">All</button>
                    <button type="button" class:nxmp-seg--on={adultMode === 'only'} onclick={() => setAdult('only')} title="Only adult mods">Only 18+</button>
                </div>
            {/if}
            <button class="nxmp-deep-btn" class:nxmp-deep-btn--on={deep} onclick={toggleDeep} title="Pull the full catalogue for rich local search">
                {deep ? '● Deep search' : 'Deep search'}
            </button>
        </div>
    </header>

    {#if deep}
        <div class="nxmp-deepbar" class:nxmp-deepbar--capped={deepCapped}>
            {#if deepStatus === 'running'}
                <span class="nxmp-deep-spin"></span>
                Deep search — pulled <strong>{deepPulled.toLocaleString()}</strong>{#if deepTotal} of {deepTotal.toLocaleString()}{/if}…
            {:else if deepCapped}
                ⚠ Reached the {(deepMods.length).toLocaleString()}-mod deep limit — this game has {deepTotal.toLocaleString()} mods. Sorted by endorsements; refine with search & filters.
            {:else if deepStatus === 'done'}
                ✓ Pulled all <strong>{deepMods.length.toLocaleString()}</strong> mods — search & filter the full set below.
            {:else if deepStatus === 'error'}
                Couldn’t complete the deep pull. Showing {deepMods.length.toLocaleString()} pulled so far.
            {/if}
        </div>
    {/if}

    {#if notOnNexus}
        <p class="nxmp-empty">This game isn’t on Nexus Mods.</p>
    {:else if !deep && error && mods.length === 0}
        <p class="nxmp-empty">Couldn’t load mods. Try again later.</p>
    {:else if shown.length === 0 && activeQ}
        <p class="nxmp-empty">No mods match “{activeQ}”.</p>
    {/if}

    <div class="nxm-grid nxm-grid--page">
        {#each shown as mod (mod.modId)}
            <div class="nxm-card-wrap">
                <a class="nxm-card" href={modUrl(mod)}>
                    <div class="nxm-thumb" class:nxm-thumb--adult={mod.adult}>
                        {#if nexusThumb(mod)}
                            <img src={nexusThumb(mod)} alt="" loading="lazy" onerror={(e) => nexusImgError(e, mod.thumbUrl ?? mod.imageUrl)}>
                        {/if}
                        {#if mod.adult}<span class="nxm-adult">18+</span>{/if}
                        {#if mod.category}<span class="nxm-cat">{mod.category}</span>{/if}
                    </div>
                    <div class="nxm-body">
                        <span class="nxm-name">{mod.name}</span>
                        {#if mod.summary}<p class="nxm-summary">{mod.summary}</p>{/if}
                        <div class="nxm-stats">
                            <span class="nxm-stat nxm-stat--endorse" title="Endorsements">{@html SVG_ENDORSE}{fmtCompact(mod.endorsements)}</span>
                            <span class="nxm-stat" title="Downloads">{@html SVG_DL}{fmtCompact(mod.downloads)}</span>
                            {#if mod.fileSize}<span class="nxm-stat nxm-stat--size">{fmtSize(mod.fileSize)}</span>{/if}
                        </div>
                    </div>
                </a>
                <a class="nxm-ext-corner" href={mod.url} target="_blank" rel="noopener" title="View on Nexus Mods">{@html SVG_EXT}</a>
            </div>
        {/each}
    </div>

    {#if (!deep && loading) || (deep && deepStatus === 'running')}
        <div class="nxmp-loading"><div class="community-loader"></div></div>
    {/if}
    <div class="nxmp-sentinel" use:bindSentinel></div>
</div>
