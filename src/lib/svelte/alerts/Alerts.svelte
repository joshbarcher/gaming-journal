<script lang="ts">
    import { onMount } from 'svelte'
    import type { BestPrice, ItadHistoricalLow } from '../../types.js'

    interface AlertGame {
        appid:        number
        name:         string
        isLibrary:    boolean
        priceLoaded:  boolean
        bestPrice:    BestPrice | null
        historicalLow: ItadHistoricalLow | null
    }

    let allGames = $state<AlertGame[]>([])
    let loading  = $state(true)
    let error    = $state<string | null>(null)

    let nonLib  = $derived(allGames.filter(g => !g.isLibrary))
    let onSale  = $derived(
        nonLib
            .filter(g => g.priceLoaded && (g.bestPrice?.cut ?? 0) > 0)
            .sort((a, b) => (b.bestPrice?.cut ?? 0) - (a.bestPrice?.cut ?? 0))
    )
    let watching        = $derived(nonLib.filter(g => !g.priceLoaded || (g.bestPrice?.cut ?? 0) === 0))
    let allPricesLoaded = $derived(nonLib.length > 0 && nonLib.every(g => g.priceLoaded))

    onMount(async () => {
        try {
            const flagsRes = await fetch('/api/flags')
            if (!flagsRes.ok) throw new Error(`HTTP ${flagsRes.status}`)
            const flags = await flagsRes.json()

            const alertAppids = Object.entries(flags as Record<string, any>)
                .filter(([, f]) => f.alert)
                .map(([id]) => Number(id))

            if (!alertAppids.length) { loading = false; return }

            // Fetch game names in parallel — relay cache hits, fast
            const games = await Promise.all(alertAppids.map(async appid => {
                try {
                    const r = await fetch(`/relay/api/games/${appid}`)
                    const d = r.ok ? await r.json() : null
                    return {
                        appid,
                        name:         d?.name ?? `App ${appid}`,
                        isLibrary:    d?.source === 'library' || d?.source === 'both',
                        priceLoaded:  false,
                        bestPrice:    null,
                        historicalLow: null,
                    } as AlertGame
                } catch {
                    return { appid, name: `App ${appid}`, isLibrary: false, priceLoaded: false, bestPrice: null, historicalLow: null } as AlertGame
                }
            }))

            allGames = games
            loading  = false

            // Background: fetch ITAD prices per game
            for (const appid of alertAppids) {
                fetch(`/relay/api/itad/${appid}`)
                    .then(r => r.ok ? r.json() : null)
                    .then(itad => {
                        const deal = itad?.deals?.[0] ?? null
                        const idx  = allGames.findIndex(g => g.appid === appid)
                        if (idx === -1) return
                        allGames[idx] = {
                            ...allGames[idx],
                            priceLoaded:  true,
                            bestPrice:    deal ? { price: deal.price, cut: deal.cut, store: deal.store, url: deal.url ?? null } : null,
                            historicalLow: itad?.historicalLow ?? null,
                        }
                    })
                    .catch(() => {
                        const idx = allGames.findIndex(g => g.appid === appid)
                        if (idx !== -1) allGames[idx] = { ...allGames[idx], priceLoaded: true }
                    })
            }
        } catch (err) {
            error   = (err as Error).message
            loading = false
        }
    })
</script>

{#if loading}
    <p class="page-loading">Loading alerts…</p>
{:else if error}
    <p class="page-error">Failed to load alerts: {error}</p>
{:else if !loading && nonLib.length === 0}
    <div class="page-header">
        <h1 class="page-title">Sale Alerts</h1>
    </div>
    <p class="page-empty alerts-empty">
        No games flagged for sale alerts yet. Open any game page and toggle the
        <strong>Bell</strong> flag to start watching it.
    </p>
{:else}
    <div class="page-header">
        <h1 class="page-title">Sale Alerts</h1>
        {#if onSale.length > 0}
            <p class="page-subtitle">{onSale.length} game{onSale.length !== 1 ? 's' : ''} on sale now</p>
        {:else if allPricesLoaded}
            <p class="page-subtitle">No watched games are on sale right now</p>
        {:else}
            <p class="page-subtitle">Checking prices…</p>
        {/if}
    </div>

    {#if onSale.length > 0}
        <div class="alerts-section">
            <h2 class="alerts-section-title">On Sale Now</h2>
            <div class="alerts-onsale-grid">
                {#each onSale as game (game.appid)}
                    {@const cut   = game.bestPrice?.cut   ?? 0}
                    {@const price = game.bestPrice?.price ?? null}
                    {@const store = game.bestPrice?.store ?? ''}
                    {@const url   = game.bestPrice?.url   ?? `/game/${game.appid}`}
                    {@const hl    = game.historicalLow}
                    <a class="alerts-card" href={url} target="_blank" rel="noopener noreferrer" data-game-card data-appid={game.appid} data-game-name={game.name}>
                        <div class="alerts-card-img-wrap">
                            <img class="alerts-card-img"
                                 src="/relay/images/steam/games/{game.appid}/header.jpg"
                                 alt=""
                                 onerror={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0' }}>
                            <span class="alerts-card-cut">-{cut}%</span>
                        </div>
                        <div class="alerts-card-body">
                            <span class="alerts-card-name">{game.name}</span>
                            <div class="alerts-card-pricing">
                                {#if price != null}<span class="alerts-card-price">${price.toFixed(2)}</span>{/if}
                                {#if store}<span class="alerts-card-store">{store}</span>{/if}
                            </div>
                            {#if hl}
                                <span class="alerts-card-hl">All-time low: ${hl.price.toFixed(2)} · {hl.store}{hl.date ? ` (${hl.date.slice(0, 4)})` : ''}</span>
                            {/if}
                        </div>
                    </a>
                {/each}
            </div>
        </div>
    {/if}

    {#if watching.length > 0}
        <div class="alerts-section">
            {#if onSale.length > 0}
                <h2 class="alerts-section-title alerts-section-title--muted">Watching</h2>
            {/if}
            <div class="alerts-watching-list">
                {#each watching as game (game.appid)}
                    {@const price = game.bestPrice?.price ?? null}
                    {@const store = game.bestPrice?.store ?? ''}
                    {@const url   = game.bestPrice?.url   ?? `/game/${game.appid}`}
                    <a class="alerts-watch-row" href={url} target="_blank" rel="noopener noreferrer" data-game-card data-appid={game.appid} data-game-name={game.name}>
                        <img class="alerts-watch-img"
                             src="/relay/images/steam/games/{game.appid}/header.jpg"
                             alt=""
                             onerror={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0' }}>
                        <span class="alerts-watch-name">{game.name}</span>
                        <span class="alerts-watch-price">
                            {#if !game.priceLoaded}
                                <span class="alerts-watch-price-loading">…</span>
                            {:else}
                                {price != null ? `$${price.toFixed(2)}` : '—'}
                                {#if store}<span class="alerts-watch-store">· {store}</span>{/if}
                            {/if}
                        </span>
                    </a>
                {/each}
            </div>
        </div>
    {/if}
{/if}
