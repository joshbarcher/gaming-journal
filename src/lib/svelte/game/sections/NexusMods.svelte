<script lang="ts">
    import type { SteamGame, NexusData, NexusMod } from '../../../types.js'

    const SVG_EXT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`
    const SVG_ENDORSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"/><circle cx="12" cy="8" r="6"/></svg>`
    const SVG_DL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`

    interface Props {
        nexusData?: NexusData | null
        game:       SteamGame
        onRefresh?: () => Promise<void>
    }
    let { nexusData, game, onRefresh }: Props = $props()

    let refreshing = $state(false)
    async function refresh() {
        if (!onRefresh || refreshing) return
        refreshing = true
        try { await onRefresh() } finally { refreshing = false }
    }

    // 494469 → "494K", 24669741 → "24.7M"
    function fmtCompact(n: number): string {
        if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '') + 'M'
        if (n >= 1_000)     return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '') + 'K'
        return String(n)
    }

    // Prefer the relay-mirrored (WebP-optimised) image; fall back to the Nexus CDN.
    function thumbSrc(mod: NexusMod): string {
        if (mod.localThumb) return `/relay${mod.localThumb}`
        return mod.thumbUrl ?? mod.imageUrl ?? ''
    }
    function onThumbError(e: Event, mod: NexusMod) {
        const img = e.currentTarget as HTMLImageElement
        const cdn = mod.thumbUrl ?? mod.imageUrl ?? ''
        if (cdn && !img.dataset.fellBack) { img.dataset.fellBack = '1'; img.src = cdn; return }
        img.style.visibility = 'hidden'
    }

    let mods = $derived(nexusData?.mods ?? [])
</script>

{#if nexusData?.domainName && mods.length}
    <section class="game-section" id="game-sec-nexus">
        <h2 class="game-section-title">
            Mods
            {#if nexusData.gameUrl}
                <a class="nxm-ext-link" href={nexusData.gameUrl} target="_blank" rel="noopener" title="Browse on Nexus Mods">{@html SVG_EXT}</a>
            {/if}
            <button class="game-refresh-btn" class:game-refresh-btn--spinning={refreshing} disabled={refreshing} onclick={refresh} title="Refresh Nexus mods">↻</button>
        </h2>

        <div class="nxm-grid">
            {#each mods as mod (mod.modId)}
                <a class="nxm-card" href={mod.url} target="_blank" rel="noopener">
                    <div class="nxm-thumb" class:nxm-thumb--adult={mod.adult}>
                        {#if thumbSrc(mod)}
                            <img src={thumbSrc(mod)} alt="" loading="lazy" onerror={(e) => onThumbError(e, mod)}>
                        {/if}
                        {#if mod.adult}<span class="nxm-adult">18+</span>{/if}
                        {#if mod.category}<span class="nxm-cat">{mod.category}</span>{/if}
                    </div>
                    <div class="nxm-body">
                        <span class="nxm-name">{mod.name}</span>
                        <div class="nxm-stats">
                            <span class="nxm-stat nxm-stat--endorse" title="Endorsements">{@html SVG_ENDORSE}{fmtCompact(mod.endorsements)}</span>
                            <span class="nxm-stat" title="Downloads">{@html SVG_DL}{fmtCompact(mod.downloads)}</span>
                        </div>
                    </div>
                </a>
            {/each}
        </div>

        {#if nexusData.gameUrl}
            <a class="nxm-more" href={nexusData.gameUrl} target="_blank" rel="noopener">
                Browse all {(nexusData.totalMods ?? 0).toLocaleString()} mods on Nexus Mods {@html SVG_EXT}
            </a>
        {/if}
    </section>
{/if}
