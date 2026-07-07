<script lang="ts">
    import type { HomeData, MiddleCard, SaleCard } from '../../../routes/+page.server.js'
    import HomeMosaic from './HomeMosaic.svelte'

    let { data }: { data: HomeData } = $props()

    const session     = $derived(data.session)
    const middle      = $derived(data.middle)
    const libPosters  = $derived(data.libPosters)
    const wlPosters   = $derived(data.wlPosters)
    const discPosters = $derived(data.discPosters)

    function resumeWhen(daysAgo: number): string {
        if (daysAgo === 0) return 'Today'
        if (daysAgo === 1) return 'Yesterday'
        return `${daysAgo} days ago`
    }

    function boughtWhen(daysAgo: number): string {
        if (daysAgo === 0) return 'Added today'
        if (daysAgo === 1) return 'Added yesterday'
        return `Added ${daysAgo} days ago`
    }

    const SOURCE_LABELS: Record<string, string> = {
        gamefaqs: 'GameFAQs', ign: 'IGN', steam: 'Steam', game8: 'Game8',
        gamerguides: 'Gamer Guides', fandom: 'Fandom', neoseeker: 'Neoseeker',
    }
    const sourceLabel = (s: string) => SOURCE_LABELS[s] ?? s

    function sessionMeta(s: NonNullable<HomeData['session']>): string {
        const parts = [`${s.hours}h played`]
        if (s.achievements) parts.push(`${s.achievements.unlocked}/${s.achievements.total} 🏆`)
        parts.push(resumeWhen(s.daysAgo))
        return parts.join('  ·  ')
    }
</script>

<div class="home-wrap">
    <div class="home-row" style="grid-template-columns: 1fr 1fr 1fr">

        <!-- ── Left: Sale (streamed, three-tier fallback) ─────────────────────── -->
        {#await data.saleGame}
            <div class="home-card home-card--pending" aria-hidden="true"></div>
        {:then sale}
            {#if sale}
                {@const external = sale.kind === 'sale' && sale.external}
                <a class="home-card"
                   href={sale.kind === 'sale' ? sale.url : `/game/${sale.appid}`}
                   target={external ? '_blank' : null}
                   rel={external ? 'noopener noreferrer' : null}
                   data-game-card data-appid={sale.appid} data-game-name={sale.name}>
                    <div class="home-card-bg" style="background-image:url('{sale.header}')"></div>
                    <div class="home-card-body">
                        {#if sale.kind === 'sale'}
                            <span class="home-chip home-chip--sale">On Sale  −{sale.cut}%</span>
                            <span class="home-card-title">{sale.name}</span>
                            <span class="home-card-meta">{sale.price ? `${sale.price} · ` : ''}{sale.store}</span>
                        {:else if sale.kind === 'waiting'}
                            <span class="home-chip home-chip--waiting">Waiting for Sale</span>
                            <span class="home-card-title">{sale.name}</span>
                            <span class="home-card-meta">On your sales watch</span>
                        {:else}
                            <span class="home-chip home-chip--wishlist">On Your Wishlist</span>
                            <span class="home-card-title">{sale.name}</span>
                            <span class="home-card-meta">Watching for a deal</span>
                        {/if}
                    </div>
                </a>
            {:else}
                <div class="home-card home-card--pending" aria-hidden="true"></div>
            {/if}
        {/await}

        <!-- ── Middle: priority resolver (release → bought → guide → stats) ────── -->
        {#if middle.kind === 'release'}
            <a class="home-card" href="/game/{middle.appid}" data-game-card data-appid={middle.appid} data-game-name={middle.name}>
                <div class="home-card-bg" style="background-image:url('{middle.header}')"></div>
                <div class="home-card-body">
                    <span class="home-chip home-chip--release"><em class="home-chip-icon">★</em> Released Today</span>
                    <span class="home-card-title">{middle.name}</span>
                    <span class="home-card-meta">Available now on Steam</span>
                </div>
            </a>
        {:else if middle.kind === 'bought'}
            <a class="home-card" href="/game/{middle.appid}" data-game-card data-appid={middle.appid} data-game-name={middle.name}>
                <div class="home-card-bg" style="background-image:url('{middle.header}')"></div>
                <div class="home-card-body">
                    <span class="home-chip home-chip--bought">Just Added</span>
                    <span class="home-card-title">{middle.name}</span>
                    <span class="home-card-meta">{boughtWhen(middle.daysAgo)}  ·  Jump in →</span>
                </div>
            </a>
        {:else if middle.kind === 'guide'}
            <a class="home-card" href="/journal/{middle.appid}/guides/{middle.source}/{middle.guideId}" data-game-card data-appid={middle.appid} data-game-name={middle.name}>
                <div class="home-card-bg" style="background-image:url('{middle.header}')"></div>
                <div class="home-card-body">
                    <span class="home-chip home-chip--guide">📖 Guide</span>
                    <span class="home-card-title">{middle.name}</span>
                    <span class="home-card-meta">{middle.title}  ·  {sourceLabel(middle.source)}</span>
                </div>
            </a>
        {:else}
            <div class="home-card home-card--stats">
                <div class="home-card-body home-stats">
                    <span class="home-chip home-chip--stats">✦ Last 30 Days</span>
                    <div class="home-stats-hero">
                        <span class="home-stats-num">{middle.hours}</span>
                        <span class="home-stats-unit">hours played</span>
                    </div>
                    <div class="home-stats-grid">
                        <div class="home-stat"><b>{middle.achievements}</b><span>🏆 unlocked</span></div>
                        <a class="home-stat" href="/my-reviews"><b>{middle.ratings}</b><span>✍ rated</span></a>
                        <a class="home-stat" href="/library"><b>{middle.added}</b><span>🛒 added</span></a>
                        <a class="home-stat" href="/wishlist"><b>{middle.wishlisted}</b><span>❤ wishlisted</span></a>
                    </div>
                </div>
            </div>
        {/if}

        <!-- ── Right: Session (always shown when any unfiltered play history) ──── -->
        {#if session}
            <a class="home-card" href="/game/{session.appid}" data-game-card data-appid={session.appid} data-game-name={session.name}>
                <div class="home-card-bg" style="background-image:url('{session.header}')"></div>
                <div class="home-card-body">
                    <span class="home-chip home-chip--resume">▶ Resume</span>
                    <span class="home-card-title">{session.name}</span>
                    <span class="home-card-meta">{sessionMeta(session)}</span>
                </div>
            </a>
        {:else}
            <div class="home-card home-card--pending" aria-hidden="true"></div>
        {/if}
    </div>

    <div class="home-row" style="grid-template-columns: 1fr 1fr 1fr">
        {#each [
            { href: '/library',  label: 'View Library',   posters: libPosters,  cols: 3 as const },
            { href: '/wishlist', label: 'View Wishlist',  posters: wlPosters,   cols: 3 as const },
            { href: '/discover', label: 'Discover Games', posters: discPosters, cols: 2 as const },
        ] as card}
            <div class="home-card home-card--anchor">
                <HomeMosaic posters={card.posters} cols={card.cols} />
                <div class="home-card-body">
                    <a class="home-anchor-label" href={card.href}>{card.label}</a>
                </div>
            </div>
        {/each}
    </div>
</div>
