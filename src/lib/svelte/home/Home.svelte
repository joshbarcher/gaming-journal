<script lang="ts">
    import type { HomeData } from '../../../routes/+page.server.js'
    import type { AlertResult } from '../../types.js'

    let { data }: { data: HomeData } = $props()

    const resume      = $derived(data.resume)
    const release     = $derived(data.release)
    const libPosters  = $derived(data.libPosters)
    const wlPosters   = $derived(data.wlPosters)
    const discPosters = $derived(data.discPosters)

    function resumeWhen(daysAgo: number): string {
        if (daysAgo === 0) return 'Today'
        if (daysAgo === 1) return 'Yesterday'
        return `${daysAgo} days ago`
    }

    const staticConditionals = $derived([release, resume].filter(Boolean))
    const hasConditional     = $derived(staticConditionals.length > 0)
</script>

<div class="home-wrap" class:home-wrap--solo={!hasConditional}>
    {#await data.saleGame}
        {#if hasConditional}
            <div class="home-row" style="grid-template-columns: repeat({staticConditionals.length}, 1fr)">
                {#if release}
                    <a class="home-card" href="/game/{release.appid}">
                        <div class="home-card-bg" style="background-image:url('{release.header}')"></div>
                        <div class="home-card-body">
                            <span class="home-chip home-chip--release"><em class="home-chip-icon">★</em> Released Today</span>
                            <span class="home-card-title">{release.name}</span>
                            <span class="home-card-meta">Available now on Steam</span>
                        </div>
                    </a>
                {/if}
                {#if resume}
                    <a class="home-card" href="/game/{resume.appid}">
                        <div class="home-card-bg" style="background-image:url('{resume.header}')"></div>
                        <div class="home-card-body">
                            <span class="home-chip home-chip--resume">▶ Resume</span>
                            <span class="home-card-title">{resume.name}</span>
                            <span class="home-card-meta">{resume.hours}h played · last played {resumeWhen(resume.daysAgo)}</span>
                        </div>
                    </a>
                {/if}
            </div>
        {/if}
    {:then saleGame}
        {@const allConditionals = [release, saleGame, resume].filter(Boolean)}
        {#if allConditionals.length > 0}
            <div class="home-row" style="grid-template-columns: repeat({allConditionals.length}, 1fr)">
                {#if release}
                    <a class="home-card" href="/game/{release.appid}">
                        <div class="home-card-bg" style="background-image:url('{release.header}')"></div>
                        <div class="home-card-body">
                            <span class="home-chip home-chip--release"><em class="home-chip-icon">★</em> Released Today</span>
                            <span class="home-card-title">{release.name}</span>
                            <span class="home-card-meta">Available now on Steam</span>
                        </div>
                    </a>
                {/if}
                {#if saleGame}
                    {@const cut      = saleGame.bestPrice?.cut   ?? 0}
                    {@const url      = saleGame.bestPrice?.url   ?? `/game/${saleGame.appid}`}
                    {@const store    = saleGame.bestPrice?.store ?? ''}
                    {@const price    = saleGame.bestPrice?.price != null ? `$${saleGame.bestPrice.price.toFixed(2)}` : ''}
                    {@const external = url.startsWith('http')}
                    <a class="home-card" href={url}
                       target={external ? '_blank' : null}
                       rel={external ? 'noopener noreferrer' : null}>
                        <div class="home-card-bg" style="background-image:url('/relay/images/steam/games/{saleGame.appid}/header.jpg')"></div>
                        <div class="home-card-body">
                            <span class="home-chip home-chip--sale">On Sale  −{cut}%</span>
                            <span class="home-card-title">{saleGame.name}</span>
                            <span class="home-card-meta">{price ? `${price} · ` : ''}{store}</span>
                        </div>
                    </a>
                {/if}
                {#if resume}
                    <a class="home-card" href="/game/{resume.appid}">
                        <div class="home-card-bg" style="background-image:url('{resume.header}')"></div>
                        <div class="home-card-body">
                            <span class="home-chip home-chip--resume">▶ Resume</span>
                            <span class="home-card-title">{resume.name}</span>
                            <span class="home-card-meta">{resume.hours}h played · last played {resumeWhen(resume.daysAgo)}</span>
                        </div>
                    </a>
                {/if}
            </div>
        {/if}
    {/await}

    <div class="home-row" style="grid-template-columns: 1fr 1fr 1fr">
        {#each [
            { href: '/library',  label: 'View Library',   posters: libPosters  },
            { href: '/wishlist', label: 'View Wishlist',  posters: wlPosters   },
            { href: '/discover', label: 'Discover Games', posters: discPosters },
        ] as card}
            <a class="home-card home-card--anchor" href={card.href}>
                <div class="home-mosaic">
                    {#each card.posters as poster}
                        <img class="home-mosaic-img"
                             src={poster.header}
                             alt=""
                             loading="lazy"
                             onerror={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}>
                    {/each}
                </div>
                <div class="home-card-body">
                    <span class="home-anchor-label">{card.label}</span>
                </div>
            </a>
        {/each}
    </div>
</div>
