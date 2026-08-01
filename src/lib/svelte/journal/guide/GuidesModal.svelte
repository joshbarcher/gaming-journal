<script lang="ts">
    import { onMount, onDestroy, untrack } from 'svelte'
    import { navigate } from '../../../js/router.js'
    import { jobStore, type Job } from '$lib/guide-jobs.svelte.js'
    import { confirmDialog } from '../../../js/dialog.js'

    interface Guide {
        title: string
        url: string
        type: 'html' | 'text' | 'unknown'
    }

    interface MatchedGame {
        name: string
        platform?: string
        gameUrl: string
        score: number
    }

    interface SourceData {
        matchedGame: MatchedGame | null
        guides: Guide[]
        categories?: Record<string, Guide[]>
        searchedAt: string
    }

    interface SearchData {
        steamId: string
        sources: Record<string, SourceData>
    }

    interface DownloadedGuide {
        source: string
        guideId: string
        title: string
        author: string | null
        parsedAt: string | null
        pageCount: number
    }

    interface DownloadState {
        status: 'running' | 'done' | 'error'
        error?: string
    }

    const SOURCE_LABELS: Record<string, string> = { gamefaqs: 'GameFAQs', ign: 'IGN', steam: 'Steam', game8: 'Game8', gamerguides: 'Gamer Guides', fandom: 'Fandom', neoseeker: 'Neoseeker', thegamer: 'TheGamer' }

    const ALL_SOURCES = Object.keys(SOURCE_LABELS)

    let {
        appid,
        searchData,
        guides,
        gameName = '',
        searchingSet,
        onClose,
        onDownloaded,
        runSearch,
        refreshSearch,
    }: {
        appid: string
        searchData: SearchData | null
        guides: DownloadedGuide[]
        gameName?: string
        searchingSet: Set<string>
        onClose: () => void
        onDownloaded: (guideId: string) => void
        runSearch: (source: string) => Promise<void>
        refreshSearch: () => Promise<void>
    } = $props()

    let activeSource = $state<string>(ALL_SOURCES[0])
    /** Set once the user clicks a source — stops the "jump to the richest source" effect below. */
    let sourcePicked = $state(false)

    const searchRunning = $derived(searchingSet.size > 0)
    const activeSourceData = $derived(searchData?.sources?.[activeSource] ?? null)
    const categoryKeys = $derived(activeSourceData?.categories ? Object.keys(activeSourceData.categories) : [])

    function sourceGuideCount(src: string): number {
        return searchData?.sources?.[src]?.guides.length ?? 0
    }

    /* Rail order: sources that returned results first (richest at the top, ALL_SOURCES order breaking
       ties), then the not-yet-searched ones below a divider. Derived from searchData, so it only
       re-orders when a search actually lands — never mid-hover. */
    const sourceGroups = $derived.by(() => {
        const found: string[] = [], empty: string[] = []
        for (const src of ALL_SOURCES) (sourceGuideCount(src) > 0 ? found : empty).push(src)
        found.sort((a, b) => sourceGuideCount(b) - sourceGuideCount(a) || ALL_SOURCES.indexOf(a) - ALL_SOURCES.indexOf(b))
        return { found, empty }
    })

    /** Set once the rail has landed on the richest source — one auto-jump per open, no more. */
    let autoPicked = $state(false)

    // Open on the source with the most guides instead of whichever happens to be first in
    // ALL_SOURCES. Runs once, as soon as search data exists; untrack() keeps the write from
    // re-triggering the effect it lives in.
    $effect(() => {
        const top = sourceGroups.found[0]
        if (!top || untrack(() => sourcePicked || autoPicked)) return
        autoPicked = true
        activeSource = top
    })

    function selectSource(src: string) {
        sourcePicked = true
        activeSource = src
    }

    let selectedCategory = $state<string>('')

    $effect(() => {
        activeSource // track source switch
        selectedCategory = ''
    })

    // Also re-anchors when a refresh comes back with a different set of category names — a pill
    // that no longer exists would otherwise stay "selected" over an empty list.
    $effect(() => {
        if (categoryKeys.length === 0) return
        if (!selectedCategory || !categoryKeys.includes(selectedCategory)) selectedCategory = categoryKeys[0]
    })

    const visibleGuides = $derived(
        activeSourceData?.categories && selectedCategory
            ? (activeSourceData.categories[selectedCategory] ?? [])
            : (activeSourceData?.guides ?? [])
    )

    /** guideId → page count, for the active source only. Built once per source/guides change so the
        meta line ("Steam · HTML · 12 pages") is an O(1) lookup per row instead of a scan. */
    const activePages = $derived.by(() => {
        const result = new Map<string, number>()
        for (const g of guides) if (g.source === activeSource) result.set(g.guideId, g.pageCount)
        return result
    })

    const activeDownloadedIds = $derived(new Set(activePages.keys()))

    const DONE_STATE: DownloadState = { status: 'done' }

    function mapJobToState(job: Job): DownloadState {
        if (job.status === 'done')  return { status: 'done' }
        if (job.status === 'error') return { status: 'error', error: job.error ?? 'Unknown error' }
        return { status: 'running' }
    }

    const jobStates = $derived.by(() => {
        const result: Record<string, DownloadState> = {}
        for (const job of jobStore.jobs) {
            if (job.steamId !== String(appid) || job.source !== activeSource) continue
            result[job.guideId] = mapJobToState(job)
        }
        return result
    })

    const states = $derived.by(() => {
        const result: Record<string, DownloadState> = {}
        for (const id of activeDownloadedIds) result[id] = { ...DONE_STATE }
        for (const [id, s] of Object.entries(jobStates)) result[id] = s
        return result
    })

    let _notified = new Set<string>()
    $effect(() => {
        for (const job of jobStore.jobs) {
            if (job.steamId !== String(appid)) continue
            if (job.status === 'done' && !_notified.has(job.id)) {
                _notified.add(job.id)
                onDownloaded(job.guideId)
            }
        }
    })

    function guideIdFromUrl(url: string): string | null {
        try {
            const u = new URL(url)
            if (u.hostname.includes('steamcommunity.com')) return u.searchParams.get('id')
            if (u.hostname.endsWith('.fandom.com')) {
                const sub = u.hostname.split('.')[0]
                const article = decodeURIComponent(u.pathname.replace(/^\/wiki\//, ''))
                if (article) return `${sub}--${article.replace(/ /g, '_')}`
            }
            if (u.hostname.includes('neoseeker.com')) {
                return u.pathname.match(/\/([a-z0-9-]+)\/walkthrough/i)?.[1] ?? null
            }
            if (u.hostname.includes('thegamer.com')) {
                const slug = u.pathname.match(/^\/([a-z0-9-]+)\/?$/i)?.[1]?.toLowerCase() ?? null
                return (slug && !['tag', 'author', 'category', 'search'].includes(slug)) ? slug : null
            }
        } catch { /* fall through */ }
        return url.match(/\/faqs\/(\d+)/)?.[1]
            ?? url.match(/ign\.com\/wikis\/([^/?#]+)/i)?.[1]?.toLowerCase()
            ?? url.match(/game8\.co\/games\/([A-Za-z0-9-]+)/i)?.[1]
            ?? url.match(/gamerguides\.com\/([^/?#]+)/i)?.[1]
            ?? null
    }

    async function downloadGuide(guide: Guide) {
        const src = activeSource
        const guideId = guideIdFromUrl(guide.url)
        if (!guideId) return
        const existing = jobStore.jobFor(String(appid), src, guideId)
        if (existing?.status === 'pending' || existing?.status === 'running') return

        if (activeDownloadedIds.has(guideId)) {
            try {
                const raw = localStorage.getItem(`guide-pins:${appid}:${src}:${guideId}`)
                const stored = raw ? JSON.parse(raw) : null
                const pinCount: number = stored?.pins?.length ?? 0
                if (pinCount > 0) {
                    const ok = await confirmDialog(
                        'Re-download will clear pins',
                        `This guide has ${pinCount} pin${pinCount !== 1 ? 's' : ''}. Re-downloading will clear all of them.`,
                        'Re-download'
                    )
                    if (!ok) return
                    localStorage.removeItem(`guide-pins:${appid}:${src}:${guideId}`)
                }
            } catch { /* ignore */ }
        }

        try {
            await jobStore.enqueue({
                steamId:  String(appid),
                source:   src,
                guideId,
                url:      guide.url,
                gameName: gameName || activeSourceData?.matchedGame?.name || '',
            })
        } catch (err: any) {
            console.error('[GuidesModal] enqueue failed:', err.message)
        }
    }

    function onKeyDown(e: KeyboardEvent) {
        if (e.key === 'Escape') onClose()
    }

    /* Move the overlay onto <body>, the way every other overlay in the app is mounted
       (dialog.ts, review-modal.ts, lightbox.ts). #main-content's OverlayScrollbars viewport
       carries `z-index: 0`, and that stacking context traps a position:fixed child beneath
       the sidebar (z-index 1) no matter how high its own z-index is — at the two-pane width
       the panel's left edge slid under the nav. */
    function portal(node: HTMLElement) {
        document.body.appendChild(node)
        return { destroy: () => node.remove() }
    }

    onMount(() => {
        document.addEventListener('keydown', onKeyDown)
        jobStore.fetchAll()
    })
    onDestroy(() => document.removeEventListener('keydown', onKeyDown))
</script>

{#snippet iconExternal(size: number)}
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width={size} height={size} aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
{/snippet}

{#snippet iconRefresh(size: number)}
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width={size} height={size} aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
{/snippet}

{#snippet sourceRow(src: string)}
    {@const count = sourceGuideCount(src)}
    {@const spinning = searchingSet.has(src)}
    <button
        class="gm-source"
        class:gm-source--active={activeSource === src}
        class:gm-source--empty={count === 0}
        onclick={() => selectSource(src)}
    >
        <span class="gm-source-name">{SOURCE_LABELS[src]}</span>
        {#if spinning}
            <span class="gm-spinner"></span>
        {:else}
            <span class="gm-source-count">{count > 0 ? count : '—'}</span>
        {/if}
    </button>
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="gm-backdrop" use:portal role="dialog" aria-modal="true" tabindex="-1" aria-label="Guides for {gameName || 'this game'}" onkeydown={onKeyDown}>
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="gm-scrim" onclick={onClose}></div>

    <div class="gm-panel">
        <header class="gm-header">
            <div class="gm-header-main">
                <span class="gm-eyebrow">Guides for</span>
                <h2 class="gm-title">
                    <span class="gm-title-text">{gameName || 'this game'}</span>
                    {#if activeSourceData?.matchedGame}
                        <a
                            class="gm-title-link"
                            href={activeSourceData.matchedGame.gameUrl}
                            target="_blank" rel="noopener noreferrer"
                            title="{activeSourceData.matchedGame.name}{activeSourceData.matchedGame.platform ? ` · ${activeSourceData.matchedGame.platform.toUpperCase()}` : ''} on {SOURCE_LABELS[activeSource]}"
                            aria-label="Open on {SOURCE_LABELS[activeSource]}"
                        >{@render iconExternal(18)}</a>
                    {/if}
                </h2>
            </div>
            <button class="gm-close" onclick={onClose} aria-label="Close">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
        </header>

        <div class="gm-body">
            <!-- Left rail: one row per source, results first, un-searched below the divider -->
            <aside class="gm-rail">
                <span class="gm-rail-label">Sources</span>
                <div class="gm-rail-list">
                    {#each sourceGroups.found as src (src)}
                        {@render sourceRow(src)}
                    {/each}
                    {#if sourceGroups.found.length > 0 && sourceGroups.empty.length > 0}
                        <div class="gm-rail-sep"></div>
                    {/if}
                    {#each sourceGroups.empty as src (src)}
                        {@render sourceRow(src)}
                    {/each}
                </div>
                <button class="gm-rail-all" disabled={searchRunning} onclick={refreshSearch}>
                    <span class="gm-rail-all-icon" class:gm-rail-all-icon--spinning={searchRunning}>{@render iconRefresh(14)}</span>
                    Search all sources
                </button>
            </aside>

            <section class="gm-main">
                <!-- Category filter pills (sources without categories get a single count pill) -->
                <div class="gm-filters">
                    <div class="gm-filter-pills">
                        {#if categoryKeys.length}
                            {#each categoryKeys as cat (cat)}
                                <button
                                    class="gm-pill"
                                    class:gm-pill--active={selectedCategory === cat}
                                    onclick={() => selectedCategory = cat}
                                >
                                    {cat}
                                    <span class="gm-pill-count">{activeSourceData?.categories?.[cat]?.length ?? 0}</span>
                                </button>
                            {/each}
                        {:else if visibleGuides.length}
                            <span class="gm-pill gm-pill--active gm-pill--static">
                                All guides
                                <span class="gm-pill-count">{visibleGuides.length}</span>
                            </span>
                        {/if}
                    </div>
                    <button
                        class="gm-src-refresh"
                        class:gm-src-refresh--spinning={searchingSet.has(activeSource)}
                        disabled={searchingSet.has(activeSource)}
                        onclick={() => runSearch(activeSource)}
                        title="Search {SOURCE_LABELS[activeSource]} again"
                        aria-label="Search {SOURCE_LABELS[activeSource]} again"
                    >{@render iconRefresh(15)}</button>
                </div>

                <div class="gm-list">
                    {#if searchingSet.has(activeSource) && !activeSourceData}
                        <div class="gm-empty">
                            <span class="gm-spinner gm-spinner--lg"></span>
                            <p class="gm-empty-msg">Searching {SOURCE_LABELS[activeSource]}…</p>
                        </div>
                    {:else if !activeSourceData}
                        <div class="gm-empty">
                            <p class="gm-empty-msg">{SOURCE_LABELS[activeSource]} hasn't been searched yet.</p>
                            <button class="gm-empty-btn" onclick={() => runSearch(activeSource)}>
                                {@render iconRefresh(14)} Search {SOURCE_LABELS[activeSource]}
                            </button>
                        </div>
                    {:else if visibleGuides.length === 0}
                        <div class="gm-empty">
                            <p class="gm-empty-msg">No guides found on {SOURCE_LABELS[activeSource]}.</p>
                            <button class="gm-empty-btn" disabled={searchingSet.has(activeSource)} onclick={() => runSearch(activeSource)}>
                                {@render iconRefresh(14)} Search again
                            </button>
                        </div>
                    {:else}
                        {#each visibleGuides as guide (guide.url)}
                            {@const guideId = guideIdFromUrl(guide.url)}
                            {@const state = guideId ? (states[guideId] ?? null) : null}
                            {@const pages = guideId ? activePages.get(guideId) : undefined}
                            <div class="gm-row" class:gm-row--running={state?.status === 'running'}>
                                <div class="gm-row-info">
                                    <span class="gm-guide-title">{guide.title}</span>
                                    <div class="gm-guide-meta">
                                        <span>{SOURCE_LABELS[activeSource] ?? activeSource}</span>
                                        <span class="gm-meta-dot">·</span>
                                        <span>{guide.type === 'unknown' ? 'Link' : guide.type.toUpperCase()}</span>
                                        {#if pages}
                                            <span class="gm-meta-dot">·</span>
                                            <span>{pages} page{pages === 1 ? '' : 's'}</span>
                                        {/if}
                                        <a class="gm-ext-link" href={guide.url} target="_blank" rel="noopener noreferrer" title="View on {SOURCE_LABELS[activeSource] ?? activeSource}" aria-label="View original">
                                            {@render iconExternal(12)}
                                        </a>
                                    </div>
                                </div>

                                <div class="gm-row-action">
                                    {#if !guideId}
                                        <span class="gm-status-err">Unsupported link</span>
                                    {:else if state?.status === 'done'}
                                        <a class="gm-btn gm-btn--open" href={`/journal/${appid}/guides/${activeSource}/${guideId}`} onclick={(e) => { e.preventDefault(); const dest = `journal/${appid}/guides/${activeSource}/${guideId}`; onClose(); navigate(dest) }}>
                                            Open
                                        </a>
                                        <button class="gm-icon-btn" onclick={() => downloadGuide(guide)} title="Re-fetch missing pages" aria-label="Re-download">
                                            {@render iconRefresh(13)}
                                        </button>
                                    {:else if state?.status === 'error'}
                                        <span class="gm-status-err" title={state.error}>Failed</span>
                                        <button class="gm-btn" onclick={() => downloadGuide(guide)}>Retry</button>
                                    {:else if state?.status === 'running'}
                                        <a class="gm-btn gm-btn--running" href="/downloads" onclick={(e) => { e.preventDefault(); onClose(); navigate('downloads') }}>
                                            <span class="gm-spinner"></span> Downloading
                                        </a>
                                    {:else}
                                        <button class="gm-btn" onclick={() => downloadGuide(guide)}>Download</button>
                                    {/if}
                                </div>
                            </div>
                        {/each}
                    {/if}
                </div>
            </section>
        </div>
    </div>
</div>
