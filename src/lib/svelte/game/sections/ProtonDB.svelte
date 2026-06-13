<script lang="ts">
    import type { SteamGame, ProtonData } from '../../../types.js'

    const SVG_AWARD        = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"/><circle cx="12" cy="8" r="6"/></svg>`
    const SVG_SHIELD_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>`
    const SVG_PERCENT      = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>`
    const SVG_USERS        = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`
    const SVG_EXT          = `<svg class="pcgw-icon pcgw-icon--xs" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`

    const LOG_TICKS = [
        { label: '1',   pct: logPct(1) },
        { label: '10',  pct: logPct(10) },
        { label: '100', pct: logPct(100) },
        { label: '1K',  pct: logPct(1000) },
        { label: '5K+', pct: 100 },
    ]

    function logPct(n: number): number {
        return (Math.log(Math.max(1, Math.min(n, 5000))) / Math.log(5000)) * 100
    }

    function cap(s: string | null | undefined): string | null {
        return s ? s.charAt(0).toUpperCase() + s.slice(1) : null
    }

    interface Props {
        protonData?: ProtonData | null
        game:        SteamGame
        onRefresh?:  () => Promise<void>
    }
    let { protonData, game, onRefresh }: Props = $props()

    let refreshing  = $state(false)
    let markerPct   = $derived(protonData ? logPct(protonData.total ?? 0) : 0)
    let scoreStr    = $derived(protonData?.score != null ? Math.round(protonData.score * 100) + '%' : '—')

    async function refresh() {
        if (!onRefresh || refreshing) return
        refreshing = true
        try { await onRefresh() } finally { refreshing = false }
    }
</script>

{#if protonData?.tier}
    {@const tier = protonData.tier}
    {@const total = protonData.total ?? 0}
    <section class="game-section" id="game-sec-protondb">
        <h2 class="game-section-title">
            Linux Compatibility
            <a class="pcgw-wiki-link" href="https://www.protondb.com/app/{game.appid}" target="_blank" rel="noopener">{@html SVG_EXT}</a>
            <button class="game-refresh-btn" class:game-refresh-btn--spinning={refreshing} disabled={refreshing} onclick={refresh} title="Refresh ProtonDB data">↻</button>
        </h2>
        <div class="protondb-row protondb-row--{tier}">
            <div class="protondb-col protondb-col--badge proton-badge--{tier}">
                <span class="protondb-col-icon protondb-badge-icon">{@html SVG_AWARD}</span>
                <span class="protondb-badge-name">{cap(tier)}</span>
            </div>
            <div class="protondb-col protondb-col--stat">
                <span class="protondb-col-icon">{@html SVG_SHIELD_CHECK}</span>
                <span class="protondb-col-text">
                    <span class="protondb-col-value">{cap(protonData.confidence ?? null) ?? '—'}</span>
                    <span class="protondb-col-label">Confidence</span>
                </span>
            </div>
            <div class="protondb-col protondb-col--stat">
                <span class="protondb-col-icon">{@html SVG_PERCENT}</span>
                <span class="protondb-col-text">
                    <span class="protondb-col-value">{scoreStr}</span>
                    <span class="protondb-col-label">Score</span>
                </span>
            </div>
            <div class="protondb-col protondb-col--stat">
                <span class="protondb-col-icon">{@html SVG_USERS}</span>
                <span class="protondb-col-text">
                    <span class="protondb-col-value">{total.toLocaleString()}</span>
                    <span class="protondb-col-label">Reports</span>
                </span>
            </div>
            <div class="protondb-col protondb-col--bar">
                <span class="protondb-bar-label">Community Reports</span>
                <div class="protondb-bar-area">
                    <div class="protondb-bar-track">
                        <div class="protondb-bar-fill" style="width:{markerPct}%"></div>
                        <div class="protondb-bar-marker" style="left:{markerPct}%">
                            <span class="protondb-bar-count">{total.toLocaleString()}</span>
                        </div>
                    </div>
                    <div class="protondb-ticks-row">
                        {#each LOG_TICKS as t}
                            <span class="protondb-tick" style="left:{t.pct}%">{t.label}</span>
                        {/each}
                    </div>
                </div>
            </div>
        </div>
    </section>
{/if}
