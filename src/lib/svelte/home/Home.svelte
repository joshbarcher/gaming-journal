<script lang="ts">
    import type { HomeData } from '../../../routes/+page.server.js'
    import HomeMosaic from './HomeMosaic.svelte'
    import HomeGuideCard from './HomeGuideCard.svelte'

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

    function sessionMeta(s: NonNullable<HomeData['session']>): string {
        const parts = [`${s.hours}h played`]
        if (s.achievements) parts.push(`${s.achievements.unlocked}/${s.achievements.total} 🏆`)
        parts.push(resumeWhen(s.daysAgo))
        return parts.join('  ·  ')
    }
</script>

<div class="home-wrap">
    <div class="home-row" style="grid-template-columns: 1fr 1fr">

        <!-- ── Left: priority resolver (release → bought → guide → stats) ──────── -->
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
            <HomeGuideCard appid={middle.appid} name={middle.name} header={middle.header} guide={middle.guide} />
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

        <!-- ── Right: Session (filter-aware last played) ──────────────────────── -->
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
