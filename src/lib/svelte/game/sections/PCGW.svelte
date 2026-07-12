<script lang="ts">
    import type { SteamGame, PcgwData } from '../../../types.js'

    // Section badge icons — a fresh set (distinct from the detail-page icons).
    function ico(p: string) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>` }
    const ICON = {
        gauge:   ico(`<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>`),
        vsync:   ico(`<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>`),
        scan:    ico(`<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="8" width="10" height="8" rx="1"/>`),
        trend:   ico(`<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>`),
        gem:     ico(`<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>`),
        pad:     ico(`<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.544-.604-6.584-.685-7.258A4 4 0 0 0 17.32 5z"/>`),
        cloud:   ico(`<path d="M12 13v8l-4-4"/><path d="m12 21 4-4"/><path d="M4.393 15.269A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.436 8.284"/>`),
        ext:     `<svg class="pcgw-icon pcgw-icon--xs" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
        arrow:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`,
    }
    const GLYPH: Record<string, string> = { on: '✓', off: '✕', neutral: '!' }

    interface Props {
        pcgwData?:  PcgwData | null
        game:       SteamGame
        onRefresh?: () => Promise<void>
    }
    let { pcgwData, game, onRefresh }: Props = $props()

    let refreshing = $state(false)
    async function refresh() {
        if (!onRefresh || refreshing) return
        refreshing = true
        try { await onRefresh() } finally { refreshing = false }
    }

    // on = supported, off = unsupported, neutral = caveats / unknown (see full page).
    function pcgwState(raw: string | undefined | null): 'on' | 'off' | 'neutral' {
        if (raw == null || raw === '') return 'neutral'
        if (raw === 'true' || raw === 'always on') return 'on'
        if (raw === 'false') return 'off'
        return 'neutral'   // hackable, limited, etc.
    }

    let v   = $derived((pcgwData?.video ?? {}) as Record<string, any>)
    let inp = $derived((pcgwData?.input ?? {}) as any)
    let cl  = $derived((pcgwData?.cloud ?? {}) as Record<string, any>)

    let badges = $derived([
        { label: '120+ FPS',    icon: ICON.gauge, value: v.fps120 },
        { label: 'VSync',       icon: ICON.vsync, value: v.vsync },
        { label: '4K UHD',      icon: ICON.scan,  value: v.uhd4k },
        { label: 'Upscaling',   icon: ICON.trend, value: v.upscaling },
        { label: 'Ray Tracing', icon: ICON.gem,   value: v.rayTracing },
        { label: 'Controller',  icon: ICON.pad,   value: inp.controller?.support ?? inp.controller?.fullSupport },
        { label: 'Cloud (Steam)', icon: ICON.cloud, value: cl.steam },
    ])

    let pcgwUrl = $derived(`/game/${game.appid}/pcgw`)
</script>

{#if pcgwData?.found}
    <section class="game-section" id="game-sec-pcgw">
        <h2 class="game-section-title">
            PCGamingWiki
            <a class="nxm-all-link" href={pcgwUrl}>Details ›</a>
            {#if pcgwData.pageUrl}
                <a class="pcgw-wiki-link" href={pcgwData.pageUrl} target="_blank" rel="noopener" title="View on PCGamingWiki">{@html ICON.ext}</a>
            {/if}
            <button class="game-refresh-btn" class:game-refresh-btn--spinning={refreshing} disabled={refreshing} onclick={refresh} title="Refresh PCGamingWiki data">↻</button>
        </h2>

        <div class="pcgw-sbadges">
            {#each badges as bdg}
                {@const st = pcgwState(bdg.value)}
                <a class="pcgw-sbadge pcgw-sbadge--{st}" href={pcgwUrl} title={bdg.label}>
                    <div class="pcgw-sbadge-circle">
                        {@html bdg.icon}
                        <span class="pcgw-sbadge-glyph">{GLYPH[st]}</span>
                    </div>
                    <span class="pcgw-sbadge-label">{bdg.label}</span>
                </a>
            {/each}
        </div>

        <a class="nxm-more" href={pcgwUrl}>Full PCGamingWiki details {@html ICON.arrow}</a>
    </section>
{/if}
