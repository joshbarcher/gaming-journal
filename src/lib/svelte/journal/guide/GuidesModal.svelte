<script lang="ts">
    import { onMount, onDestroy } from 'svelte'
    import { navigate } from '../../../js/router.js'

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
        searchedAt: string
    }

    interface PhaseBar { pct: number; status: 'pending' | 'active' | 'done' }

    interface DownloadState {
        status:   'running' | 'done' | 'error'
        download: PhaseBar
        pages:    PhaseBar
        subtask:  PhaseBar
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

    const DONE_STATE: DownloadState = {
        status:   'done',
        download: { pct: 100, status: 'done' },
        pages:    { pct: 100, status: 'done' },
        subtask:  { pct: 100, status: 'done' },
    }

    let states = $state<Record<string, DownloadState>>({})

    $effect(() => {
        for (const id of downloadedGuideIds) {
            if (!states[id]) states[id] = { ...DONE_STATE }
        }
    })

    const SOURCE_LABELS: Record<string, string> = { gamefaqs: 'GameFAQs', ign: 'IGN' }

    function guideIdFromUrl(url: string): string | null {
        return url.match(/\/faqs\/(\d+)/)?.[1]
            ?? url.match(/ign\.com\/wikis\/([^/?#]+)/i)?.[1]?.toLowerCase()
            ?? null
    }

    const PHASES: { key: keyof Omit<DownloadState, 'status' | 'error'>; label: string }[] = [
        { key: 'download', label: 'Download' },
        { key: 'pages',    label: 'Pages'    },
        { key: 'subtask',  label: 'Page'     },
    ]

    async function downloadGuide(guide: Guide) {
        const guideId = guideIdFromUrl(guide.url)
        if (!guideId) return
        if (states[guideId]?.status === 'done') return

        states[guideId] = {
            status:   'running',
            download: { pct: 0, status: 'active' },
            pages:    { pct: 0, status: 'pending' },
            subtask:  { pct: 0, status: 'pending' },
        }

        try {
            const resp = await fetch(`/relay/api/guides/${appid}/download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source, url: guide.url }),
            })

            if (!resp.ok || !resp.body) {
                const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }))
                states[guideId] = { ...states[guideId], status: 'error', error: err.error ?? 'Download failed' }
                return
            }

            const reader = resp.body.getReader()
            const decoder = new TextDecoder()
            let buf = ''

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

                        const cur = states[guideId]
                        if (event.phase === 'fetch-guide') {
                            const m = event.line?.match(/\[(\d+)\/(\d+)\]/)
                            if (m) {
                                const pct = Math.round(parseInt(m[1]) / parseInt(m[2]) * 100)
                                states[guideId] = { ...cur, download: { pct, status: 'active' } }
                            }
                        } else if (event.phase === 'parse') {
                            // Controller marker: download done, parse phase starting
                            states[guideId] = { ...cur, download: { pct: 100, status: 'done' }, pages: { pct: 0, status: 'active' }, subtask: { pct: 0, status: 'active' } }
                        } else if (event.phase === 'progress') {
                            const bar = event.bar as string | undefined
                            if (bar === 'pages') {
                                states[guideId] = { ...cur, pages: { pct: event.pct, status: 'active' } }
                            } else if (bar === 'subtask') {
                                states[guideId] = { ...cur, subtask: { pct: event.pct, status: 'active' } }
                            }
                        } else if (event.phase === 'done') {
                            states[guideId] = { ...DONE_STATE }
                            onDownloaded(guideId)
                        } else if (event.phase === 'error') {
                            states[guideId] = { ...cur, status: 'error', error: event.message }
                        }
                    }
                }
            }
        } catch (err: any) {
            if (states[guideId]?.status !== 'done') {
                states[guideId] = { ...states[guideId], status: 'error', error: err.message }
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
                        {sourceData.matchedGame.name}{sourceData.matchedGame.platform ? ` · ${sourceData.matchedGame.platform.toUpperCase()}` : ''}
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
                <div class="gm-row" class:gm-row--running={state?.status === 'running'}>
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
                        {:else if state?.status === 'done'}
                            <a class="gm-open-btn" href={`/journal/${appid}/guides/${source}/${guideId}`} onclick={(e) => { e.preventDefault(); onClose(); navigate(`journal/${appid}/guides/${source}/${guideId}`) }}>
                                Open ›
                            </a>
                        {:else if state?.status === 'error'}
                            <span class="gm-status-err" title={state.error}>Failed</span>
                        {:else if state?.status === 'running'}
                            <div class="gm-phases">
                                {#each PHASES as p}
                                    {@const bar = state[p.key]}
                                    <div class="gm-phase gm-phase--{bar.status}">
                                        <span class="gm-phase-label">{p.label}</span>
                                        <div class="gm-phase-track">
                                            <div class="gm-phase-fill" style="width:{bar.pct}%"></div>
                                        </div>
                                        <span class="gm-phase-pct">
                                            {bar.status === 'pending' ? '—' : bar.status === 'done' ? '✓' : `${bar.pct}%`}
                                        </span>
                                    </div>
                                {/each}
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
