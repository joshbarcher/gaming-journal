<script>
    import { onMount } from 'svelte'
    import { loadGameFilter } from '../../js/views/game-filter.js'

    const ICO_MUTE   = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`
    const ICO_UNMUTE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`
    const ICO_FILTER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`

    let allEntries   = $state([])
    let loading      = $state(true)
    let error        = $state(null)
    let hideFiltered = $state(false)
    let updatedAt    = $state('')

    let filtered    = $derived(allEntries.filter(e => e.filtered))
    let displayRows = $derived.by(() => {
        const active   = allEntries.filter(e => !e.filtered)
        const inactive = allEntries.filter(e => e.filtered)
        let rank = 0
        return [
            ...active.map(e => ({ ...e, displayRank: ++rank })),
            ...(hideFiltered ? [] : inactive.map(e => ({ ...e, displayRank: '—' }))),
        ]
    })

    function fmt(n) {
        if (n == null || n === 0) return '—'
        if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
        if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
        return n.toLocaleString()
    }

    function sparkline(samples, peakAllTime = null) {
        if (!samples?.length) return '<svg class="tg-spark" aria-hidden="true"></svg>'
        const raw  = samples.map(s => s[1])
        const MAX  = 30
        const vals = raw.length <= MAX ? raw : Array.from(
            { length: MAX },
            (_, i) => raw[Math.round(i * (raw.length - 1) / (MAX - 1))]
        )
        const min   = Math.min(...vals)
        const max   = Math.max(...vals)
        const range = max - min
        const n     = vals.length
        const toY = v => range === 0 ? 50 : +(100 - ((v - min) / range * 100)).toFixed(2)
        const d = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${i} ${toY(v)}`).join(' ')
        return `<svg class="tg-spark" viewBox="0 0 ${Math.max(n - 1, 1)} 100" preserveAspectRatio="none" aria-hidden="true"><path fill="none" style="stroke:var(--clr-accent);opacity:0.8" stroke-width="2" vector-effect="non-scaling-stroke" d="${d}"/></svg>`
    }

    async function setFiltered(appid, isFiltered) {
        const method = isFiltered ? 'POST' : 'DELETE'
        const res = await fetch(`/relay/api/player-counts/filtered/${appid}`, { method })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const entry = allEntries.find(e => e.appid === appid)
        if (entry) entry.filtered = isFiltered
    }

    async function toggleMute(appid) {
        const entry = allEntries.find(e => e.appid === appid)
        if (!entry) return
        try {
            await setFiltered(appid, !entry.filtered)
        } catch (err) {
            console.error('[top-games] filter toggle failed', err)
        }
    }

    async function loadData() {
        try {
            const [res, shouldShow] = await Promise.all([
                fetch('/relay/api/player-counts/top?n=100&includeFiltered=true'),
                loadGameFilter(),
            ])
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            allEntries = (await res.json()).filter(e => shouldShow(e.appid))
            updatedAt  = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
            error      = null
        } catch (err) {
            error = err.message
        }
        loading = false
    }

    onMount(() => {
        loadData()
        const timer = setInterval(loadData, 30 * 60 * 1_000)
        return () => clearInterval(timer)
    })
</script>

{#if loading}
    <p class="page-loading">Loading top games…</p>
{:else if error}
    <p class="page-error">Failed to load: {error}</p>
{:else if allEntries.length === 0}
    <div class="page-header">
        <h1 class="page-title">Top Games</h1>
        <p class="page-subtitle">No data yet — trigger a collection first via <code>POST /relay/api/player-counts/collect</code></p>
    </div>
{:else}
    <div class="page-header">
        <div class="tg-page-top">
            <div>
                <h1 class="page-title tg-title">Top Games by Players</h1>
                <p class="page-subtitle">Live Steam data · updated {updatedAt} · refreshes every 30 min</p>
            </div>
            {#if filtered.length > 0}
                <button class="tg-filter-btn" class:tg-filter-btn--active={hideFiltered && filtered.length > 0}
                        title={hideFiltered ? `Show hidden games (${filtered.length})` : 'Hide filtered games'}
                        onclick={() => hideFiltered = !hideFiltered}>
                    {@html ICO_FILTER}
                    <span class="tg-filter-count">{filtered.length}</span>
                </button>
            {/if}
        </div>
    </div>

    <div class="tg-table">
        <div class="tg-header">
            <span class="tg-rank">#</span>
            <span class="tg-thumb-ph"></span>
            <span class="tg-name">Game</span>
            <span class="tg-stat">Now</span>
            <span class="tg-stat tg-stat--muted">24h Peak</span>
            <span class="tg-stat tg-stat--muted">7d Peak</span>
            <span class="tg-stat tg-stat--muted">All-Time</span>
            <span class="tg-spark-cell">24h Trend</span>
        </div>
        <div>
            {#each displayRows as entry (entry.appid)}
                {@const name = entry.name ?? `App ${entry.appid}`}
                <div class="tg-row-wrap" class:tg-row-wrap--muted={entry.filtered} data-appid={entry.appid}>
                    <a class="tg-row" href="/game/{entry.appid}">
                        <span class="tg-rank">{entry.displayRank}</span>
                        <img class="tg-thumb" src="/relay/images/steam/games/{entry.appid}/header.jpg"
                             alt="" loading="lazy"
                             onerror={(e) => { e.currentTarget.style.opacity = '0' }}>
                        <span class="tg-name">
                            {name}
                            {#if entry.owned}<span class="tg-badge tg-badge--owned">Owned</span>{/if}
                            {#if entry.wishlisted}<span class="tg-badge tg-badge--wish">Wishlisted</span>{/if}
                        </span>
                        <span class="tg-stat">{fmt(entry.latest)}</span>
                        <span class="tg-stat tg-stat--muted">{fmt(entry.peak24h)}</span>
                        <span class="tg-stat tg-stat--muted">{fmt(entry.peak7d)}</span>
                        <span class="tg-stat tg-stat--muted">{fmt(entry.peakAllTime)}</span>
                        <span class="tg-spark-cell">{@html sparkline(entry.samples24h, entry.peakAllTime)}</span>
                    </a>
                    <button class="tg-mute-btn" title="{entry.filtered ? 'Restore' : 'Hide'} {name}"
                            onclick={() => toggleMute(entry.appid)}>
                        {@html entry.filtered ? ICO_UNMUTE : ICO_MUTE}
                    </button>
                </div>
            {/each}
        </div>
    </div>
{/if}
