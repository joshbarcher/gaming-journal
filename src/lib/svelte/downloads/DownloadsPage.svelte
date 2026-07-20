<script lang="ts">
    import { onMount } from 'svelte'
    import { jobStore, type Job } from '$lib/guide-jobs.svelte.js'
    import { trackerSuggestJobStore, type TrackerSuggestJob } from '$lib/tracker-suggest-jobs.svelte.js'
    import { confirmDialog } from '$lib/js/dialog.js'
    import Icon from '../Icon.svelte'

    const SOURCE_LABELS: Record<string, string> = {
        gamefaqs:   'GameFAQs',
        ign:        'IGN',
        steam:      'Steam',
        game8:      'Game8',
        gamerguides:'Gamer Guides',
        fandom:     'Fandom',
        neoseeker:  'Neoseeker',
        thegamer:   'TheGamer',
    }

    const active    = $derived(jobStore.jobs.filter(j => j.status === 'running' || j.status === 'pending'))
    const finished  = $derived(jobStore.jobs.filter(j => j.status === 'done' || j.status === 'error' || j.status === 'cancelled').slice().reverse())

    const tsActive   = $derived(trackerSuggestJobStore.jobs.filter(j => j.status === 'running' || j.status === 'pending'))
    const tsFinished = $derived(trackerSuggestJobStore.jobs.filter(j => j.status === 'done' || j.status === 'error' || j.status === 'cancelled').slice().reverse())

    onMount(() => {
        // Guide jobs keep their own visibility-gated stream (unchanged).
        // Tracker-suggest jobs are fed by the single app-wide shared monitor
        // (opened in +layout.svelte, fanned out via BroadcastChannel), so this
        // page just reads trackerSuggestJobStore — no per-page tracker stream.
        let guideEs: EventSource | null = null

        function openStreams() {
            if (!guideEs) {
                guideEs = new EventSource('/relay/api/guides/jobs/stream')
                guideEs.onmessage = (e) => {
                    try { jobStore.applyEvent(JSON.parse(e.data)) } catch { /* silent */ }
                }
            }
        }

        function closeStreams() {
            guideEs?.close(); guideEs = null
        }

        function onVisibility() { document.hidden ? closeStreams() : openStreams() }
        document.addEventListener('visibilitychange', onVisibility)

        if (!document.hidden) openStreams()

        return () => {
            document.removeEventListener('visibilitychange', onVisibility)
            closeStreams()
        }
    })

    function fmtTime(iso: string | null): string {
        if (!iso) return '—'
        return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    function elapsed(startedAt: string | null, completedAt: string | null): string {
        if (!startedAt) return ''
        const end = completedAt ? new Date(completedAt).getTime() : Date.now()
        const sec = Math.floor((end - new Date(startedAt).getTime()) / 1000)
        if (sec < 60) return `${sec}s`
        const m = Math.floor(sec / 60), s = sec % 60
        return `${m}m ${s}s`
    }

    function elapsedJob(job: Job): string { return elapsed(job.startedAt, job.completedAt) }
    function elapsedTs(job: TrackerSuggestJob): string { return elapsed(job.startedAt, job.completedAt) }

    let expandedLog = $state<string | null>(null)

    function fmtBytes(n: number | null): string {
        if (!n) return '—'
        if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
        return `${(n / (1024 * 1024)).toFixed(1)} MB`
    }

    const hasAnything = $derived(
        active.length > 0 || finished.length > 0 || tsActive.length > 0 || tsFinished.length > 0
    )
</script>

<div class="dl-page">
    <h1 class="dl-title">Downloads</h1>

    {#if !hasAnything}
        <p class="dl-empty">No downloads yet. Open a game's guide panel and press Download, or use <Icon name="wand-sparkles" tone="lilac" size={14} /> on a journal dashboard to suggest trackers.</p>
    {/if}

    <!-- ── Guide Downloads ──────────────────────────────────────────────────── -->

    {#if active.length > 0 || finished.length > 0}
        <h2 class="dl-category-title">Guide Downloads</h2>
    {/if}

    {#if active.length > 0}
        <section class="dl-section">
            <h3 class="dl-section-title">Active</h3>
            {#each active as job (job.id)}
                <div class="dl-card dl-card--{job.status}">
                    <div class="dl-card-header">
                        <span class="dl-game">{job.gameName || job.guideId}</span>
                        <span class="dl-source">{SOURCE_LABELS[job.source] ?? job.source}</span>
                        {#if job.mode === 'reparse'}
                            <span class="dl-mode">Re-parse</span>
                        {/if}
                        <span class="dl-status dl-status--{job.status}">{job.status === 'pending' ? 'Queued' : 'Running'}</span>
                        {#if job.status === 'pending'}
                            <button class="dl-cancel-btn" onclick={() => jobStore.cancel(job.id)}>Cancel</button>
                        {/if}
                    </div>
                    {#if job.status === 'running'}
                        <div class="dl-bars">
                            <!-- A reparse never fetches, so the Fetch bar would sit at a
                                 meaningless 100% — omit the row entirely. -->
                            {#if job.mode !== 'reparse'}
                                <div class="dl-bar-row">
                                    <span class="dl-bar-label">Fetch</span>
                                    <div class="dl-bar-track"><div class="dl-bar-fill" style="width:{job.progress.download}%"></div></div>
                                    <span class="dl-bar-pct">{job.progress.download}%</span>
                                </div>
                            {/if}
                            <div class="dl-bar-row">
                                <span class="dl-bar-label">Parse</span>
                                <div class="dl-bar-track"><div class="dl-bar-fill" style="width:{job.progress.pages}%"></div></div>
                                <span class="dl-bar-pct">{job.progress.pages}%</span>
                            </div>
                            <div class="dl-bar-row">
                                <span class="dl-bar-label">Index</span>
                                <div class="dl-bar-track"><div class="dl-bar-fill" style="width:{job.progress.subtask}%"></div></div>
                                <span class="dl-bar-pct">{job.progress.subtask}%</span>
                            </div>
                        </div>
                        {#if job.log.length}
                            <div class="dl-log-tail">{job.log[job.log.length - 1]}</div>
                        {/if}
                    {/if}
                </div>
            {/each}
        </section>
    {/if}

    {#if finished.length > 0}
        <section class="dl-section">
            <h3 class="dl-section-title">History</h3>
            <table class="dl-table">
                <thead>
                    <tr>
                        <th>Game</th>
                        <th>Source</th>
                        <th>Status</th>
                        <th>Started</th>
                        <th>Duration</th>
                        <th>Size</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    {#each finished as job (job.id)}
                        <tr class="dl-row dl-row--{job.status}">
                            <td class="dl-row-game" title={job.guideId}>{job.gameName || job.guideId}</td>
                            <td>{SOURCE_LABELS[job.source] ?? job.source}</td>
                            <td><span class="dl-status dl-status--{job.status}">{job.status}</span></td>
                            <td>{fmtTime(job.startedAt)}</td>
                            <td>{elapsedJob(job)}</td>
                            <td class="dl-row-size">{job.status === 'done' ? fmtBytes(job.sizeBytes) : '—'}</td>
                            <td class="dl-row-actions">
                                {#if job.status === 'done'}
                                    <a class="dl-open-link" href="/journal/{job.steamId}/guides/{job.source}/{job.guideId}">Open ›</a>
                                {:else if job.status === 'error'}
                                    <button class="dl-log-btn" onclick={() => expandedLog = expandedLog === job.id ? null : job.id}>
                                        {expandedLog === job.id ? 'Hide' : 'Log'}
                                    </button>
                                {/if}
                                <button class="dl-requeue-btn" title="Re-download" onclick={async () => {
                                    const active = jobStore.jobFor(job.steamId, job.source, job.guideId)
                                    if (active?.status === 'pending' || active?.status === 'running') return
                                    if (job.status === 'done') {
                                        const ok = await confirmDialog('Re-download guide', 'This will overwrite the saved guide. Continue?', 'Re-download')
                                        if (!ok) return
                                    }
                                    jobStore.enqueue({ steamId: job.steamId, source: job.source, guideId: job.guideId, url: job.url, gameName: job.gameName })
                                }}>↺</button>
                            </td>
                        </tr>
                        {#if expandedLog === job.id && job.log.length}
                            <tr class="dl-log-row">
                                <td colspan="7">
                                    <pre class="dl-log-pre">{job.log.join('\n')}</pre>
                                </td>
                            </tr>
                        {/if}
                    {/each}
                </tbody>
            </table>
        </section>
    {/if}

    <!-- ── AI Tracker Suggestions ──────────────────────────────────────────── -->

    {#if tsActive.length > 0 || tsFinished.length > 0}
        <h2 class="dl-category-title">AI Tracker Suggestions</h2>
    {/if}

    {#if tsActive.length > 0}
        <section class="dl-section">
            <h3 class="dl-section-title">Active</h3>
            {#each tsActive as job (job.id)}
                <div class="dl-card dl-card--{job.status}">
                    <div class="dl-card-header">
                        <span class="dl-game">{job.gameName}</span>
                        <span class="dl-source dl-source--ai">AI <Icon name="wand-sparkles" tone="lilac" size={13} /></span>
                        <span class="dl-status dl-status--{job.status}">{job.status === 'pending' ? 'Queued' : 'Running'}</span>
                        {#if job.status === 'pending'}
                            <button class="dl-cancel-btn" onclick={() => trackerSuggestJobStore.cancel(job.id)}>Cancel</button>
                        {/if}
                    </div>
                    {#if job.status === 'running'}
                        <div class="dl-bars">
                            <div class="dl-bar-row">
                                <span class="dl-bar-label">Research</span>
                                <div class="dl-bar-track"><div class="dl-bar-fill dl-bar-fill--ai" style="width:{job.progress}%"></div></div>
                                <span class="dl-bar-pct">{job.progress}%</span>
                            </div>
                        </div>
                        {#if job.log.length}
                            <div class="dl-log-tail">{job.log[job.log.length - 1]}</div>
                        {/if}
                    {/if}
                </div>
            {/each}
        </section>
    {/if}

    {#if tsFinished.length > 0}
        <section class="dl-section">
            <h3 class="dl-section-title">History</h3>
            <table class="dl-table">
                <thead>
                    <tr>
                        <th>Game</th>
                        <th>Trackers</th>
                        <th>Status</th>
                        <th>Started</th>
                        <th>Duration</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    {#each tsFinished as job (job.id)}
                        <tr class="dl-row dl-row--{job.status}">
                            <td class="dl-row-game">{job.gameName}</td>
                            <td class="dl-row-size">
                                {#if job.status === 'done'}
                                    {job.trackers?.length ?? 0} trackers
                                {:else}
                                    —
                                {/if}
                            </td>
                            <td><span class="dl-status dl-status--{job.status}">{job.status}</span></td>
                            <td>{fmtTime(job.startedAt)}</td>
                            <td>{elapsedTs(job)}</td>
                            <td class="dl-row-actions">
                                {#if job.status === 'done'}
                                    <a class="dl-open-link" href="/journal/{job.steamId}/progress">View Trackers ›</a>
                                {:else if job.status === 'error'}
                                    <button class="dl-log-btn" onclick={() => expandedLog = expandedLog === job.id ? null : job.id}>
                                        {expandedLog === job.id ? 'Hide' : 'Log'}
                                    </button>
                                {/if}
                            </td>
                        </tr>
                        {#if expandedLog === job.id}
                            <tr class="dl-log-row">
                                <td colspan="6">
                                    {#if job.error}
                                        <pre class="dl-log-pre">{job.error}</pre>
                                    {/if}
                                    {#if job.log.length}
                                        <pre class="dl-log-pre">{job.log.join('\n')}</pre>
                                    {/if}
                                </td>
                            </tr>
                        {/if}
                    {/each}
                </tbody>
            </table>
        </section>
    {/if}
</div>

<style>
.dl-page {
    padding: 2rem;
    max-width: 900px;
    margin: 0 auto;
}
.dl-title {
    font-size: 1.5rem;
    font-weight: 600;
    margin-bottom: 1.5rem;
    color: var(--text-primary, #e8e8e8);
}
.dl-empty {
    color: var(--text-muted, #888);
    font-size: 0.9rem;
    padding: 2rem 0;
}
.dl-category-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary, #e8e8e8);
    margin: 2rem 0 0.75rem;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid var(--border, #2a2a2a);
}
.dl-section { margin-bottom: 2rem; }
.dl-section-title {
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted, #888);
    margin: 0.75rem 0 0.6rem;
}

/* Active cards */
.dl-card {
    background: var(--surface-2, #1e1e1e);
    border: 1px solid var(--border, #2a2a2a);
    border-radius: 8px;
    padding: 1rem 1.25rem;
    margin-bottom: 0.75rem;
}
.dl-card--running { border-color: var(--accent, #4f8ef7); }
.dl-card-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
}
.dl-game {
    font-weight: 500;
    color: var(--text-primary, #e8e8e8);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.dl-source {
    font-size: 0.75rem;
    color: var(--text-muted, #888);
    background: var(--surface-3, #2a2a2a);
    padding: 2px 6px;
    border-radius: 3px;
}
.dl-source--ai {
    color: #c9a84c;
    background: rgba(201,168,76,0.12);
}
/* Marks a parse-only job (no fetch) so it isn't mistaken for a fresh download */
.dl-mode {
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 2px 7px;
    border-radius: 3px;
    color: #4ecdc4;
    background: rgba(78, 205, 196, 0.14);
}
.dl-status {
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 2px 7px;
    border-radius: 3px;
}
.dl-status--pending  { background: #2a2a2a; color: #888; }
.dl-status--running  { background: rgba(79,142,247,0.15); color: #4f8ef7; }
.dl-status--done     { background: rgba(80,200,100,0.15); color: #50c864; }
.dl-status--error    { background: rgba(220,80,80,0.15);  color: #dc5050; }
.dl-status--cancelled{ background: #2a2a2a; color: #666; }
.dl-cancel-btn {
    font-size: 0.72rem;
    background: none;
    border: 1px solid #444;
    color: #888;
    border-radius: 3px;
    padding: 2px 8px;
    cursor: pointer;
}
.dl-cancel-btn:hover { border-color: #dc5050; color: #dc5050; }

/* Progress bars */
.dl-bars { display: flex; flex-direction: column; gap: 0.4rem; }
.dl-bar-row { display: flex; align-items: center; gap: 0.5rem; }
.dl-bar-label {
    width: 3.5rem;
    font-size: 0.72rem;
    color: var(--text-muted, #888);
    flex-shrink: 0;
}
.dl-bar-track {
    flex: 1;
    height: 4px;
    background: var(--surface-3, #2a2a2a);
    border-radius: 2px;
    overflow: hidden;
}
.dl-bar-fill {
    height: 100%;
    background: var(--accent, #4f8ef7);
    border-radius: 2px;
    transition: width 0.3s ease;
}
.dl-bar-fill--ai { background: #c9a84c; }
.dl-bar-pct {
    width: 2.5rem;
    font-size: 0.72rem;
    color: var(--text-muted, #888);
    text-align: right;
    flex-shrink: 0;
}
.dl-log-tail {
    margin-top: 0.5rem;
    font-size: 0.7rem;
    color: var(--text-muted, #888);
    font-family: monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

/* History table */
.dl-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
}
.dl-table th {
    text-align: left;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-muted, #888);
    padding: 0.4rem 0.75rem;
    border-bottom: 1px solid var(--border, #2a2a2a);
}
.dl-table td {
    padding: 0.5rem 0.75rem;
    color: var(--text-primary, #e8e8e8);
    border-bottom: 1px solid var(--border, #1e1e1e);
    vertical-align: middle;
}
.dl-row-game {
    max-width: 280px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.dl-row-size {
    color: var(--text-muted, #888);
    font-size: 0.8rem;
    white-space: nowrap;
}
.dl-row-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    white-space: nowrap;
}
.dl-open-link {
    color: var(--accent, #4f8ef7);
    text-decoration: none;
    font-size: 0.8rem;
}
.dl-open-link:hover { text-decoration: underline; }
.dl-requeue-btn {
    font-size: 0.9rem;
    background: none;
    border: 1px solid #444;
    color: #888;
    border-radius: 3px;
    padding: 1px 6px;
    cursor: pointer;
    line-height: 1;
}
.dl-requeue-btn:hover { border-color: #888; color: #ccc; }
.dl-log-btn {
    font-size: 0.75rem;
    background: none;
    border: 1px solid #444;
    color: #888;
    border-radius: 3px;
    padding: 2px 8px;
    cursor: pointer;
}
.dl-log-btn:hover { border-color: #888; color: #ccc; }
.dl-log-row td { background: var(--surface-2, #1e1e1e); }
.dl-log-pre {
    font-size: 0.7rem;
    color: var(--text-muted, #888);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 200px;
    overflow-y: auto;
    margin: 0;
    padding: 0.5rem;
    background: var(--surface-3, #111);
    border-radius: 4px;
}
</style>
