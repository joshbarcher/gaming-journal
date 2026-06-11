<script>
    import { onMount, onDestroy } from 'svelte'
    import { fmtPlayerCount } from '../../js/views/game-render.js'

    let { data } = $props()

    const GRANULARITIES = [
        { key: '24h', label: '24h',  windowMs: 24 * 60 * 60 * 1_000,       bucketMs: 30 * 60 * 1_000 },
        { key: '7d',  label: '7d',   windowMs: 7  * 24 * 60 * 60 * 1_000,  bucketMs: 2  * 60 * 60 * 1_000 },
        { key: '30d', label: '30d',  windowMs: 30 * 24 * 60 * 60 * 1_000,  bucketMs: 6  * 60 * 60 * 1_000 },
        { key: '1y',  label: '1y',   windowMs: 365 * 24 * 60 * 60 * 1_000, bucketMs: 24 * 60 * 60 * 1_000 },
    ]

    let activeKey = $state('7d')
    let canvasEl  = $state(null)
    let chart     = null

    const latest = $derived(data?.samples?.[data.samples.length - 1]?.[1] ?? 0)

    function downsample(samples, windowMs, bucketMs) {
        const cutoff  = Date.now() - windowMs
        const buckets = new Map()
        for (const [tSec, n] of samples) {
            const tMs = tSec * 1000
            if (tMs < cutoff) continue
            const bucket = Math.floor(tMs / bucketMs) * bucketMs
            buckets.set(bucket, n)
        }
        return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, n]) => ({ x: t, y: n }))
    }

    function fmtLabel(tMs, key) {
        const d = new Date(tMs)
        if (key === '24h') return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
        if (key === '7d')  return d.toLocaleDateString(undefined, { weekday: 'short', hour: '2-digit' })
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    }

    function buildDataset(key) {
        const g = GRANULARITIES.find(x => x.key === key)
        return downsample(data.samples, g.windowMs, g.bucketMs)
    }

    function updateChart(key) {
        if (!chart) return
        const pts = buildDataset(key)
        chart.data.labels             = pts.map(p => fmtLabel(p.x, key))
        chart.data.datasets[0].data   = pts.map(p => p.y)
        chart.update()
    }

    onMount(() => {
        if (!data?.samples?.length || typeof Chart === 'undefined' || !canvasEl) return

        const accent = getComputedStyle(document.documentElement).getPropertyValue('--clr-accent').trim() || '#7c6ff7'
        const pts    = buildDataset(activeKey)

        chart = new Chart(canvasEl, {
            type: 'line',
            data: {
                labels:   pts.map(p => fmtLabel(p.x, activeKey)),
                datasets: [{ data: pts.map(p => p.y), borderColor: accent, borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 4, tension: 0.3, fill: true, backgroundColor: `${accent}1a` }],
            },
            options: {
                responsive: true, maintainAspectRatio: false, animation: { duration: 200 },
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${fmtPlayerCount(ctx.parsed.y)} players` } } },
                scales: {
                    x: { ticks: { color: 'rgba(255,255,255,0.35)', font: { size: 10 }, maxTicksLimit: 8, maxRotation: 0 }, grid: { color: 'rgba(255,255,255,0.06)' } },
                    y: { ticks: { color: 'rgba(255,255,255,0.35)', font: { size: 10 }, callback: v => fmtPlayerCount(v) }, grid: { color: 'rgba(255,255,255,0.06)' }, beginAtZero: false },
                },
            },
        })
    })

    onDestroy(() => { chart?.destroy(); chart = null })

    function selectTab(key) {
        activeKey = key
        updateChart(key)
    }
</script>

<section class="game-section" id="game-sec-player-count">
    <h2 class="game-section-title">Player Count</h2>
    {#if !data?.samples?.length}
        <p class="game-section-empty">No player count data collected yet.</p>
    {:else}
        <div class="pc-header">
            <span class="pc-current">{fmtPlayerCount(latest)} <span class="pc-current-label">playing now</span></span>
            <div class="pc-tabs">
                {#each GRANULARITIES as g}
                    <button class="pc-tab" class:pc-tab--active={activeKey === g.key} onclick={() => selectTab(g.key)}>
                        {g.label}
                    </button>
                {/each}
            </div>
        </div>
        <div class="pc-chart-wrap">
            <canvas bind:this={canvasEl}></canvas>
        </div>
    {/if}
</section>
