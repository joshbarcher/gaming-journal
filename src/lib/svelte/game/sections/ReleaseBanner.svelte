<script lang="ts">
    import type { SteamGame } from '../../../types.js'
    import { releaseStatus } from '../../../js/views/game-render.js'

    interface Props { game: SteamGame }
    let { game }: Props = $props()

    let status  = $derived(releaseStatus(game))
    let dateStr = $derived(game.store?.releaseDate ?? '')
</script>

{#if status === 'coming_soon'}
    {@const lower    = dateStr.toLowerCase()}
    {@const datePart = dateStr && !['coming soon', 'tba', 'tbd'].includes(lower) ? ` — ${dateStr}` : ''}
    <div class="game-release-banner game-release-banner--soon">
        <span class="game-release-banner-icon">⌛</span>Coming Soon{datePart}
    </div>
{:else if status === 'early_access'}
    {@const datePart = dateStr ? ` — in Early Access since ${dateStr}` : ''}
    <div class="game-release-banner game-release-banner--ea">
        <span class="game-release-banner-icon">◎</span>Early Access{datePart}
    </div>
{/if}
