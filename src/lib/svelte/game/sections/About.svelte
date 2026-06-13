<script lang="ts">
    import type { SteamGame } from '../../../types.js'

    interface Props { game: SteamGame }
    let { game }: Props = $props()
</script>

{#if game.store?.detailedDescription}
    <section class="game-section game-about" id="game-sec-about">
        <h2 class="game-section-title">About This Game</h2>
        <div class="game-about-body">{@html game.store.detailedDescription}</div>
    </section>
{/if}
