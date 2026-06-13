<script lang="ts">
    import type { SteamGame } from '../../../types.js'
    import { onMount } from 'svelte'

    interface Props {
        game:         SteamGame
        onShotClick?: (urls: string[], index: number) => void
    }
    let { game, onShotClick }: Props = $props()

    let urls = $derived.by(() => {
        const apiShots = (game.media?.screenshots ?? []).filter(Boolean)
        return apiShots.length > 0
            ? apiShots
            : Array.from({ length: 25 }, (_, i) => `/relay/images/steam/screenshots/${game.appid}/${i}.jpg`)
    })

    let visible = $state<boolean[]>([])
    $effect(() => { visible = urls.map(() => true) })
</script>

<section class="game-section" id="game-sec-screenshots">
    <h2 class="game-section-title">Screenshots</h2>
    <div class="game-shots-grid">
        {#each urls as url, i}
            {#if visible[i]}
                <div class="game-shot-item">
                    <img
                        class="game-shot-img"
                        src={url}
                        alt="Screenshot"
                        role="button"
                        tabindex="0"
                        onclick={() => onShotClick?.(urls.filter((_, j) => visible[j]), i)}
                        onerror={() => { visible[i] = false }}
                    />
                </div>
            {/if}
        {/each}
    </div>
    <p class="game-section-empty game-shots-fallback">No screenshots available.</p>
</section>
