<script lang="ts">
    import { onMount } from 'svelte'
    import type { AlertResult } from '../../types.js'

    let loading  = $state(true)
    let error    = $state<string | null>(null)
    let onSale   = $state<AlertResult[]>([])
    let watching = $state<AlertResult[]>([])

    onMount(async () => {
        try {
            const res = await fetch('/api/alerts')
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data  = await res.json()
            onSale   = data.onSale   ?? []
            watching = data.watching ?? []
        } catch (err) {
            error = (err as Error).message
        }
        loading = false
    })
</script>

{#if loading}
    <p class="page-loading">Loading alerts…</p>
{:else if error}
    <p class="page-error">Failed to load alerts: {error}</p>
{:else if onSale.length === 0 && watching.length === 0}
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
        {:else}
            <p class="page-subtitle">No watched games are on sale right now</p>
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
                    <a class="alerts-card" href={url} target="_blank" rel="noopener noreferrer">
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
                    <a class="alerts-watch-row" href={url} target="_blank" rel="noopener noreferrer">
                        <img class="alerts-watch-img"
                             src="/relay/images/steam/games/{game.appid}/header.jpg"
                             alt=""
                             onerror={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0' }}>
                        <span class="alerts-watch-name">{game.name}</span>
                        <span class="alerts-watch-price">
                            {price != null ? `$${price.toFixed(2)}` : '—'}
                            {#if store}<span class="alerts-watch-store">· {store}</span>{/if}
                        </span>
                    </a>
                {/each}
            </div>
        </div>
    {/if}
{/if}
