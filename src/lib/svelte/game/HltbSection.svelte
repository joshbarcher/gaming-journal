<script lang="ts">
    import { onMount, onDestroy } from 'svelte'
    import type { SteamGame } from '../../types.js'
    import { fmtHours, releaseStatus } from '../../js/views/game-render.js'

    interface Props {
        game:      SteamGame | null
        hltb:      SteamGame['hltb'] | null | undefined
        onRefresh: () => Promise<void>
    }
    let { game, hltb, onRefresh }: Props = $props()

    let timer: ReturnType<typeof setInterval> | null = null
    let sessionElapsedMins = $state(0)
    let renderTime = Date.now()
    let basePlaytimeMin = $derived(game?.playtimeMinutes ?? 0)

    let inView = $state(false)
    let barWrapEl = $state<HTMLElement | null>(null)

    $effect(() => {
        if (!barWrapEl || inView) return
        const obs = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                requestAnimationFrame(() => { inView = true })
                obs.disconnect()
            }
        }, { threshold: 0.1 })
        obs.observe(barWrapEl)
        return () => obs.disconnect()
    })

    // Check if this game is currently being played and start ticking
    onMount(async () => {
        if (!hltb?.matched) return
        try {
            const np = await fetch('/relay/api/steam/now-playing').then(r => r.ok ? r.json() : null)
            const session = np?.playing?.appid === Number(game?.appid) ? np.playing : null
            if (!session) return
            renderTime = Date.now()
            const tick = () => {
                sessionElapsedMins = Math.floor((Date.now() - renderTime) / 60_000)
            }
            tick()
            timer = setInterval(tick, 30_000)
        } catch { /* best-effort */ }
    })

    onDestroy(() => {
        if (timer) clearInterval(timer)
    })

    let status     = $derived(game ? releaseStatus(game) : 'unknown')
    let playerHours = $derived((basePlaytimeMin + sessionElapsedMins) / 60)

    let milestones = $derived(
        hltb?.matched ? [
            { label: 'Main',          h: hltb.gameplayMain          },
            { label: 'Main + Extras', h: hltb.gameplayMainExtra     },
            { label: 'Completionist', h: hltb.gameplayCompletionist },
        ].filter((m): m is { label: string; h: number } => m.h != null && m.h > 0) : []
    )

    let maxScale = $derived(
        milestones.length
            ? Math.max(...milestones.map(m => m.h), ...(playerHours > 0 ? [playerHours] : [])) * 1.08
            : 1
    )

    const pct = (h: number) => (Math.sqrt(h) / Math.sqrt(maxScale)) * 100

    const SHORT_LABELS = ['MAIN', 'EXTRAS', 'COMPLETE']

    let segments = $derived(
        milestones.map((m, i) => {
            const leftPct = i === 0 ? 0 : pct(milestones[i - 1].h)
            const isLast = i === milestones.length - 1
            return {
                shortLabel: SHORT_LABELS[i] ?? m.label.toUpperCase(),
                h: m.h,
                leftPct,
                widthPct: (isLast ? 100 : pct(m.h)) - leftPct,
            }
        })
    )

    let refreshing = $state(false)

    async function refresh() {
        if (refreshing) return
        refreshing = true
        try { await onRefresh?.() }
        finally { refreshing = false }
    }
</script>

{#if status !== 'coming_soon'}
    <section class="game-section" id="game-sec-hltb">
        <h2 class="game-section-title">
            How Long To Beat
            <button class="game-refresh-btn" class:game-refresh-btn--spinning={refreshing} disabled={refreshing} onclick={refresh} title="Refresh HLTB data">↻</button>
        </h2>

        {#if !milestones.length}
            <p class="game-section-empty">No data available for this game.</p>
        {:else}
            {@const fillPct = playerHours > 0 ? pct(playerHours) : 0}
            <div class="hltb-bar-wrap" class:hltb--inview={inView} bind:this={barWrapEl}>
                {#if playerHours > 0}
                    <div class="hltb-pin" style="left:{pct(playerHours).toFixed(2)}%">
                        {fmtHours(playerHours)} played
                    </div>
                {/if}
                <div class="hltb-track">
                    <div class="hltb-fill" style="width:{inView ? fillPct.toFixed(2) : '0'}%"></div>
                    {#each segments as seg, i}
                        {#if i > 0}
                            <div class="hltb-seg-divider" style="left:{seg.leftPct.toFixed(2)}%"></div>
                        {/if}
                        <div class="hltb-segment" style="left:{seg.leftPct.toFixed(2)}%; width:{seg.widthPct.toFixed(2)}%">
                            <span class="hltb-seg-label">{seg.shortLabel}</span>
                            <span class="hltb-seg-hours">{fmtHours(seg.h)}</span>
                        </div>
                    {/each}
                </div>
            </div>

            <div class="hltb-mini">
                {#each milestones as m}
                    {@const miniPct = playerHours > 0 ? Math.min(100, (playerHours / m.h) * 100) : 0}
                    <div class="hltb-mini-row">
                        <span class="hltb-mini-label">{m.label}</span>
                        <div class="hltb-mini-track">
                            <div class="hltb-mini-fill" class:hltb-mini-fill--done={playerHours >= m.h} style="width:{miniPct.toFixed(1)}%"></div>
                        </div>
                        <span class="hltb-mini-value">{fmtHours(m.h)}</span>
                    </div>
                {/each}
                {#if playerHours > 0}
                    <p class="hltb-mini-played">{fmtHours(playerHours)} played</p>
                {/if}
            </div>
        {/if}
    </section>
{/if}
