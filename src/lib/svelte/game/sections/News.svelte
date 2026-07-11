<script lang="ts">
    import type { NewsData, NewsItem } from '../../../types.js'
    import { renderNewsHtml } from '../../../js/views/game-render.js'

    interface Props { news?: NewsData | null }
    let { news }: Props = $props()

    let items = $derived(news?.items ?? [])
    let activeIdx = $state(0)
    let activeItem = $derived(items[activeIdx] ?? null)
    let activeHtml = $derived(renderNewsHtml(activeItem?.contents))

    const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

    function fmtDate(ts: number | undefined) {
        return ts ? fmt.format(new Date(ts * 1000)) : ''
    }
</script>

{#if items.length}
    <section class="game-section game-news" id="game-sec-news">
        <h2 class="game-section-title">News</h2>
        <div class="news-layout">
            <div class="news-list">
                {#each items as item, i}
                    <button
                        class="news-item"
                        class:news-item--active={i === activeIdx}
                        onclick={() => activeIdx = i}
                    >
                        <span class="news-item-feed">{item.feedlabel}</span>
                        <span class="news-item-title">{item.title}</span>
                        <span class="news-item-date">{fmtDate(item.date)}</span>
                    </button>
                {/each}
            </div>
            <select class="news-select" bind:value={activeIdx}>
                {#each items as item, i}
                    <option value={i}>{item.feedlabel} — {item.title}</option>
                {/each}
            </select>
            {#if activeItem}
                <div class="news-panel">
                    <div class="news-panel-meta">
                        <span class="news-panel-feed">{activeItem.feedlabel}</span>
                        <span class="news-panel-date">{fmtDate(activeItem.date)}</span>
                        {#if activeItem.url}
                            <a class="news-panel-link" href={activeItem.url} target="_blank" rel="noopener noreferrer">
                                Read full article ↗
                            </a>
                        {/if}
                    </div>
                    <h3 class="news-panel-title">{activeItem.title}</h3>
                    <div class="news-panel-body">{@html activeHtml}</div>
                </div>
            {/if}
        </div>
    </section>
{/if}
