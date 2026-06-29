<script lang="ts">
    import { onMount, onDestroy } from 'svelte'
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

    const SOURCE_LABELS: Record<string, string> = { gamefaqs: 'GameFAQs', ign: 'IGN', steam: 'Steam', game8: 'Game8', gamerguides: 'Gamer Guides', fandom: 'Fandom', neoseeker: 'Neoseeker' }
    const SOURCE_ICONS:  Record<string, string> = { gamefaqs: '/images/guides/gamefaqs.webp', ign: '/images/guides/ign.webp', steam: '/images/guides/steam.webp', game8: '/images/guides/game8.webp', gamerguides: '/images/guides/gamerguides.webp', fandom: '/images/guides/fandom.webp', neoseeker: '/images/guides/neoseeker.webp' }

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

    const searchRunning = $derived(searchingSet.size > 0)
    const activeSourceData = $derived(searchData?.sources?.[activeSource] ?? null)
    const categoryKeys = $derived(activeSourceData?.categories ? Object.keys(activeSourceData.categories) : [])

    let selectedCategory = $state<string>('')

    $effect(() => {
        activeSource // track source switch
        selectedCategory = ''
    })

    $effect(() => {
        if (categoryKeys.length > 0 && !selectedCategory) selectedCategory = categoryKeys[0]
    })

    const visibleGuides = $derived(
        activeSourceData?.categories && selectedCategory
            ? (activeSourceData.categories[selectedCategory] ?? [])
            : (activeSourceData?.guides ?? [])
    )

    const activeDownloadedIds = $derived(
        new Set(guides.filter(g => g.source === activeSource).map(g => g.guideId))
    )

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

    function sourceGuideCount(src: string): number {
        return searchData?.sources?.[src]?.guides.length ?? 0
    }

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

    onMount(() => {
        document.addEventListener('keydown', onKeyDown)
        jobStore.fetchAll()
    })
    onDestroy(() => document.removeEventListener('keydown', onKeyDown))
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="gm-backdrop" role="dialog" aria-modal="true" onkeydown={onKeyDown}>
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="gm-scrim" onclick={onClose}></div>

    <div class="gm-panel">
        <div class="gm-header">
            <div class="gm-header-main">
                <h2 class="gm-title">Available Guides</h2>
            </div>
            <button class="gm-close" onclick={onClose} aria-label="Close">✕</button>
        </div>

        <!-- Source tab bar: one tab per website + Refresh All -->
        <div class="gm-source-tabs">
            {#each ALL_SOURCES as src}
                {@const count = sourceGuideCount(src)}
                {@const spinning = searchingSet.has(src)}
                <button
                    class="gm-source-tab"
                    class:gm-source-tab--active={activeSource === src}
                    onclick={() => activeSource = src}
                >
                    <img class="gm-source-tab-icon" src={SOURCE_ICONS[src]} alt={SOURCE_LABELS[src]}>
                    {SOURCE_LABELS[src]}
                    {#if spinning}
                        <span class="gm-tab-spinner"></span>
                    {:else if count > 0}
                        <span class="gm-tab-badge">{count}</span>
                    {/if}
                </button>
            {/each}
            <div class="gm-source-tabs-end">
                <button
                    class="gm-refresh-all-btn"
                    disabled={searchRunning}
                    onclick={refreshSearch}
                >↻ All</button>
            </div>
        </div>

        <!-- Per-source matched game info + individual refresh -->
        <div class="gm-source-info">
            {#if activeSourceData?.matchedGame}
                <span class="gm-source-info-label">
                    {activeSourceData.matchedGame.name}{activeSourceData.matchedGame.platform ? ` · ${activeSourceData.matchedGame.platform.toUpperCase()}` : ''}
                </span>
                <a class="gm-matched-link" href={activeSourceData.matchedGame.gameUrl} target="_blank" rel="noopener noreferrer" title="View on {SOURCE_LABELS[activeSource]}">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
                </a>
            {:else}
                <span class="gm-source-info-label gm-source-info-label--empty">
                    {searchingSet.has(activeSource) ? 'Searching…' : 'Not yet searched'}
                </span>
            {/if}
            <button
                class="gm-source-refresh-btn"
                class:gm-source-refresh-btn--spinning={searchingSet.has(activeSource)}
                disabled={searchingSet.has(activeSource)}
                onclick={() => runSearch(activeSource)}
                title="Search {SOURCE_LABELS[activeSource]}"
            >↻</button>
        </div>

        <!-- Category sub-tabs (if this source has categories, e.g. GameFAQs) -->
        {#if categoryKeys.length}
            <div class="gm-tabs">
                {#each categoryKeys as cat}
                    <button
                        class="gm-tab"
                        class:gm-tab--active={selectedCategory === cat}
                        onclick={() => selectedCategory = cat}
                    >{cat}</button>
                {/each}
            </div>
        {/if}

        <div class="gm-list">
            {#if !activeSourceData && !searchingSet.has(activeSource)}
                <p class="gm-empty-msg">Click ↻ to search for guides on {SOURCE_LABELS[activeSource]}</p>
            {:else if !activeSourceData}
                <p class="gm-empty-msg">Searching {SOURCE_LABELS[activeSource]}…</p>
            {:else if visibleGuides.length === 0}
                <p class="gm-empty-msg">No guides found on {SOURCE_LABELS[activeSource]}</p>
            {:else}
                {#each visibleGuides as guide}
                    {@const guideId = guideIdFromUrl(guide.url)}
                    {@const state = guideId ? (states[guideId] ?? null) : null}
                    <div class="gm-row" class:gm-row--running={state?.status === 'running'}>
                        <div class="gm-row-info">
                            <span class="gm-guide-title">{guide.title}</span>
                            <div class="gm-guide-meta">
                                <span class="gm-type-badge gm-type-badge--{guide.type}">{guide.type}</span>
                                <a class="gm-ext-link" href={guide.url} target="_blank" rel="noopener noreferrer" title="View on {SOURCE_LABELS[activeSource] ?? activeSource}">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
                                </a>
                            </div>
                        </div>

                        <div class="gm-row-action">
                            {#if !guideId}
                                <span class="gm-status-err">—</span>
                            {:else if state?.status === 'done'}
                                <div class="gm-done-actions">
                                    <a class="gm-open-btn" href={`/journal/${appid}/guides/${activeSource}/${guideId}`} onclick={(e) => { e.preventDefault(); const dest = `journal/${appid}/guides/${activeSource}/${guideId}`; onClose(); navigate(dest) }}>
                                        Open ›
                                    </a>
                                    <button class="gm-refresh-btn" onclick={() => downloadGuide(guide)} title="Re-fetch missing pages">
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
                                    </button>
                                </div>
                            {:else if state?.status === 'error'}
                                <div class="gm-done-actions">
                                    <span class="gm-status-err" title={state.error}>Failed</span>
                                    <button class="gm-dl-btn" onclick={() => downloadGuide(guide)}>Retry</button>
                                </div>
                            {:else if state?.status === 'running'}
                                <a class="gm-dl-btn gm-dl-btn--active" href="/downloads" onclick={(e) => { e.preventDefault(); onClose(); navigate('downloads') }}>Downloading →</a>
                            {:else}
                                <button class="gm-dl-btn" onclick={() => downloadGuide(guide)}>Download</button>
                            {/if}
                        </div>
                    </div>
                {/each}
            {/if}
        </div>
    </div>
</div>
