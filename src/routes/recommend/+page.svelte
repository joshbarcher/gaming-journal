<script lang="ts">
    import { onMount } from 'svelte'
    import RecommendGraph from '$lib/svelte/recommend/RecommendGraph.svelte'
    import type { RecommendQuestion, RecommendGame } from '$lib/svelte/recommend/RecommendGraph.svelte'

    type Depth    = 'shallow' | 'normal' | 'deep'
    type PagePhase = 'start' | 'playing' | 'results'

    // ── State ─────────────────────────────────────────────────────────────────
    let depth     = $state<Depth>('normal')
    let isPhone   = $state(false)
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

    onMount(() => {
        const check = () => { isPhone = window.innerWidth <= 479 }
        check()
        window.addEventListener('resize', check)
        return () => window.removeEventListener('resize', check)
    })
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
            Recommendations
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
        {:else if isPhone}
            <!-- Mobile portrait: stacked layout -->
            <div class="rec-mobile-stack">
                {#if error}
                    <div class="rec-m-banner rec-m-banner--error">{error}</div>
                {/if}
                {#if relaxed}
                    <div class="rec-m-banner rec-m-banner--relaxed">One filter was loosened to find enough results.</div>
                {/if}
                {#if loading}
                    <div class="rec-m-loading">Thinking…</div>
                {:else if phase === 'playing' && question}
                    {#key stepIndex}
                        <div class="rec-m-question">
                            <span class="rec-m-q-type">{question.type}</span>
                            <p class="rec-m-q-label">{question.label}</p>
                        </div>
                        <div class="rec-m-options">
                            {#each question.options as opt, i}
                                <button
                                    class="rec-m-option"
                                    style="--i:{i}"
                                    onclick={() => handleChoice(question!.type, opt.value)}
                                >
                                    <span class="rec-m-opt-label">{opt.label}</span>
                                    {#if opt.count > 0}
                                        <span class="rec-m-opt-count">{opt.count}</span>
                                    {/if}
                                </button>
                            {/each}
                        </div>
                    {/key}
                {:else if phase === 'results' && games}
                    {#key games}
                        <p class="rec-m-result-hd">Here's what to play</p>
                        <div class="rec-m-results">
                            {#each games as game, i}
                                <a class="rec-m-game" href="/game/{game.appid}" style="--i:{i}">
                                    <img class="rec-m-game-img"
                                         src="/relay/images/steam/games/{game.appid}/header.jpg"
                                         alt=""
                                         onerror={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0' }}>
                                    <span class="rec-m-game-name">{game.name}</span>
                                </a>
                            {/each}
                        </div>
                    {/key}
                {/if}
            </div>
        {:else}
            <!-- Desktop/tablet: graph -->
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

    /* ── Mobile topbar compaction (≤479px) ───────────────────────────────────── */
    @media (max-width: 479px) {
        .recommend-topbar   { padding: 10px 16px; gap: 8px; }
        .recommend-title    { font-size: 14px; gap: 8px; }
        .recommend-title-icon { width: 16px; height: 16px; }
        .recommend-controls { gap: 8px; }
        .depth-btn          { padding: 5px 8px; font-size: 11px; }
        .depth-badge        { font-size: 11px; padding: 3px 8px; }
        .skip-btn, .reset-btn { padding: 5px 8px; font-size: 11px; }
        .skip-btn svg, .reset-btn svg { width: 12px; height: 12px; }

        .start-card { padding: 28px 20px; max-width: calc(100% - 32px); gap: 16px; }
        .start-icon { width: 36px; height: 36px; }
        .start-card h2 { font-size: 18px; }
        .depth-toggle--lg .depth-btn { padding: 10px 12px; }
    }

    /* ── Mobile stack layout ─────────────────────────────────────────────────── */
    @keyframes rec-m-enter {
        from { opacity: 0; transform: translateY(14px) scale(0.97); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    .rec-mobile-stack {
        position: absolute;
        inset: 0;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .rec-m-banner {
        padding: 10px 14px;
        border-radius: var(--radius);
        font-size: 13px;
        text-align: center;
    }
    .rec-m-banner--error {
        background: rgba(239,68,68,0.12);
        border: 1px solid rgba(239,68,68,0.25);
        color: #fca5a5;
    }
    .rec-m-banner--relaxed {
        background: var(--clr-accent-bg);
        border: 1px solid rgba(201,168,76,0.3);
        color: var(--clr-accent);
    }

    .rec-m-loading {
        padding: 32px 0;
        text-align: center;
        color: var(--clr-text-muted);
        font-size: 14px;
        animation: rec-m-enter 0.3s ease both;
    }

    .rec-m-question {
        background: var(--clr-bg-raised);
        border: 1px solid var(--clr-border);
        border-radius: 10px;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        animation: rec-m-enter 0.3s ease both;
    }
    .rec-m-q-type {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--clr-accent);
    }
    .rec-m-q-label {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        color: var(--clr-text);
        line-height: 1.3;
        font-family: var(--font-title);
    }

    .rec-m-options {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .rec-m-option {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 13px 16px;
        background: var(--clr-bg-raised);
        border: 1px solid var(--clr-border);
        border-radius: 8px;
        color: var(--clr-text);
        font-size: 14px;
        cursor: pointer;
        text-align: left;
        transition: border-color var(--transition), background var(--transition);
        animation: rec-m-enter 0.35s cubic-bezier(0.34, 1.4, 0.64, 1) both;
        animation-delay: calc(var(--i) * 65ms + 120ms);
    }
    .rec-m-option:hover {
        border-color: var(--clr-accent);
        background: color-mix(in srgb, var(--clr-accent) 8%, var(--clr-bg-raised));
    }
    .rec-m-opt-label { font-weight: 500; }
    .rec-m-opt-count {
        font-size: 12px;
        color: var(--clr-text-muted);
        flex-shrink: 0;
        font-variant-numeric: tabular-nums;
    }

    .rec-m-result-hd {
        margin: 0;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--clr-text-muted);
        animation: rec-m-enter 0.3s ease both;
    }
    .rec-m-results {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .rec-m-game {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        background: var(--clr-bg-raised);
        border: 1px solid var(--clr-border);
        border-radius: 8px;
        text-decoration: none;
        color: var(--clr-text);
        transition: border-color var(--transition), background var(--transition);
        animation: rec-m-enter 0.35s cubic-bezier(0.34, 1.4, 0.64, 1) both;
        animation-delay: calc(var(--i) * 65ms + 80ms);
    }
    .rec-m-game:hover {
        border-color: var(--clr-border-hi);
        background: var(--clr-bg-hover);
    }
    .rec-m-game-img {
        width: 72px;
        height: 34px;
        object-fit: cover;
        border-radius: 4px;
        flex-shrink: 0;
    }
    .rec-m-game-name {
        font-size: 13px;
        font-weight: 500;
        line-height: 1.3;
    }
</style>
