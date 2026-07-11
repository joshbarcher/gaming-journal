<script lang="ts">
    import type { NewsItem } from '../../types.js'
    let { item, appid }: { item: NewsItem; appid: string | number } = $props()

    const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    function fmtDate(ts?: number) { return ts ? fmt.format(new Date(ts * 1000)) : '' }
    function onImgError(e: Event) { ((e.currentTarget as HTMLElement).closest('.nws-thumb') as HTMLElement).classList.add('nws-thumb--none') }
</script>

<a class="nws-card" href={`/game/${appid}/news/${encodeURIComponent(item.gid ?? '')}`}>
    <div class="nws-thumb" class:nws-thumb--none={!item.previewImage}>
        {#if item.previewImage}
            <img src={item.previewImage} alt="" loading="lazy" onerror={onImgError} />
        {/if}
        <span class="nws-thumb-fallback">{item.feedlabel}</span>
    </div>
    <div class="nws-body">
        <span class="nws-feed">{item.feedlabel}</span>
        <span class="nws-title">{item.title}</span>
        {#if item.excerpt}<p class="nws-excerpt">{item.excerpt}</p>{/if}
        <span class="nws-date">{fmtDate(item.date)}</span>
    </div>
</a>
