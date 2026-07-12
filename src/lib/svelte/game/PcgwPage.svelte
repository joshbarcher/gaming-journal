<script lang="ts">
    import { onMount } from 'svelte'
    import type { PcgwData } from '../../types.js'
    import Breadcrumb from '../Breadcrumb.svelte'
    import PcgwDetail from './PcgwDetail.svelte'

    let { appid } = $props()

    const SVG_EXT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`

    let pcgw     = $state<PcgwData | null>(null)
    let gameName = $state('')
    let loading  = $state(true)

    async function load() {
        try {
            const [pRes, gRes] = await Promise.all([
                fetch(`/relay/api/pcgw/${appid}`),
                fetch(`/relay/api/games/${appid}`),
            ])
            if (pRes.ok) { const d = await pRes.json(); pcgw = d?.found ? d : null }
            if (gRes.ok) gameName = (await gRes.json()).name ?? 'Game'
        } catch { /* leave empty */ }
        finally { loading = false }
    }
    onMount(load)
</script>

<svelte:head><title>PCGamingWiki — {gameName}</title></svelte:head>

<div class="nxmp-page">
    <Breadcrumb crumbs={[
        { label: 'Home', href: '/' },
        { label: gameName || 'Game', href: `/game/${appid}` },
        { label: 'PC Gaming Wiki' },
    ]} />

    <header class="nxmp-head">
        <h1 class="nxmp-title">PCGamingWiki</h1>
        {#if pcgw?.pageUrl}
            <a class="nwa-src" href={pcgw.pageUrl} target="_blank" rel="noopener">View on PCGamingWiki {@html SVG_EXT}</a>
        {/if}
    </header>

    {#if loading}
        <div class="nxmp-loading"><div class="community-loader"></div></div>
    {:else if !pcgw}
        <p class="nxmp-empty">No PCGamingWiki data for this game.</p>
    {:else}
        <PcgwDetail pcgwData={pcgw} />
    {/if}
</div>
