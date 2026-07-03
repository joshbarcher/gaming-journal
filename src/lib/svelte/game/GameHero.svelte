<script lang="ts">
    import { onMount, onDestroy } from 'svelte'
    import type { SteamGame, CommunityReviews, ProtonData, ItadData } from '../../types.js'
    import { escapeHtml, steamStoreUrl } from '../../js/utils.js'
    import { fmtHours } from '../../js/views/game-render.js'
    import ScoreChip from './sections/ScoreChip.svelte'
    import GdpPrices from './sections/GdpPrices.svelte'
    import Breadcrumb from '../Breadcrumb.svelte'

    interface Section { label: string; done: boolean }
    interface Props {
        game:             SteamGame | null
        communityReviews: CommunityReviews | null
        protonData:       ProtonData | null
        itad:             ItadData | null | undefined
        hltb:             SteamGame['hltb'] | null | undefined
        sections?:        Section[]
    }
    let { game, communityReviews, protonData, itad, hltb, sections = [] }: Props = $props()

    let badgeVisible = $state(false)
    let badgeGone    = $state(false)
    let _fadeTimer: ReturnType<typeof setTimeout> | null = null

    $effect(() => {
        const pending = sections.some(s => !s.done)
        if (pending) {
            badgeVisible = true
            badgeGone    = false
            if (_fadeTimer) { clearTimeout(_fadeTimer); _fadeTimer = null }
        } else if (badgeVisible && !badgeGone) {
            _fadeTimer = setTimeout(() => {
                badgeGone = true
                _fadeTimer = setTimeout(() => { badgeVisible = false }, 400)
            }, 1200)
        }
    })

    const SVG_AWARD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"/><circle cx="12" cy="8" r="6"/></svg>`
    const SVG_SYNC  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>`

    // Background slideshow
    let bgAEl = $state<HTMLDivElement | null>(null)
    let bgBEl = $state<HTMLDivElement | null>(null)
    let timer: ReturnType<typeof setInterval> | null = null

    onMount(() => {
        const bgARef = bgAEl, bgBRef = bgBEl
        if (!bgARef || !bgBRef) return
        const shots = game?.media?.screenshots ?? []
        const candidates = shots.length > 0 ? shots : ([game?.media?.background].filter(Boolean) as string[])
        if (candidates.length < 2) return

        Promise.all(candidates.map((url: string) => new Promise(resolve => {
            const img = new Image()
            img.onload  = () => resolve(url)
            img.onerror = () => resolve(null)
            img.src = url
        }))).then(loaded => {
            const frames = loaded.filter(Boolean)
            if (frames.length < 2) return

            for (let i = frames.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [frames[i], frames[j]] = [frames[j], frames[i]]
            }

            const INTERVAL = 6_000, PAN_DUR = 10_000
            const randDir = () => Math.random() < 0.5 ? 'top' : 'bottom'
            const willPan = () => Math.random() < 0.2

            const applyTransition = (el: HTMLDivElement, pan: boolean) => {
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    el.style.transition = pan ? `opacity 1.5s ease, background-position ${PAN_DUR}ms linear` : 'opacity 1.5s ease'
                    if (pan) el.style.backgroundPosition = `center ${randDir()}`
                }))
            }

            applyTransition(bgARef, willPan())
            let idx = 1, showingA = true

            timer = setInterval(() => {
                if (!document.contains(bgARef)) { clearInterval(timer ?? undefined); return }
                const url      = frames[idx % frames.length]
                const incoming = (showingA ? bgBRef : bgARef)!
                const outgoing = (showingA ? bgARef : bgBRef)!
                const pan      = willPan()
                idx++
                incoming.style.transition         = 'none'
                incoming.style.backgroundImage    = `url('${url}')`
                incoming.style.backgroundPosition = 'center center'
                incoming.style.opacity            = '0'
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    if (!document.contains(bgARef)) return
                    incoming.style.transition = pan ? `opacity 1.5s ease, background-position ${PAN_DUR}ms linear` : 'opacity 1.5s ease'
                    incoming.style.opacity    = '1'
                    if (pan) incoming.style.backgroundPosition = `center ${randDir()}`
                    outgoing.style.opacity = '0'
                }))
                showingA = !showingA
            }, INTERVAL)
        })
    })

    onDestroy(() => { if (timer) clearInterval(timer) })

    let screenshots  = $derived(game?.media?.screenshots ?? [])
    let initBg       = $derived(screenshots[0] ?? game?.media?.background ?? game?.media?.header ?? '')
    let logoUrl      = $derived(game?.media?.logo ?? '')
    let desc         = $derived(game?.store?.description ?? '')
    let steamRatio   = $derived(communityReviews?.summary?.ratio ?? null)
    let mcData       = $derived(game?.store?.metacritic)
    let mcScore      = $derived(typeof mcData === 'number' ? mcData : (mcData?.score ?? null))
    let playerHours  = $derived((game?.playtimeMinutes ?? 0) / 60)

    let hltbRows = $derived(
        hltb?.matched ? [
            hltb.gameplayMain          != null && { label: 'Main Story',    h: hltb.gameplayMain },
            hltb.gameplayMainExtra     != null && { label: 'Main + Extras', h: hltb.gameplayMainExtra },
            hltb.gameplayCompletionist != null && { label: 'Completionist', h: hltb.gameplayCompletionist },
        ].filter(Boolean) as { label: string; h: number }[] : []
    )

    let tags = $derived.by(() => {
        const genres = game?.store?.genres ?? []
        const cats = (game?.store?.categories ?? []).filter((c: string) =>
            ['Single-player', 'Multi-player', 'Co-op', 'Online Co-op', 'Steam Achievements', 'Steam Cloud', 'Full controller support'].includes(c)
        )
        return [...genres, ...cats].slice(0, 7)
    })

    let plat    = $derived(game?.store?.platforms)
    let platStr = $derived(plat ? [plat.windows && 'Windows', plat.mac && 'macOS', plat.linux && 'Linux'].filter(Boolean).join(' · ') : '')

    let protonTier = $derived(protonData?.tier)
    let protonCap  = (s: string | null | undefined) => s ? s.charAt(0).toUpperCase() + s.slice(1) : null
</script>

<section class="game-hero" id="game-sec-hero">
    <div class="game-hero-bg game-hero-bg--a" bind:this={bgAEl} style={initBg ? `background-image:url('${initBg}')` : ''}></div>
    <div class="game-hero-bg game-hero-bg--b" bind:this={bgBEl}></div>
    <nav class="game-hero-nav">
        <Breadcrumb crumbs={[
            { label: 'Home', href: '/' },
            { label: game?.name ?? '' },
        ]} />
    </nav>
    <div class="game-hero-body">
        <div class="game-hero-left">
            <div class="game-hero-spacer"></div>
            {#if logoUrl}
                <img class="game-hero-logo" src={logoUrl} alt="" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}>
            {/if}
            <h1 class="game-hero-title">{game?.name ?? ''}</h1>
            {#if desc}<p class="game-hero-desc">{desc}</p>{/if}
            {#if tags.length > 0}
                <div class="game-hero-badges">
                    {#each tags as tag}
                        <span class="game-badge">{tag}</span>
                    {/each}
                </div>
            {/if}
            <!-- Mobile portrait only: ProtonDB badge + loading status above the data panel -->
            <div class="hero-mobile-score-strip">
                {#if badgeVisible && sections.length > 0}
                    <div class="update-badge update-badge--cells" class:update-badge--gone={badgeGone}>
                        {#each sections as s (s.label)}
                            <div class="update-cell" class:update-cell--done={s.done}>
                                <span class="update-cell-dot"></span>
                                <span class="update-cell-label">{s.label}</span>
                            </div>
                        {/each}
                    </div>
                {/if}
                {#if protonTier}
                    <a class="proton-badge proton-badge--{protonTier}" href="https://www.protondb.com/app/{game?.appid}" target="_blank" rel="noopener noreferrer" title="ProtonDB — {protonCap(protonTier)}">
                        <span class="proton-badge-tier">{protonCap(protonTier)}</span>
                        <span class="proton-badge-icon">{@html SVG_AWARD}</span>
                        <span class="proton-badge-sub">Linux / Proton</span>
                    </a>
                {/if}
            </div>
        </div>
        <div class="game-hero-right">
            <div class="game-data-panel">
                <div class="game-panel-badges">
                    {#if badgeVisible && sections.length > 0}
                        <div class="update-badge update-badge--cells" class:update-badge--gone={badgeGone}>
                            {#each sections as s (s.label)}
                                <div class="update-cell" class:update-cell--done={s.done}>
                                    <span class="update-cell-dot"></span>
                                    <span class="update-cell-label">{s.label}</span>
                                </div>
                            {/each}
                        </div>
                    {/if}
                    {#if protonTier}
                        <a class="proton-badge proton-badge--{protonTier}" href="https://www.protondb.com/app/{game?.appid}" target="_blank" rel="noopener noreferrer" title="ProtonDB — {protonCap(protonTier)}">
                            <span class="proton-badge-tier">{protonCap(protonTier)}</span>
                            <span class="proton-badge-icon">{@html SVG_AWARD}</span>
                            <span class="proton-badge-sub">Linux / Proton</span>
                        </a>
                    {/if}
                </div>

                <!-- Score row -->
                <div class="gdp-score-row">
                    <button class="gdp-steam-score-btn"
                            onclick={() => document.getElementById('game-sec-community-reviews')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                        <ScoreChip source="Steam" score={steamRatio} display={steamRatio != null ? Math.round(steamRatio) + '%' : ''} id="gdp-steam-chip" />
                    </button>
                    <ScoreChip source="OpenCritic" score={null} display="" />
                    <ScoreChip source="Metacritic" score={mcScore} display={mcScore != null ? String(mcScore) : ''} />
                </div>

                <!-- Playtime -->
                <div class="gdp-row">
                    <span class="gdp-label">Played</span>
                    <span class="gdp-value">{playerHours > 0 ? fmtHours(playerHours) : 'Not played'}</span>
                </div>

                <!-- HLTB rows -->
                {#if hltbRows.length > 0}
                    <div class="gdp-divider"></div>
                    {#each hltbRows as row}
                        <div class="gdp-row">
                            <span class="gdp-label">{row.label}</span>
                            <span class="gdp-value">{fmtHours(row.h)}</span>
                        </div>
                    {/each}
                {/if}

                <!-- ITAD prices -->
                {#if game}<GdpPrices {itad} {game} />{/if}

                <!-- Release / meta -->
                <div class="gdp-divider"></div>
                {#if game?.store?.releaseDate}
                    {@const rs = game?.store?.categories?.includes('Early Access') ? 'early_access' : 'released'}
                    <div class="gdp-row">
                        <span class="gdp-label">{rs === 'early_access' ? 'Early Access Since' : 'Released'}</span>
                        <span class="gdp-value">{game.store.releaseDate}</span>
                    </div>
                {/if}
                {#if game?.store?.developers?.length}
                    <div class="gdp-row">
                        <span class="gdp-label">Developer</span>
                        <span class="gdp-value">{game.store.developers[0]}</span>
                    </div>
                {/if}
                {#if game?.store?.publishers?.length && game.store.publishers[0] !== game.store.developers?.[0]}
                    <div class="gdp-row">
                        <span class="gdp-label">Publisher</span>
                        <span class="gdp-value">{game.store.publishers[0]}</span>
                    </div>
                {/if}
                {#if platStr}
                    <div class="gdp-row">
                        <span class="gdp-label">Platforms</span>
                        <span class="gdp-value">{platStr}</span>
                    </div>
                {/if}
                <div class="gdp-divider"></div>
                <div class="gdp-row">
                    <span class="gdp-label">Steam ID</span>
                    <span class="gdp-value">
                        <a class="gdp-steam-link" href={steamStoreUrl(game?.appid ?? '')} target="_blank" rel="noopener">{game?.appid} ↗</a>
                    </span>
                </div>

                <div class="game-panel-btns">
                    <a href="/journal/{game?.appid}" class="game-journal-btn">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;vertical-align:middle"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/></svg>
                        Open Journal
                    </a>
                    <a href="/community/{game?.appid}" class="game-journal-btn game-community-btn">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;vertical-align:middle"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        Community
                    </a>

                </div>
            </div>
        </div>
    </div>
</section>
