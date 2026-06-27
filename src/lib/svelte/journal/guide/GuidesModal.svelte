<script lang="ts">
    import { onMount, onDestroy } from 'svelte'
    import { navigate } from '../../../js/router.js'
    import { jobStore, type Job } from '$lib/guide-jobs.svelte.js'

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

    interface DownloadState {
        status: 'running' | 'done' | 'error'
        error?: string
    }

    let {
        appid,
        source,
        sourceData,
        downloadedGuideIds,
        gameName = '',
        onClose,
        onDownloaded,
    }: {
        appid: string
        source: string
        sourceData: SourceData
        downloadedGuideIds: Set<string>
        gameName?: string
        onClose: () => void
        onDownloaded: (guideId: string) => void
    } = $props()

    const DONE_STATE: DownloadState = { status: 'done' }

    const categoryKeys = $derived(sourceData.categories ? Object.keys(sourceData.categories) : [])
    let selectedCategory = $state<string>('')
    $effect(() => {
        if (categoryKeys.length && !selectedCategory) selectedCategory = categoryKeys[0]
    })
    const visibleGuides = $derived(
        sourceData.categories && selectedCategory
            ? (sourceData.categories[selectedCategory] ?? [])
            : sourceData.guides
    )

    const SOURCE_LABELS: Record<string, string> = { gamefaqs: 'GameFAQs', ign: 'IGN', steam: 'Steam', game8: 'Game8', gamerguides: 'Gamer Guides', fandom: 'Fandom', neoseeker: 'Neoseeker' }

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

    function mapJobToState(job: Job): DownloadState {
        if (job.status === 'done')  return { status: 'done' }
        if (job.status === 'error') return { status: 'error', error: job.error ?? 'Unknown error' }
        return { status: 'running' }
    }

    // Map from job store: jobs for this appid+source override anything else
    const jobStates = $derived.by(() => {
        const result: Record<string, DownloadState> = {}
        for (const job of jobStore.jobs) {
            if (job.steamId !== String(appid) || job.source !== source) continue
            result[job.guideId] = mapJobToState(job)
        }
        return result
    })

    // Final state: already-downloaded IDs as base, job store state on top
    const states = $derived.by(() => {
        const result: Record<string, DownloadState> = {}
        for (const id of downloadedGuideIds) {
            result[id] = { ...DONE_STATE }
        }
        for (const [id, s] of Object.entries(jobStates)) {
            result[id] = s
        }
        return result
    })

    // Fire onDownloaded when a job transitions to done
    let _notified = new Set<string>()
    $effect(() => {
        for (const job of jobStore.jobs) {
            if (job.steamId !== String(appid) || job.source !== source) continue
            if (job.status === 'done' && !_notified.has(job.id)) {
                _notified.add(job.id)
                onDownloaded(job.guideId)
            }
        }
    })

    async function downloadGuide(guide: Guide) {
        const guideId = guideIdFromUrl(guide.url)
        if (!guideId) return
        const existing = jobStore.jobFor(String(appid), source, guideId)
        if (existing?.status === 'pending' || existing?.status === 'running') return

        try {
            await jobStore.enqueue({
                steamId:  String(appid),
                source,
                guideId,
                url:      guide.url,
                gameName: gameName || sourceData.matchedGame?.name || '',
            })
        } catch (err: any) {
            console.error('[GuidesModal] enqueue failed:', err.message)
        }
    }

    function onKeyDown(e: KeyboardEvent) {
        if (e.key === 'Escape') onClose()
    }

    onMount(() => document.addEventListener('keydown', onKeyDown))
    onDestroy(() => document.removeEventListener('keydown', onKeyDown))
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="gm-backdrop" role="dialog" aria-modal="true" onkeydown={onKeyDown}>
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="gm-scrim" onclick={onClose}></div>

    <div class="gm-panel">
        <div class="gm-header">
            <div class="gm-header-main">
                <span class="gm-source-label">{SOURCE_LABELS[source] ?? source}</span>
                <h2 class="gm-title">Available Guides</h2>
                {#if sourceData.matchedGame}
                    <span class="gm-matched">
                        {sourceData.matchedGame.name}{sourceData.matchedGame.platform ? ` · ${sourceData.matchedGame.platform.toUpperCase()}` : ''}
                        <a class="gm-matched-link" href={sourceData.matchedGame.gameUrl} target="_blank" rel="noopener noreferrer" title="Open on Steam">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
                        </a>
                    </span>
                {/if}
            </div>
            <button class="gm-close" onclick={onClose} aria-label="Close">✕</button>
        </div>

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
            {#each visibleGuides as guide}
                {@const guideId = guideIdFromUrl(guide.url)}
                {@const state = guideId ? (states[guideId] ?? null) : null}
                <div class="gm-row" class:gm-row--running={state?.status === 'running'}>
                    <div class="gm-row-info">
                        <span class="gm-guide-title">{guide.title}</span>
                        <div class="gm-guide-meta">
                            <span class="gm-type-badge gm-type-badge--{guide.type}">{guide.type}</span>
                            <a class="gm-ext-link" href={guide.url} target="_blank" rel="noopener noreferrer" title="View on {SOURCE_LABELS[source] ?? source}">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
                            </a>
                        </div>
                    </div>

                    <div class="gm-row-action">
                        {#if !guideId}
                            <span class="gm-status-err">—</span>
                        {:else if state?.status === 'done'}
                            <div class="gm-done-actions">
                                <a class="gm-open-btn" href={`/journal/${appid}/guides/${source}/${guideId}`} onclick={(e) => { e.preventDefault(); const dest = `journal/${appid}/guides/${source}/${guideId}`; onClose(); navigate(dest) }}>
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
        </div>
    </div>
</div>
