<script lang="ts">
    import { scoreColor } from '../../../js/views/game-render.js'

    interface Props {
        source:   string
        score?:   number | null
        display:  string
        id?:      string
    }
    let { source, score, display, id }: Props = $props()

    let colors = $derived(score != null ? scoreColor(score) : null)
</script>

{#if score == null}
    <div class="gdp-score-chip gdp-score-chip--missing" {id}>
        <span class="gdp-score-chip-source">{source}</span>
        <span class="gdp-score-chip-value">—</span>
    </div>
{:else}
    <div class="gdp-score-chip" {id} style="--chip-clr:{colors?.clr};--chip-bg:{colors?.bg}">
        <span class="gdp-score-chip-source">{source}</span>
        <span class="gdp-score-chip-value">{display}</span>
    </div>
{/if}
