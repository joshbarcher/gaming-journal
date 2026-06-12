<script>
    import { onMount } from 'svelte'
    import { loadGameFilter } from '../../js/views/game-filter.js'

    const RESUME_WINDOW_S = 7 * 24 * 60 * 60
    const MOSAIC_COUNT    = 6

    let loading     = $state(true)
    let releaseGame = $state(null)
    let saleGame    = $state(null)
    let resumeGame  = $state(null)
    let resumeSteam = $state(null)
    let libPosters  = $state([])
    let wlPosters   = $state([])
    let discPosters = $state([])

    function heroBg(game) {
        return game.media?.header ?? `/relay/images/steam/games/${game.appid}/header.jpg`
    }

    function resumeWhen(sg) {
        const days = Math.floor((Date.now() / 1000 - (sg?.rtime_last_played ?? 0)) / 86400)
        return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`
    }

    function resumeHours(sg, game) {
        return ((sg?.playtime_forever ?? game?.playtimeMinutes ?? 0) / 60).toFixed(1)
    }

    function isToday(game) {
        const str = game.store?.releaseDate
        if (!str) return false
        const parsed = new Date(str)
        if (isNaN(parsed.getTime())) return false
        const now = new Date()
        return parsed.getDate() === now.getDate() && parsed.getMonth() === now.getMonth() && parsed.getFullYear() === now.getFullYear()
    }

    function sample(arr, n) {
        if (!arr?.length) return []
        const copy = [...arr]
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]]
        }
        return copy.slice(0, n)
    }

    function unwrapLibrary(json) {
        if (!json) return []
        if (Array.isArray(json))                                 return json
        if (Array.isArray(json.games))                           return json.games
        if (Array.isArray(json.data))                            return json.data
        if (json.response && Array.isArray(json.response.games)) return json.response.games
        return []
    }

    onMount(async () => {
        const [allGamesRes, steamRes, alertsRes, discRes, shouldShowRes, lastPlayedRes] = await Promise.allSettled([
            fetch('/relay/api/games').then(r => r.ok ? r.json() : null),
            fetch('/relay/api/steam/games').then(r => r.ok ? r.json() : null),
            fetch('/api/alerts').then(r => r.ok ? r.json() : null),
            fetch('/relay/api/discover/featured').then(r => r.ok ? r.json() : null),
            loadGameFilter(),
            fetch('/relay/api/steam/playtime/last-played').then(r => r.ok ? r.json() : null),
        ])

        const allGames      = Array.isArray(allGamesRes.value) ? allGamesRes.value : []
        const filterFn      = shouldShowRes.value ?? (() => true)
        const rawSteamLib   = unwrapLibrary(steamRes.value)
        const alerts        = alertsRes.value   ?? {}
        const discover      = discRes.value     ?? []
        const lastPlayedMap = lastPlayedRes.value ?? {}

        const steamLib = rawSteamLib
            .map(g => {
                const relay = lastPlayedMap[g.appid]
                if (!relay) return g
                const patched = { ...g }
                const relaySec = Math.floor(new Date(relay.lastPlayedAt).getTime() / 1000)
                if (relaySec > (g.rtime_last_played ?? 0)) patched.rtime_last_played = relaySec
                patched.playtime_forever = relay.effectiveMin
                return patched
            })
            .filter(g => filterFn(g.appid))

        const libGames = allGames.filter(g => g.source === 'library' || g.source === 'both')
        const wlGames  = allGames.filter(g => g.source === 'wishlist' || g.source === 'both')

        releaseGame = libGames.find(isToday) ?? wlGames.find(isToday) ?? null

        const onSale = alerts.onSale ?? []
        saleGame     = onSale.length ? onSale[Math.floor(Math.random() * onSale.length)] : null

        const nowSec = Math.floor(Date.now() / 1000)
        const rs     = steamLib
            .filter(g => g.rtime_last_played && (nowSec - g.rtime_last_played) < RESUME_WINDOW_S)
            .sort((a, b) => b.rtime_last_played - a.rtime_last_played)[0] ?? null
        resumeSteam = rs
        resumeGame  = rs ? { ...rs, ...(allGames.find(g => String(g.appid) === String(rs.appid)) ?? {}) } : null

        libPosters  = sample(libGames.filter(g => filterFn(g.appid)), MOSAIC_COUNT)
        wlPosters   = sample(wlGames.filter(g => filterFn(g.appid)),  MOSAIC_COUNT)
        const discItems = discover.flatMap(s => s.items ?? [])
        discPosters = sample(discItems, MOSAIC_COUNT).map(g => ({
            src:      g.posterImage ?? g.headerImage ?? null,
            fallback: g.headerImage ?? null,
        }))

        loading = false
    })
</script>

{#if loading}
    <p class="page-loading">Loading…</p>
{:else}
    {@const conditionals = [releaseGame, saleGame, resumeGame].filter(Boolean)}
    {@const hasConditional = conditionals.length > 0}
    <div class="home-wrap" class:home-wrap--solo={!hasConditional}>
        {#if hasConditional}
            <div class="home-row" style="grid-template-columns: repeat({conditionals.length}, 1fr)">
                {#if releaseGame}
                    <a class="home-card" href="/game/{releaseGame.appid}">
                        <div class="home-card-bg" style="background-image:url('{heroBg(releaseGame)}')"></div>
                        <div class="home-card-body">
                            <span class="home-chip home-chip--release"><em class="home-chip-icon">★</em> Released Today</span>
                            <span class="home-card-title">{releaseGame.name}</span>
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
                {#if resumeGame}
                    <a class="home-card" href="/game/{resumeGame.appid}">
                        <div class="home-card-bg" style="background-image:url('{heroBg(resumeGame)}')"></div>
                        <div class="home-card-body">
                            <span class="home-chip home-chip--resume">▶ Resume</span>
                            <span class="home-card-title">{resumeGame.name}</span>
                            <span class="home-card-meta">{resumeHours(resumeSteam, resumeGame)}h played · last played {resumeWhen(resumeSteam)}</span>
                        </div>
                    </a>
                {/if}
            </div>
        {/if}

        <div class="home-row" style="grid-template-columns: 1fr 1fr 1fr">
            {#each [
                { href: '/library',  label: 'View Library',   posters: libPosters  },
                { href: '/wishlist', label: 'View Wishlist',  posters: wlPosters   },
                { href: '/discover', label: 'Discover Games', posters: discPosters },
            ] as card}
                <a class="home-card home-card--anchor" href={card.href}>
                    <div class="home-mosaic">
                        {#each card.posters as poster}
                            {#if poster?.src}
                                <img class="home-mosaic-img" src={poster.src} alt="" loading="lazy"
                                     onerror={(e) => {
                                         e.currentTarget.onerror = null
                                         if (poster.fallback && poster.fallback !== poster.src) {
                                             e.currentTarget.src = poster.fallback
                                         } else {
                                             e.currentTarget.style.visibility = 'hidden'
                                         }
                                     }}>
                            {:else if poster?.appid}
                                <img class="home-mosaic-img"
                                     src="/relay/images/steam/games/{poster.appid}/poster.jpg"
                                     alt="" loading="lazy"
                                     onerror={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = `/relay/images/steam/games/${poster.appid}/header.jpg` }}>
                            {:else}
                                <div class="home-mosaic-img" style="background:#111"></div>
                            {/if}
                        {/each}
                    </div>
                    <div class="home-card-body">
                        <span class="home-anchor-label">{card.label}</span>
                    </div>
                </a>
            {/each}
        </div>
    </div>
{/if}
