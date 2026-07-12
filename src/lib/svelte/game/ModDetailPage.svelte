<script lang="ts">
    import { onMount } from 'svelte'
    import type { NexusModDetail } from '../../types.js'
    import Breadcrumb from '../Breadcrumb.svelte'
    import ContentBlocks from './ContentBlocks.svelte'
    import { openLightbox } from '../../js/lightbox.js'
    import { fmtCompact, fmtSize, nexusImage, nexusImgError } from '../../js/nexusFormat.js'
    import { adultContent } from '$lib/adult-content.svelte.js'

    let { appid, modId } = $props()

    const SVG_EXT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`

    let detail   = $state<NexusModDetail | null>(null)
    let gameName = $state('')
    let loading  = $state(true)
    let error    = $state(false)

    async function load() {
        loading = true; error = false
        try {
            const [dRes, mRes] = await Promise.all([
                fetch(`/relay/api/nexus/${appid}/mod/${modId}`),
                fetch(`/relay/api/nexus/${appid}`),
            ])
            if (!dRes.ok) throw new Error(`HTTP ${dRes.status}`)
            detail = await dRes.json()
            if (mRes.ok) { const e = await mRes.json(); gameName = e.steamName ?? e.nexusName ?? 'Game' }
            pollAuthorImages()
        } catch { error = true }
        finally { loading = false }
    }
    onMount(() => { adultContent.load(); load() })

    // The author-images tab is scraped in the background (serialized + gentle, so it can
    // take a while under load). Poll until it resolves, showing status the whole time.
    let imagesPending = $state(true)   // scrape not yet resolved (authorImagesAt unset)
    let pollExhausted = $state(false)  // gave up polling; scrape may still be queued
    async function pollAuthorImages(tries = 0) {
        if (detail?.authorImagesAt) { imagesPending = false; return }
        if (tries >= 20) { pollExhausted = true; return }   // ~60s of polling
        setTimeout(async () => {
            try {
                const r = await fetch(`/relay/api/nexus/${appid}/mod/${modId}`)
                if (r.ok) {
                    const fresh: NexusModDetail = await r.json()
                    if ((fresh.gallery?.length ?? 0) !== (detail?.gallery?.length ?? 0) || fresh.authorImagesAt) detail = fresh
                    if (fresh.authorImagesAt) { imagesPending = false; return }
                }
            } catch { /* ignore */ }
            pollAuthorImages(tries + 1)
        }, 3000)
    }

    function fmtDate(s?: string | null) {
        if (!s) return ''
        try { return new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }
        catch { return '' }
    }

    let blocks  = $derived(detail?.descriptionBlocks ?? [])
    let heroSrc = $derived(detail ? nexusImage(detail) : '')
    let gallery = $derived(detail?.gallery ?? [])
    function shotSrc(g: { url: string; localUrl?: string | null }) { return g.localUrl ? `/relay${g.localUrl}` : g.url }
    let gallerySrcs = $derived(gallery.map(shotSrc))
</script>

<svelte:head><title>{detail?.name ?? 'Mod'} — {gameName}</title></svelte:head>

<div class="nxd-page">
    <Breadcrumb crumbs={[
        { label: 'Home', href: '/' },
        { label: gameName || 'Game', href: `/game/${appid}` },
        { label: 'Mods', href: `/game/${appid}/mods` },
        { label: detail?.name ?? 'Mod' },
    ]} />

    {#if loading}
        <div class="nxd-loading"><div class="community-loader"></div></div>
    {:else if error || !detail}
        <p class="nxmp-empty">Couldn’t load this mod.</p>
    {:else}
        <header class="nxd-hero">
            {#if heroSrc}
                <div class="nxd-hero-img" class:nxd-hero-img--adult={detail.adult && adultContent.hide}>
                    <img src={heroSrc} alt="" onerror={(e) => nexusImgError(e, detail?.imageUrl ?? detail?.thumbUrl)}>
                    {#if detail.adult}<span class="nxm-adult nxd-adult">18+</span>{/if}
                </div>
            {/if}
            <div class="nxd-hero-info">
                {#if detail.category}<span class="nxd-cat">{detail.category}</span>{/if}
                <h1 class="nxd-title">{detail.name}</h1>
                {#if detail.summary}<p class="nxd-summary">{detail.summary}</p>{/if}
                <div class="nxd-meta">
                    {#if detail.author}<span>by <strong>{detail.author}</strong></span>{/if}
                    {#if detail.version}<span class="nxd-chip">v{detail.version}</span>{/if}
                    {#if detail.supportsVortex}<span class="nxd-chip nxd-chip--ok">Vortex</span>{/if}
                </div>
                <div class="nxd-stats">
                    <div class="nxd-stat"><span class="nxd-stat-n">{fmtCompact(detail.endorsements)}</span><span class="nxd-stat-l">Endorsements</span></div>
                    <div class="nxd-stat"><span class="nxd-stat-n">{fmtCompact(detail.downloads)}</span><span class="nxd-stat-l">Downloads</span></div>
                    {#if detail.fileSize}<div class="nxd-stat"><span class="nxd-stat-n">{fmtSize(detail.fileSize)}</span><span class="nxd-stat-l">Size</span></div>{/if}
                    {#if detail.updatedAt}<div class="nxd-stat"><span class="nxd-stat-n">{fmtDate(detail.updatedAt)}</span><span class="nxd-stat-l">Updated</span></div>{/if}
                </div>
                <a class="nxd-nexus-btn" href={detail.url} target="_blank" rel="noopener">
                    View on Nexus Mods {@html SVG_EXT}
                </a>
            </div>
        </header>

        {#if detail.tags?.length}
            <div class="nxd-tags">
                {#each detail.tags as tag}<span class="nxd-tag">{tag}</span>{/each}
            </div>
        {/if}

        <section class="nxd-media">
            <h2 class="game-section-title">
                Media
                {#if gallery.length}<span class="nxd-media-count">{gallery.length}</span>{/if}
                {#if imagesPending && !pollExhausted}<span class="nxd-media-status"><span class="nxd-media-spin"></span> fetching author images…</span>{/if}
            </h2>
            {#if gallery.length}
                <div class="game-shots-grid">
                    {#each gallery as g, i}
                        <div class="game-shot-item">
                            <img class="game-shot-img" src={shotSrc(g)} alt="Screenshot" loading="lazy"
                                role="button" tabindex="0"
                                onclick={() => openLightbox(gallerySrcs, i)}
                                onkeydown={(e) => e.key === 'Enter' && openLightbox(gallerySrcs, i)}
                                onerror={(e) => { const el = (e.currentTarget as HTMLImageElement); if (el.src !== g.url) el.src = g.url; else (el.closest('.game-shot-item') as HTMLElement).style.display = 'none' }} />
                        </div>
                    {/each}
                </div>
            {:else if imagesPending && !pollExhausted}
                <p class="nxd-media-note"><span class="nxd-media-spin"></span> Pulling images from Nexus — this can take a moment (they're fetched gently, one mod at a time).</p>
            {:else if pollExhausted}
                <p class="nxd-media-note">Images are still being fetched in the background — refresh in a minute to see them.</p>
            {:else}
                <p class="nxd-media-note nxd-media-note--empty">No images available for this mod.</p>
            {/if}
        </section>

        {#if blocks.length}
            <section class="nxd-desc">
                <h2 class="game-section-title">Description</h2>
                <div class="nxd-desc-body"><ContentBlocks {blocks} /></div>
            </section>
        {/if}
    {/if}
</div>
