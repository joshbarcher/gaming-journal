<script lang="ts">
    import type { SteamGame, ItadData } from '../../../types.js'

    interface Props {
        itad?: ItadData | null
        game:  SteamGame
    }
    let { itad, game }: Props = $props()
</script>

<div class="gdp-divider"></div>
{#if itad?.bestPrice}
    {@const bp = itad.bestPrice}
    <div class="gdp-row">
        <span class="gdp-label">Best Price</span>
        <span class="gdp-value">${bp.price.toFixed(2)} · {bp.store}{bp.cut > 0 ? '' : ''}{#if bp.cut > 0}&nbsp;<span class="gdp-cut">-{bp.cut}%</span>{/if}</span>
    </div>
{:else if game.store?.isFree}
    <div class="gdp-row"><span class="gdp-label">Price</span><span class="gdp-value">Free to Play</span></div>
{:else if game.store?.price?.final_formatted}
    <div class="gdp-row"><span class="gdp-label">Price</span><span class="gdp-value">{game.store.price.final_formatted} · Steam</span></div>
{/if}
{#if itad?.historicalLow}
    {@const hl = itad.historicalLow}
    {@const yr = hl.date ? ` (${hl.date.slice(0, 4)})` : ''}
    <div class="gdp-row">
        <span class="gdp-label">All-Time Low</span>
        <span class="gdp-value">${hl.price.toFixed(2)} · {hl.store}{yr}</span>
    </div>
{/if}
