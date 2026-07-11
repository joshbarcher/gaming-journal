<script lang="ts">
    import { onMount, onDestroy } from 'svelte'
    import type { NexusMod, NexusModsPage } from '../../types.js'
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

    let gameName   = $state('')
    let gameUrl    = $state('')
    let mods       = $state<NexusMod[]>([])
    let totalCount = $state(0)
    let sort       = $state('endorsements')
    let query      = $state('')     // raw input
    let activeQ    = $state('')     // debounced/applied
    let offset     = $state(0)
    let loading    = $state(false)
    let done       = $state(false)
    let error      = $state(false)
    let notOnNexus = $state(false)

    let sentinel: HTMLElement | null = null
    let io: IntersectionObserver | undefined
    let debounceT: ReturnType<typeof setTimeout> | null = null

    async function loadMeta() {
        try {
            const r = await fetch(`/relay/api/nexus/${appid}`)
            if (r.ok) { const e = await r.json(); gameName = e.steamName ?? e.nexusName ?? 'Game'; gameUrl = e.gameUrl ?? '' }
        } catch { /* breadcrumb falls back to "Game" */ }
    }

    async function loadPage(reset = false) {
        if (loading) return
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

    function onSortChange(e: Event) { sort = (e.currentTarget as HTMLSelectElement).value; loadPage(true) }
    function onSearchInput(e: Event) {
        query = (e.currentTarget as HTMLInputElement).value
        if (debounceT) clearTimeout(debounceT)
        debounceT = setTimeout(() => { activeQ = query.trim(); loadPage(true) }, 350)
    }

    onMount(() => {
        loadMeta()
        loadPage(true)
        const scrollEl = (getScrollInstance()?.elements().viewport as HTMLElement) ?? document.getElementById('main-content')
        io = new IntersectionObserver(entries => { if (entries[0].isIntersecting) loadPage(false) },
            { root: scrollEl ?? null, rootMargin: '700px' })
        if (sentinel) io.observe(sentinel)
    })
    onDestroy(() => { io?.disconnect(); if (debounceT) clearTimeout(debounceT) })

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
        <h1 class="nxmp-title">Mods{#if totalCount} <span class="nxmp-count">{totalCount.toLocaleString()}</span>{/if}</h1>
        <div class="nxmp-controls">
            <div class="nxmp-search">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="search" placeholder="Search mods…" value={query} oninput={onSearchInput} aria-label="Search mods" />
            </div>
            <select class="nxmp-sort" value={sort} onchange={onSortChange} aria-label="Sort mods">
                {#each SORTS as s}<option value={s.key}>{s.label}</option>{/each}
            </select>
        </div>
    </header>

    {#if notOnNexus}
        <p class="nxmp-empty">This game isn’t on Nexus Mods.</p>
    {:else if error && mods.length === 0}
        <p class="nxmp-empty">Couldn’t load mods. Try again later.</p>
    {:else if !loading && mods.length === 0 && activeQ}
        <p class="nxmp-empty">No mods match “{activeQ}”.</p>
    {/if}

    <div class="nxm-grid nxm-grid--page">
        {#each mods as mod (mod.modId)}
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

    {#if loading}
        <div class="nxmp-loading"><div class="community-loader"></div></div>
    {/if}
    <div class="nxmp-sentinel" use:bindSentinel></div>
</div>
