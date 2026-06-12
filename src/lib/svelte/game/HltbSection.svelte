<script>
    import { onMount, onDestroy } from 'svelte'
    import { fmtHours, releaseStatus } from '../../js/views/game-render.js'

    let { game, hltb, onRefresh } = $props()

    let timer = null
    let sessionElapsedMins = $state(0)
    let renderTime = Date.now()
    let basePlaytimeMin = $derived(game?.playtimeMinutes ?? 0)

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

    let status     = $derived(releaseStatus(game))
    let playerHours = $derived((basePlaytimeMin + sessionElapsedMins) / 60)

    let milestones = $derived(
        hltb?.matched ? [
            { label: 'Main',          h: hltb.gameplayMain          },
            { label: 'Main + Extras', h: hltb.gameplayMainExtra     },
            { label: 'Completionist', h: hltb.gameplayCompletionist },
        ].filter(m => m.h != null && m.h > 0) : []
    )

    let maxScale = $derived(
        milestones.length
            ? Math.max(...[...milestones.map(m => m.h), playerHours > 0 ? playerHours : null].filter(Boolean)) * 1.08
            : 1
    )

    const pct = (h) => (Math.sqrt(h) / Math.sqrt(maxScale)) * 100

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
            {@const fillPct = playerHours > 0 ? pct(playerHours) : pct(milestones[0].h)}
            <div class="hltb-bar-wrap">
                <div class="hltb-labels-row">
                    {#each milestones as m}
                        <span class="hltb-lbl" style="left:{pct(m.h).toFixed(2)}%">{m.label}</span>
                    {/each}
                </div>
                <div class="hltb-track-wrap">
                    <div class="hltb-track">
                        <div class="hltb-fill" style="width:{fillPct.toFixed(2)}%"></div>
                    </div>
                    {#each milestones as m}
                        <div class="hltb-tick" style="left:{pct(m.h).toFixed(2)}%"></div>
                    {/each}
                    {#if playerHours > 0}
                        <div class="hltb-pin" style="left:{pct(playerHours).toFixed(2)}%" data-label="{fmtHours(playerHours)} played"></div>
                    {/if}
                </div>
                <div class="hltb-hours-row">
                    {#each milestones as m}
                        <span class="hltb-hr" style="left:{pct(m.h).toFixed(2)}%">{fmtHours(m.h)}</span>
                    {/each}
                </div>
            </div>
        {/if}
    </section>
{/if}
