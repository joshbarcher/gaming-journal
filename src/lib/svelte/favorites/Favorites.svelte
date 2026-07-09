<script lang="ts">
    import { onMount } from 'svelte'
    import { loadGameFilter } from '../../js/views/game-filter.js'
    import type { SteamGame, LocalReview, Flags, FlagKey, CommunityReviews } from '../../types.js'

    let games         = $state<SteamGame[]>([])
    let loading       = $state(true)
    let error         = $state<string | null>(null)
    let hero          = $state<SteamGame | null>(null)
    let rest          = $state<SteamGame[]>([])
    let heroReview    = $state<LocalReview | null>(null)
    let heroFlags     = $state<Flags | null>(null)
    let heroHltb      = $state<SteamGame['hltb'] | null>(null)
    let heroCommunity = $state<CommunityReviews | null>(null)
    let bgA           = $state<HTMLElement | null>(null)
    let bgB           = $state<HTMLElement | null>(null)

    let totalMins = $derived(games.reduce((s, g) => s + (g.playtime ?? 0), 0))
    let subtitle  = $derived(`${games.length} game${games.length !== 1 ? 's' : ''} · ${fmtHours(totalMins) ?? '0h'} played`)

    function fmtHours(mins: number | null | undefined) {
        if (!mins) return null
        const h = mins / 60
        if (h < 1)  return `${Math.round(mins)}m`
        if (h < 10) return `${h.toFixed(1)}h`
        return `${Math.round(h)}h`
    }

    function starStr(n: number | null | undefined) {
        if (!n) return null
        const display = Math.min(n, 5)
        return '★'.repeat(display) + '☆'.repeat(5 - display) + (n > 5 ? ' ✦' : '')
    }

    // Slideshow: runs when bgA and bgB elements are available and hero is set
    $effect(() => {
        if (!bgA || !bgB || !hero) return
        const bgAEl = bgA, bgBEl = bgB

        const appid    = hero.appid
        const INTERVAL = 14000
        const PAN_DUR  = 10000
        let stopped    = false
        let timer: ReturnType<typeof setInterval> | null = null

        const randDir = () => Math.random() < 0.5 ? 'top' : 'bottom'

        function pan(el: HTMLElement, dir: string) {
            requestAnimationFrame(() => requestAnimationFrame(() => {
                el.style.transition         = `opacity 1.5s ease, background-position ${PAN_DUR}ms linear`
                el.style.backgroundPosition = `center ${dir}`
            }))
        }

        async function start() {
            const candidates = Array.from({ length: 20 }, (_, i) =>
                `/relay/images/steam/screenshots/${appid}/${i}.jpg`
            )
            const screenshots = (await Promise.all(
                candidates.map(url => new Promise(resolve => {
                    const img   = new Image()
                    img.onload  = () => resolve(url)
                    img.onerror = () => resolve(null)
                    img.src     = url
                }))
            )).filter(Boolean)

            if (stopped) return

            const headerUrl = `/relay/images/steam/games/${appid}/header.jpg`
            const frames    = [...screenshots.sort(() => Math.random() - 0.5), headerUrl]

            bgAEl.style.backgroundImage = `url('${frames[0]}')`
            pan(bgAEl, randDir())

            let idx      = 1
            let showingA = true

            timer = setInterval(() => {
                if (stopped) { clearInterval(timer ?? undefined); return }
                const url      = frames[idx % frames.length]
                const dir      = randDir()
                const incoming = (showingA ? bgBEl : bgAEl)!
                const outgoing = (showingA ? bgAEl : bgBEl)!
                idx++

                incoming.style.transition         = 'none'
                incoming.style.backgroundImage    = `url('${url}')`
                incoming.style.backgroundPosition = 'center center'
                incoming.style.opacity            = '0'

                requestAnimationFrame(() => requestAnimationFrame(() => {
                    if (stopped) return
                    incoming.style.transition         = `opacity 1.5s ease, background-position ${PAN_DUR}ms linear`
                    incoming.style.opacity            = '1'
                    incoming.style.backgroundPosition = `center ${dir}`
                    outgoing.style.opacity            = '0'
                }))

                showingA = !showingA
            }, INTERVAL)
        }

        start()
        return () => { stopped = true; if (timer) clearInterval(timer) }
    })

    onMount(async () => {
        try {
            const [flagsRes, gamesRes, shouldShow] = await Promise.all([
                fetch('/api/flags'),
                fetch('/relay/api/steam/games'),
                loadGameFilter(),
            ])
            if (!flagsRes.ok) throw new Error(`Flags HTTP ${flagsRes.status}`)
            if (!gamesRes.ok) throw new Error(`Games HTTP ${gamesRes.status}`)

            const flags    = await flagsRes.json()
            const gamesRaw = await gamesRes.json()
            const owned    = Array.isArray(gamesRaw) ? gamesRaw : (gamesRaw.games ?? [])
            const ownedMap = new Map<number, SteamGame>(owned.map((g: SteamGame) => [g.appid, g]))
            const ids      = Object.entries(flags as Record<string, any>).filter(([, f]) => f.favorite).map(([id]) => Number(id)).filter(appid => shouldShow(appid))

            if (!ids.length) { loading = false; return }

            // Render immediately with library data; non-library names fill in via background
            games = ids.map(appid => {
                const o = ownedMap.get(appid)
                return { appid, name: o?.name ?? `App ${appid}`, playtime: o?.playtime_forever ?? 0 } as SteamGame
            }).sort((a, b) => (b.playtime ?? 0) - (a.playtime ?? 0))

            const heroIdx = Math.floor(Math.random() * games.length)
            hero    = games[heroIdx]
            rest    = games.filter((_, i) => i !== heroIdx)
            loading = false

            // Background: missing names for non-library games
            for (const appid of ids) {
                if (!ownedMap.has(appid)) {
                    fetch(`/relay/api/games/${appid}`)
                        .then(r => r.ok ? r.json() : null)
                        .then(d => {
                            if (!d?.name) return
                            const idx = games.findIndex(g => g.appid === appid)
                            if (idx !== -1) games[idx] = { ...games[idx], name: d.name }
                            if (hero?.appid === appid) hero = { ...hero!, name: d.name }
                        })
                        .catch(() => {})
                }
            }

            // Background: hero detail (review, flags, HLTB, community reviews)
            const heroAppid = hero.appid
            Promise.all([
                fetch(`/api/local-reviews/${heroAppid}`),
                fetch(`/api/flags/${heroAppid}`),
                fetch(`/relay/api/hltb/${heroAppid}`),
                fetch(`/relay/api/steam/community-reviews/${heroAppid}`),
            ]).then(async ([reviewRes, flagRes, hltbRes, communityRes]) => {
                heroReview    = reviewRes.ok    ? await reviewRes.json()    : null
                heroFlags     = flagRes.ok      ? await flagRes.json()      : null
                heroHltb      = hltbRes.ok      ? await hltbRes.json()      : null
                heroCommunity = communityRes.ok ? await communityRes.json() : null
            }).catch(() => {})
        } catch (err) {
            error   = (err as Error).message
            loading = false
        }
    })
</script>

{#if loading}
    <p class="page-loading">Loading Favorites…</p>
{:else if error}
    <p class="page-error">Failed to load: {error}</p>
{:else}
    <div class="fav-header">
        <div class="fav-header-body">
            <p class="fav-eyebrow">Collection</p>
            <h1 class="fav-title">Favorites</h1>
            {#if games.length}<p class="fav-subtitle">{subtitle}</p>{/if}
        </div>
    </div>
    {#if !games.length}
        <p class="page-empty" style="padding:40px">
            No favorites yet. Open any game page and toggle the
            <strong>Favorite</strong> flag to add it here.
        </p>
    {:else}
        <div class="fav-grid">
            {#if hero}
                {@const img        = `/relay/images/steam/games/${hero.appid}/header.jpg`}
                {@const hours      = fmtHours(hero.playtime)}
                {@const hltbVal    = heroHltb?.matched && heroHltb.gameplayMain != null ? `~${Math.round(heroHltb.gameplayMain)}h` : '—'}
                {@const steamRatio = heroCommunity?.summary?.ratio != null ? `${Math.round(heroCommunity.summary.ratio)}%` : '—'}
                {@const chips      = [
                    { val: hours ?? '—',                      label: 'Played', accent: true },
                    { val: starStr(heroReview?.stars) ?? '—', label: 'Rating' },
                    { val: steamRatio,                        label: 'Steam'  },
                    { val: hltbVal,                           label: 'HLTB'   },
                ]}
                {@const flagLabels = { completed: 'Completed', revisit: 'Revisit', inProgress: 'In Progress', dropped: 'Dropped' }}
                {@const activeTags = Object.entries(flagLabels).filter(([k]) => heroFlags?.[k as FlagKey]).map(([, label]) => label)}
                {@const quote      = heroReview?.review ?? null}
                <a class="fav-hero" href="/game/{hero.appid}" data-game-card data-appid={hero.appid} data-game-name={hero.name}>
                    <div class="fav-hero-art">
                        <div class="fav-hero-bg-wrap">
                            <div class="fav-hero-bg fav-hero-bg--a"
                                 style="background-image:url('{img}')"
                                 bind:this={bgA}></div>
                            <div class="fav-hero-bg fav-hero-bg--b" bind:this={bgB}></div>
                        </div>
                        <div class="fav-hero-scrim"></div>
                        <div class="fav-hero-shine"></div>
                        <div class="fav-hero-body">
                            <span class="fav-hearts" aria-hidden="true">
                                {#each { length: 5 } as _}<span class="fav-heart fav-heart--filled">♥</span>{/each}
                            </span>
                            <h2 class="fav-hero-name">{hero.name}</h2>
                        </div>
                    </div>
                    <div class="fav-hero-chips">
                        {#each chips as chip}
                            <div class="fav-hero-chip">
                                <span class="fav-hero-chip-val{chip.accent ? ' fav-hero-chip-val--accent' : ''}">{chip.val}</span>
                                <span class="fav-hero-chip-label">{chip.label}</span>
                            </div>
                        {/each}
                    </div>
                    {#if activeTags.length}
                        <div class="fav-hero-tags">
                            {#each activeTags as tag}<span class="fav-hero-tag">{tag}</span>{/each}
                        </div>
                    {/if}
                    {#if quote}<p class="fav-hero-quote">{quote}</p>{/if}
                </a>
            {/if}
            {#each rest as g (g.appid)}
                {@const hours = fmtHours(g.playtime)}
                <a class="fav-card" href="/game/{g.appid}" data-game-card data-appid={g.appid} data-game-name={g.name}>
                    <div class="fav-card-img-wrap">
                        <img class="fav-card-img"
                             src="/relay/images/steam/games/{g.appid}/header.jpg"
                             alt="" loading="lazy" onerror={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0' }}>
                        <div class="fav-card-shine"></div>
                        {#if hours}<span class="fav-card-hours">{hours}</span>{/if}
                    </div>
                    <div class="fav-card-body">
                        <span class="fav-card-name">{g.name}</span>
                        <span class="fav-hearts" aria-hidden="true">
                            {#each { length: 5 } as _}<span class="fav-heart fav-heart--filled">♥</span>{/each}
                        </span>
                    </div>
                </a>
            {/each}
        </div>
    {/if}
{/if}
