<script lang="ts">
    import type { SteamGame, NewsData } from '../../../types.js'
    import NewsCard from '../NewsCard.svelte'

    const SVG_ARROW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`

    interface Props { news?: NewsData | null; game: SteamGame }
    let { news, game }: Props = $props()

    let items   = $derived(news?.items ?? [])
    let top     = $derived(items.slice(0, 6))
    let newsUrl = $derived(`/game/${game.appid}/news`)
</script>

{#if items.length}
    <section class="game-section game-news" id="game-sec-news">
        <h2 class="game-section-title">
            News
            <a class="nxm-all-link" href={newsUrl}>All {items.length} ›</a>
        </h2>
        <div class="nws-grid">
            {#each top as item (item.gid)}
                <NewsCard {item} appid={game.appid} />
            {/each}
        </div>
        <a class="nxm-more" href={newsUrl}>All news {@html SVG_ARROW}</a>
    </section>
{/if}
