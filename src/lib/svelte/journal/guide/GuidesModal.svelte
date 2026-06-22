<script lang="ts">
    import { onMount, onDestroy } from 'svelte'

    interface Guide {
        title: string
        url: string
        type: 'html' | 'text' | 'unknown'
    }

    interface MatchedGame {
        name: string
        platform: string
        gameUrl: string
        score: number
    }

    interface SourceData {
        matchedGame: MatchedGame | null
        guides: Guide[]
        searchedAt: string
    }

    type DownloadPhase = 'fetch' | 'parse' | 'done' | 'error'

    interface DownloadState {
        phase: DownloadPhase
        pct: number
        label?: string
        error?: string
    }

    let {
        appid,
        source,
        sourceData,
        downloadedGuideIds,
        onClose,
        onDownloaded,
    }: {
        appid: string
        source: string
        sourceData: SourceData
        downloadedGuideIds: Set<string>
        onClose: () => void
        onDownloaded: (guideId: string) => void
    } = $props()

    let states = $state<Record<string, DownloadState>>({})

    // Pre-mark already-downloaded guides as done
    $effect(() => {
        for (const id of downloadedGuideIds) {
            if (!states[id]) states[id] = { phase: 'done', pct: 100 }
        }
    })

    const SOURCE_LABELS: Record<string, string> = { gamefaqs: 'GameFAQs' }

    function guideIdFromUrl(url: string): string | null {
        return url.match(/\/faqs\/(\d+)/)?.[1] ?? null
    }

    async function downloadGuide(guide: Guide) {
        const guideId = guideIdFromUrl(guide.url)
        if (!guideId) return
        if (states[guideId]?.phase === 'done') return

        states[guideId] = { phase: 'fetch', pct: 5 }

        try {
            const resp = await fetch(`/relay/api/guides/${appid}/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source, url: guide.url }),
            })

            if (!resp.ok || !resp.body) {
                const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }))
                states[guideId] = { phase: 'error', pct: 0, error: err.error ?? 'Download failed' }
                return
            }

            const reader = resp.body.getReader()
            const decoder = new TextDecoder()
            let buf = ''
            let fetchLines = 0
            let parseLines = 0

            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                buf += decoder.decode(value, { stream: true })
                const parts = buf.split('\n\n')
                buf = parts.pop() ?? ''

                for (const part of parts) {
                    for (const raw of part.split('\n')) {
                        if (!raw.startsWith('data: ')) continue
                        let event: any
                        try { event = JSON.parse(raw.slice(6)) } catch { continue }

                        console.log(`[guides:modal:sse] ${new Date().toISOString()}`, JSON.stringify(event).slice(0, 120))

                        if (event.phase === 'fetch-guide') {
                            fetchLines++
                            states[guideId] = { phase: 'fetch', pct: Math.min(5 + fetchLines * 2, 29) }
                        } else if (event.phase === 'progress') {
                            const label = event.pct < 46 ? 'Parsing…' : event.pct < 85 ? 'Downloading images…' : 'Converting…'
                            states[guideId] = { phase: 'parse', pct: event.pct, label }
                        } else if (event.phase === 'done') {
                            states[guideId] = { phase: 'done', pct: 100 }
                            onDownloaded(guideId)
                        } else if (event.phase === 'error') {
                            states[guideId] = { phase: 'error', pct: 0, error: event.message }
                        }
                    }
                }
            }
        } catch (err: any) {
            if (states[guideId]?.phase !== 'done') {
                states[guideId] = { phase: 'error', pct: 0, error: err.message }
            }
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
                        {sourceData.matchedGame.name} · {sourceData.matchedGame.platform.toUpperCase()}
                        <a class="gm-matched-link" href={sourceData.matchedGame.gameUrl} target="_blank" rel="noopener noreferrer">↗</a>
                    </span>
                {/if}
            </div>
            <button class="gm-close" onclick={onClose} aria-label="Close">✕</button>
        </div>

        <div class="gm-list">
            {#each sourceData.guides as guide}
                {@const guideId = guideIdFromUrl(guide.url)}
                {@const state = guideId ? (states[guideId] ?? null) : null}
                <div class="gm-row" class:gm-row--done={state?.phase === 'done'}>
                    <div class="gm-row-info">
                        <span class="gm-guide-title">{guide.title}</span>
                        <div class="gm-guide-meta">
                            <span class="gm-type-badge gm-type-badge--{guide.type}">{guide.type}</span>
                            <a class="gm-ext-link" href={guide.url} target="_blank" rel="noopener noreferrer" title="View on GameFAQs">View ↗</a>
                        </div>
                    </div>

                    <div class="gm-row-action">
                        {#if !guideId}
                            <span class="gm-status-err">—</span>
                        {:else if state?.phase === 'done'}
                            <span class="gm-status-done">✓ Downloaded</span>
                        {:else if state?.phase === 'error'}
                            <span class="gm-status-err" title={state.error}>Failed</span>
                        {:else if state}
                            <div class="gm-progress">
                                <span class="gm-progress-label">{state.label ?? (state.phase === 'fetch' ? 'Fetching…' : 'Parsing…')}</span>
                                <div class="gm-progress-track">
                                    <div class="gm-progress-fill" style="width:{state.pct}%"></div>
                                </div>
                            </div>
                        {:else}
                            <button class="gm-dl-btn" onclick={() => downloadGuide(guide)}>Download</button>
                        {/if}
                    </div>
                </div>
            {/each}
        </div>
    </div>
</div>
