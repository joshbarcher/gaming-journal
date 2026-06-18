<script lang="ts">
    import type { SteamGame, ItadData } from '../../../types.js'

    const SVG_CLOCK = `<svg class="itad-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`

    const HIDDEN_STORES = new Set(['gamesplanet uk', 'gamesplanet fr', 'gamesplanet de'])
    const STORE_ICONS: Record<string, string> = {
        'humble store':   'humblestore',
        'gamesplanet us': 'gamesplanet',
        'steam':          'steam',
        'greenmangaming': 'greenmangaming',
        'fanatical':      'fanatical',
        'gamebillet':     'gamebillet.webp',
    }

    function storeIconSrc(storeName: string): string | null {
        const file = STORE_ICONS[storeName.toLowerCase()]
        if (!file) return null
        return `/images/stores/${file.includes('.') ? file : `${file}.svg`}`
    }

    interface Props {
        itad?:      ItadData | null
        game:       SteamGame
        onRefresh?: () => Promise<void>
    }
    let { itad, game, onRefresh }: Props = $props()

    let refreshing = $state(false)
    let deals      = $derived((itad?.deals ?? []).filter(d => !HIDDEN_STORES.has(d.store.toLowerCase())))

    async function refresh() {
        if (!onRefresh || refreshing) return
        refreshing = true
        try { await onRefresh() } finally { refreshing = false }
    }
</script>

<section class="game-section" id="game-sec-prices">
    <h2 class="game-section-title">
        Prices
        <button
            class="game-refresh-btn"
            class:game-refresh-btn--spinning={refreshing}
            disabled={refreshing}
            onclick={refresh}
            title="Refresh price data"
        >↻</button>
    </h2>

    {#if !deals.length}
        <p class="game-section-empty">No price data available for this game.</p>
    {:else}
        {#if itad?.historicalLow}
            {@const hl = itad.historicalLow}
            <div class="itad-historic">
                {@html SVG_CLOCK}
                <span class="itad-historic-label">All-time low</span>
                <div class="itad-historic-values">
                    <span class="itad-historic-price">${hl.price.toFixed(2)}</span>
                    <span class="itad-historic-cut">-{hl.cut}%</span>
                    <span class="itad-historic-meta">{hl.store}{hl.date ? ` · ${hl.date.slice(0, 4)}` : ''}</span>
                </div>
            </div>
        {/if}
        <div class="itad-cards">
            {#each deals as d, i}
                {@const iconSrc = storeIconSrc(d.store)}
                <a class="itad-card" class:itad-card--best={i === 0} href={d.url} target="_blank" rel="noopener noreferrer">
                    <div class="itad-card-logo">
                        {#if iconSrc}<img class="itad-store-icon" src={iconSrc} alt="" data-store={d.store.toLowerCase()}>{/if}
                    </div>
                    <span class="itad-card-name">{d.store}</span>
                    <span class="itad-card-price">{d.price === 0 ? 'Free' : `$${d.price.toFixed(2)}`}</span>
                    {#if d.cut > 0 || d.regular !== d.price}
                        <div class="itad-card-meta">
                            {#if d.cut > 0}
                                <span class="itad-cut" class:itad-cut--high={d.cut >= 50} class:itad-cut--mid={d.cut < 50}>-{d.cut}%</span>
                            {/if}
                            {#if d.cut > 0}
                                <span class="itad-was">${d.regular.toFixed(2)}</span>
                            {/if}
                        </div>
                    {/if}
                </a>
            {/each}
        </div>
    {/if}
</section>
