<script lang="ts">
    import { onMount } from 'svelte'
    import type { SteamGame, NexusData, NexusMod } from '../../../types.js'
    import { fmtCompact, nexusThumb, nexusImgError } from '../../../js/nexusFormat.js'
    import { adultContent } from '$lib/adult-content.svelte.js'

    const SVG_ARROW   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`
    const SVG_ENDORSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"/><circle cx="12" cy="8" r="6"/></svg>`
    const SVG_DL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`

    interface Props {
        nexusData?: NexusData | null
        game:       SteamGame
        onRefresh?: () => Promise<void>
    }
    let { nexusData, game, onRefresh }: Props = $props()

    onMount(() => adultContent.load())

    let refreshing = $state(false)
    async function refresh() {
        if (!onRefresh || refreshing) return
        refreshing = true
        try { await onRefresh() } finally { refreshing = false }
    }

    let mods    = $derived(nexusData?.mods ?? [])
    let modsUrl = $derived(`/game/${game.appid}/mods`)
    function modUrl(mod: NexusMod) { return `/game/${game.appid}/mods/${mod.modId}` }
</script>

{#if nexusData?.domainName && mods.length}
    <section class="game-section" id="game-sec-nexus">
        <h2 class="game-section-title">
            Mods
            <a class="nxm-all-link" href={modsUrl}>All {(nexusData.totalMods ?? 0).toLocaleString()} ›</a>
            <button class="game-refresh-btn" class:game-refresh-btn--spinning={refreshing} disabled={refreshing} onclick={refresh} title="Refresh Nexus mods">↻</button>
        </h2>

        <div class="nxm-grid">
            {#each mods as mod (mod.modId)}
                <a class="nxm-card" href={modUrl(mod)}>
                    <div class="nxm-thumb" class:nxm-thumb--adult={mod.adult && adultContent.hide}>
                        {#if nexusThumb(mod)}
                            <img src={nexusThumb(mod)} alt="" loading="lazy" onerror={(e) => nexusImgError(e, mod.thumbUrl ?? mod.imageUrl)}>
                        {/if}
                        {#if mod.adult}<span class="nxm-adult">18+</span>{/if}
                        {#if mod.category}<span class="nxm-cat">{mod.category}</span>{/if}
                    </div>
                    <div class="nxm-body">
                        <span class="nxm-name">{mod.name}</span>
                        {#if mod.summary}<p class="nxm-summary">{mod.summary}</p>{/if}
                        <div class="nxm-stats">
                            <span class="nxm-stat nxm-stat--endorse" title="Endorsements">{@html SVG_ENDORSE}{fmtCompact(mod.endorsements)}</span>
                            <span class="nxm-stat" title="Downloads">{@html SVG_DL}{fmtCompact(mod.downloads)}</span>
                        </div>
                    </div>
                </a>
            {/each}
        </div>

        <a class="nxm-more" href={modsUrl}>
            Browse all {(nexusData.totalMods ?? 0).toLocaleString()} mods {@html SVG_ARROW}
        </a>
    </section>
{/if}
