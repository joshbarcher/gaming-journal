<script lang="ts">
    import RecommendGraph from '$lib/svelte/recommend/RecommendGraph.svelte'
    import type { RecommendQuestion, RecommendGame } from '$lib/svelte/recommend/RecommendGraph.svelte'

    type Depth    = 'shallow' | 'normal' | 'deep'
    type PagePhase = 'start' | 'playing' | 'results'

    // ── State ─────────────────────────────────────────────────────────────────
    let depth     = $state<Depth>('normal')
    let phase     = $state<PagePhase>('start')
    let loading   = $state(false)
    let error     = $state<string | null>(null)

    let sequence  = $state<string[] | null>(null)
    let filters   = $state<{ type: string; value: string | null }[]>([])
    let question  = $state<RecommendQuestion | null>(null)
    let games     = $state<RecommendGame[] | null>(null)
    let relaxed   = $state(false)
    let stepIndex = $state(0)

    const DEPTH_LABELS: Record<Depth, string> = {
        shallow: 'Shallow  · 3 questions',
        normal:  'Normal   · 5 questions',
        deep:    'Deep     · 7 questions',
    }

    // ── API ───────────────────────────────────────────────────────────────────
    async function callRecommend(appliedFilters: { type: string; value: string | null }[]) {
        loading = true
        error   = null
        try {
            const res  = await fetch('/relay/api/recommend', {
                method:  'POST',
                headers: { 'content-type': 'application/json' },
                body:    JSON.stringify({ depth, sequence: sequence ?? undefined, filters: appliedFilters }),
            })
            if (!res.ok) throw new Error(`Server error ${res.status}`)
            const data = await res.json()

            if (sequence === null && data.sequence) sequence = data.sequence

            if (data.done) {
                games    = data.games
                question = null
                relaxed  = data.relaxed ?? false
                phase    = 'results'
            } else {
                question = data.question
                games    = null
                phase    = 'playing'
            }
        } catch (e) {
            error = e instanceof Error ? e.message : 'Something went wrong'
        } finally {
            loading = false
        }
    }

    // ── Controls ──────────────────────────────────────────────────────────────
    async function start() {
        reset(false)
        await callRecommend([])
    }

    function reset(returnToStart = true) {
        sequence  = null
        filters   = []
        question  = null
        games     = null
        relaxed   = false
        stepIndex = 0
        error     = null
        if (returnToStart) phase = 'start'
    }

    async function handleChoice(type: string, value: string) {
        const next = [...filters, { type, value }]
        filters   = next
        stepIndex = next.length
        await callRecommend(next)
    }

    async function handleSkip() {
        if (!question) return
        const next = [...filters, { type: question.type, value: null }]
        filters   = next
        stepIndex = next.length
        await callRecommend(next)
    }
</script>

<div class="recommend-page">
    <!-- ── Top bar ─────────────────────────────────────────────────────────── -->
    <div class="recommend-topbar">
        <div class="recommend-title">
            <span class="recommend-title-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
                </svg>
            </span>
            What should I play?
        </div>

        <div class="recommend-controls">
            <!-- Depth toggle — only changeable before starting -->
            {#if phase === 'start'}
                <div class="depth-toggle">
                    {#each (['shallow', 'normal', 'deep'] as Depth[]) as d}
                        <button
                            class="depth-btn"
                            class:active={depth === d}
                            onclick={() => depth = d}
                        >{d}</button>
                    {/each}
                </div>
            {:else}
                <span class="depth-badge">{depth}</span>
            {/if}

            {#if phase === 'playing' && question}
                <button class="skip-btn" onclick={handleSkip}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="13 17 18 12 13 7"/>
                        <polyline points="6 17 11 12 6 7"/>
                    </svg>
                    Skip
                </button>
            {/if}
            {#if phase !== 'start'}
                <button class="reset-btn" onclick={() => reset(true)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                        <path d="M3 3v5h5"/>
                    </svg>
                    Reset
                </button>
            {/if}
        </div>
    </div>

    <!-- ── Progress bar ───────────────────────────────────────────────────── -->
    {#if phase === 'playing' && sequence}
        <div class="progress-track">
            {#each sequence as _, i}
                <div class="progress-pip" class:done={i < stepIndex} class:active={i === stepIndex}></div>
            {/each}
        </div>
    {/if}

    <!-- ── Canvas area ────────────────────────────────────────────────────── -->
    <div class="recommend-canvas">
        {#if phase === 'start'}
            <!-- Start screen -->
            <div class="start-screen">
                <div class="start-card">
                    <div class="start-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"/>
                            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
                        </svg>
                    </div>
                    <h2>Find your next game</h2>
                    <p>Answer a few questions and we'll pull something from your library.</p>

                    <div class="depth-toggle depth-toggle--lg">
                        {#each (['shallow', 'normal', 'deep'] as Depth[]) as d}
                            <button
                                class="depth-btn"
                                class:active={depth === d}
                                onclick={() => depth = d}
                            >
                                <span class="depth-key">{d}</span>
                                <span class="depth-desc">
                                    {d === 'shallow' ? '3 questions' : d === 'normal' ? '5 questions' : '7 questions'}
                                </span>
                            </button>
                        {/each}
                    </div>

                    <button class="start-btn" onclick={start}>Start exploring</button>
                </div>
            </div>
        {:else}
            <!-- Graph -->
            {#if error}
                <div class="error-banner">{error}</div>
            {/if}

            {#if relaxed}
                <div class="relaxed-banner">One filter was loosened to find enough results.</div>
            {/if}

            <RecommendGraph
                {question}
                {games}
                {loading}
                {stepIndex}
                onChoice={handleChoice}
            />
        {/if}
    </div>
</div>

<style>
    .recommend-page {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--clr-bg);
        color: var(--clr-text);
        overflow: hidden;
    }

    /* ── Top bar ────────────────────────────────────────────────────────────── */
    .recommend-topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 24px 10px;
        border-bottom: 1px solid var(--clr-border);
        flex-shrink: 0;
        gap: 16px;
    }
    .recommend-title {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 16px;
        font-weight: 600;
        color: var(--clr-text);
        letter-spacing: -0.01em;
    }
    .recommend-title-icon {
        width: 20px;
        height: 20px;
        color: var(--clr-accent);
        display: flex;
    }
    .recommend-title-icon svg { width: 100%; height: 100%; }

    .recommend-controls {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    /* ── Depth toggle ────────────────────────────────────────────────────────── */
    .depth-toggle {
        display: flex;
        border: 1px solid var(--clr-border);
        border-radius: var(--radius);
        overflow: hidden;
    }
    .depth-btn {
        padding: 6px 14px;
        background: transparent;
        border: none;
        color: var(--clr-text-muted);
        font-size: 13px;
        cursor: pointer;
        transition: background var(--transition), color var(--transition);
        border-right: 1px solid var(--clr-border);
        text-transform: capitalize;
    }
    .depth-btn:last-child { border-right: none; }
    .depth-btn:hover { background: var(--clr-bg-hover); color: var(--clr-text); }
    .depth-btn.active {
        background: var(--clr-bg-raised);
        color: var(--clr-accent);
        font-weight: 600;
    }

    .depth-badge {
        font-size: 12px;
        color: var(--clr-text-muted);
        text-transform: capitalize;
        padding: 4px 10px;
        border: 1px solid var(--clr-border);
        border-radius: var(--radius);
    }

    /* ── Skip button ─────────────────────────────────────────────────────────── */
    .skip-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 14px;
        background: transparent;
        border: 1px solid var(--clr-border);
        border-radius: var(--radius);
        color: var(--clr-text-muted);
        font-size: 13px;
        cursor: pointer;
        transition: border-color var(--transition), color var(--transition);
    }
    .skip-btn svg { width: 14px; height: 14px; }
    .skip-btn:hover {
        border-color: var(--clr-border-hi);
        color: var(--clr-text);
    }

    /* ── Reset button ────────────────────────────────────────────────────────── */
    .reset-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 14px;
        background: transparent;
        border: 1px solid var(--clr-border);
        border-radius: var(--radius);
        color: var(--clr-text-muted);
        font-size: 13px;
        cursor: pointer;
        transition: border-color var(--transition), color var(--transition), background var(--transition);
    }
    .reset-btn svg { width: 14px; height: 14px; }
    .reset-btn:hover {
        border-color: var(--clr-accent);
        color: var(--clr-accent);
        background: var(--clr-accent-bg);
    }

    /* ── Progress pips ───────────────────────────────────────────────────────── */
    .progress-track {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 8px 0 4px;
        flex-shrink: 0;
    }
    .progress-pip {
        width: 28px;
        height: 3px;
        border-radius: 2px;
        background: var(--clr-border);
        transition: background 0.3s;
    }
    .progress-pip.done   { background: rgba(201,168,76,0.45); }
    .progress-pip.active { background: var(--clr-accent); }

    /* ── Canvas ───────────────────────────────────────────────────────────────── */
    .recommend-canvas {
        flex: 1;
        position: relative;
        overflow: hidden;
    }

    /* ── Start screen ─────────────────────────────────────────────────────────── */
    .start-screen {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
    }
    .start-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 20px;
        padding: 48px 52px;
        background: var(--clr-bg-raised);
        border: 1px solid var(--clr-border);
        border-radius: 12px;
        max-width: 420px;
        text-align: center;
    }
    .start-icon {
        width: 52px;
        height: 52px;
        color: var(--clr-accent);
    }
    .start-icon svg { width: 100%; height: 100%; }
    .start-card h2 {
        margin: 0;
        font-size: 22px;
        font-weight: 700;
        color: var(--clr-text);
        letter-spacing: -0.02em;
        font-family: var(--font-title);
    }
    .start-card p {
        margin: 0;
        font-size: 14px;
        color: var(--clr-text-muted);
        line-height: 1.6;
    }

    .depth-toggle--lg .depth-btn {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 12px 20px;
        gap: 3px;
    }
    .depth-key {
        font-size: 13px;
        font-weight: 600;
        text-transform: capitalize;
    }
    .depth-desc {
        font-size: 11px;
        color: var(--clr-text-muted);
    }
    .depth-btn.active .depth-desc { color: var(--clr-accent); }

    .start-btn {
        padding: 12px 32px;
        background: var(--clr-accent);
        border: none;
        border-radius: var(--radius);
        color: #131210;
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
        transition: opacity var(--transition), transform var(--transition);
        letter-spacing: 0.01em;
    }
    .start-btn:hover { opacity: 0.88; transform: translateY(-1px); }

    /* ── Banners ──────────────────────────────────────────────────────────────── */
    .error-banner, .relaxed-banner {
        position: absolute;
        bottom: 16px;
        left: 50%;
        transform: translateX(-50%);
        padding: 8px 20px;
        border-radius: var(--radius);
        font-size: 13px;
        z-index: 10;
        white-space: nowrap;
    }
    .error-banner {
        background: rgba(239,68,68,0.12);
        border: 1px solid rgba(239,68,68,0.25);
        color: #fca5a5;
    }
    .relaxed-banner {
        background: var(--clr-accent-bg);
        border: 1px solid rgba(201,168,76,0.3);
        color: var(--clr-accent);
    }
</style>
