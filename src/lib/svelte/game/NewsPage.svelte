<script lang="ts">
    import { onMount } from 'svelte'
    import type { NewsItem } from '../../types.js'
    import Breadcrumb from '../Breadcrumb.svelte'
    import NewsCard from './NewsCard.svelte'

    let { appid } = $props()

    let gameName = $state('')
    let items    = $state<NewsItem[]>([])
    let loading  = $state(true)

    async function load() {
        try {
            const [nRes, gRes] = await Promise.all([
                fetch(`/relay/api/news/${appid}`),
                fetch(`/relay/api/games/${appid}`),
            ])
            if (nRes.ok) items = (await nRes.json()).items ?? []
            if (gRes.ok) gameName = (await gRes.json()).name ?? 'Game'
        } catch { /* leave empty */ }
        finally { loading = false }
    }
    onMount(load)
</script>

<svelte:head><title>News — {gameName}</title></svelte:head>

<div class="nxmp-page">
    <Breadcrumb crumbs={[
        { label: 'Home', href: '/' },
        { label: gameName || 'Game', href: `/game/${appid}` },
        { label: 'News' },
    ]} />

    <header class="nxmp-head">
        <h1 class="nxmp-title">News{#if items.length} <span class="nxmp-count">{items.length}</span>{/if}</h1>
    </header>

    {#if loading}
        <div class="nxmp-loading"><div class="community-loader"></div></div>
    {:else if !items.length}
        <p class="nxmp-empty">No news for this game.</p>
    {:else}
        <div class="nws-grid nws-grid--page">
            {#each items as item (item.gid)}
                <NewsCard {item} {appid} />
            {/each}
        </div>
    {/if}
</div>
