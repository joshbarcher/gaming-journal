<script lang="ts">
    import { onMount } from 'svelte'
    import type { NewsArticle } from '../../types.js'
    import Breadcrumb from '../Breadcrumb.svelte'
    import ContentBlocks from './ContentBlocks.svelte'

    let { appid, gid } = $props()

    const SVG_EXT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`

    let article  = $state<NewsArticle | null>(null)
    let gameName = $state('')
    let loading  = $state(true)
    let error    = $state(false)

    async function load() {
        loading = true; error = false
        try {
            const [aRes, gRes] = await Promise.all([
                fetch(`/relay/api/news/${appid}/${encodeURIComponent(gid)}`),
                fetch(`/relay/api/games/${appid}`),
            ])
            if (!aRes.ok) throw new Error(`HTTP ${aRes.status}`)
            article = await aRes.json()
            if (gRes.ok) gameName = (await gRes.json()).name ?? 'Game'
        } catch { error = true }
        finally { loading = false }
    }
    onMount(load)

    const fmt = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    function fmtDate(ts?: number) { return ts ? fmt.format(new Date(ts * 1000)) : '' }
</script>

<svelte:head><title>{article?.title ?? 'News'} — {gameName}</title></svelte:head>

<div class="nxd-page nwa-page">
    <Breadcrumb crumbs={[
        { label: 'Home', href: '/' },
        { label: gameName || 'Game', href: `/game/${appid}` },
        { label: 'News', href: `/game/${appid}/news` },
        { label: article?.title ?? 'Article' },
    ]} />

    {#if loading}
        <div class="nxd-loading"><div class="community-loader"></div></div>
    {:else if error || !article}
        <p class="nxmp-empty">Couldn’t load this article.</p>
    {:else}
        <header class="nwa-head">
            {#if article.feedlabel}<span class="nxd-cat">{article.feedlabel}</span>{/if}
            <h1 class="nwa-title">{article.title}</h1>
            <div class="nwa-meta">
                {#if article.date}<span>{fmtDate(article.date)}</span>{/if}
                {#if article.author}<span>· by {article.author}</span>{/if}
                {#if article.url}
                    <a class="nwa-src" href={article.url} target="_blank" rel="noopener">
                        Read full article {@html SVG_EXT}
                    </a>
                {/if}
            </div>
        </header>

        {#if article.previewImage}
            <figure class="nwa-hero"><img src={article.previewImage} alt="" /></figure>
        {/if}

        <div class="nxd-desc-body nwa-body">
            <ContentBlocks blocks={article.blocks ?? []} />
        </div>
    {/if}
</div>
