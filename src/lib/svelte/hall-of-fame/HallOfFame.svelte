<script lang="ts">
    import { onMount } from 'svelte'
    import type { SteamGame } from '../../types.js'

    const TIERS = [
        { key: 'legend',    minH: 100, symbol: '◆', label: 'Legend',    sublabel: '100h+', cls: 'hof-tier--legend',    featured: true  },
        { key: 'veteran',   minH: 50,  symbol: '▲', label: 'Veteran',   sublabel: '50h+',  cls: 'hof-tier--veteran',   featured: false },
        { key: 'completed', minH: 20,  symbol: '●', label: 'Completed', sublabel: '20h+',  cls: 'hof-tier--completed', featured: false },
        { key: 'finished',  minH: 0,   symbol: '○', label: 'Finished',  sublabel: '<20h',  cls: 'hof-tier--finished',  featured: false },
    ]

    let games   = $state<SteamGame[]>([])
    let loading = $state(true)
    let error   = $state<string | null>(null)

    let totalMin = $derived(games.reduce((s, g) => s + (g.playtime ?? 0), 0))
    let subtitle = $derived(`${games.length} game${games.length !== 1 ? 's' : ''} conquered · ${fmtHours(totalMin)} total`)
    let grouped  = $derived.by(() => {
        const map = new Map<string, SteamGame[]>(TIERS.map(t => [t.key, []]))
        for (const g of games) map.get(tierFor(g.playtime ?? 0).key)!.push(g)
        return map
    })

    function fmtHours(mins: number | null | undefined) {
        if (!mins) return null
        const h = mins / 60
        if (h < 1)  return `${Math.round(mins)}m`
        if (h < 10) return `${h.toFixed(1)}h`
        return `${Math.round(h)}h`
    }

    function tierFor(playtimeMin: number) {
        const h = playtimeMin / 60
        return TIERS.find(t => h >= t.minH) ?? TIERS[TIERS.length - 1]
    }

    onMount(async () => {
        try {
            const [flagsRes, gamesRes] = await Promise.all([
                fetch('/api/flags'),
                fetch('/relay/api/steam/games'),
            ])
            if (!flagsRes.ok) throw new Error(`Flags HTTP ${flagsRes.status}`)
            if (!gamesRes.ok) throw new Error(`Games HTTP ${gamesRes.status}`)

            const flags    = await flagsRes.json()
            const gamesRaw = await gamesRes.json()
            const owned    = Array.isArray(gamesRaw) ? gamesRaw : (gamesRaw.games ?? [])
            const ownedMap = new Map<number, SteamGame>(owned.map((g: SteamGame) => [g.appid, g]))
            const ids      = Object.entries(flags as Record<string, any>).filter(([, f]) => f.completed).map(([id]) => Number(id))

            if (!ids.length) { loading = false; return }

            const results = await Promise.all(ids.map(async appid => {
                const o      = ownedMap.get(appid)
                let name     = o?.name ?? null
                let playtime = o?.playtime_forever ?? 0
                if (!name) {
                    try { const r = await fetch(`/relay/api/games/${appid}`); if (r.ok) { const d = await r.json(); name = d?.name ?? null } } catch {}
                }
                return { appid, name: name ?? `App ${appid}`, playtime }
            }))

            games = results.sort((a, b) => b.playtime - a.playtime)
        } catch (err) {
            error = (err as Error).message
        } finally {
            loading = false
        }
    })
</script>

{#if loading}
    <p class="page-loading">Loading Completed…</p>
{:else if error}
    <p class="page-error">Failed to load: {error}</p>
{:else}
    <div class="hof-header">
        <div class="hof-header-body">
            <p class="hof-eyebrow">Collection</p>
            <h1 class="hof-title">Completed</h1>
            {#if games.length}<p class="hof-subtitle">{subtitle}</p>{/if}
        </div>
    </div>
    {#if !games.length}
        <p class="page-empty" style="padding:40px">
            No completed games yet. Open any game page and toggle the
            <strong>Completed</strong> flag to enshrine it here.
        </p>
    {:else}
        {#each TIERS as tier}
            {@const tierGames = grouped.get(tier.key) ?? []}
            {#if tierGames.length}
                <div class="hof-section">
                    <div class="hof-section-heading">
                        <span class="hof-section-symbol {tier.cls}">{tier.symbol}</span>
                        <span class="hof-section-name {tier.cls}">{tier.label}</span>
                        <span class="hof-section-meta">{tier.sublabel} · {tierGames.length} game{tierGames.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div class="{tier.featured ? 'hof-featured-grid' : 'hof-grid'}">
                        {#each tierGames as g (g.appid)}
                            {@const hours = fmtHours(g.playtime)}
                            <a class="hof-card{tier.featured ? ' hof-card--featured' : ''}"
                               href="/game/{g.appid}" data-appid={g.appid}>
                                <div class="hof-card-img-wrap">
                                    <img class="hof-card-img"
                                         src="/relay/images/steam/games/{g.appid}/header.jpg"
                                         alt="" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0' }}>
                                    <div class="hof-card-shine"></div>
                                    <div class="hof-card-overlay"></div>
                                    <span class="hof-card-tier {tier.cls}" title="{tier.label}">{tier.symbol}</span>
                                    {#if hours}<span class="hof-card-hours">{hours}</span>{/if}
                                </div>
                                <div class="hof-card-body">
                                    <span class="hof-card-name">{g.name}</span>
                                    <span class="hof-card-label {tier.cls}">{tier.label}</span>
                                </div>
                            </a>
                        {/each}
                    </div>
                </div>
            {/if}
        {/each}
    {/if}
{/if}
