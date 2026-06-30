<script lang="ts">
    import { onMount, onDestroy } from 'svelte'
    import type { SteamGame, CommunityReviews, SteamUserReviewEntry, PlayerCounts, Flags, LocalReview, Trailer, ItadData, ProtonData, PcgwData, NewsData } from '../../types.js'
    import { escapeHtml } from '../../js/utils.js'
    import { navigate } from '../../js/router.js'
    import { openReviewModal } from '../../js/review-modal.js'
    import { releaseStatus, newsBBCodeDirty } from '../../js/views/game-render.js'
    import GameHero from './GameHero.svelte'
    import FlagsBar from './FlagsBar.svelte'
    import HltbSection from './HltbSection.svelte'
    import PlayerChart from './PlayerChart.svelte'
    import NavRail from './NavRail.svelte'
    import ReleaseBanner from './sections/ReleaseBanner.svelte'
    import About from './sections/About.svelte'
    import Trailers from './sections/Trailers.svelte'
    import Screenshots from './sections/Screenshots.svelte'
    import News from './sections/News.svelte'
    import LocalReviewCard from './sections/LocalReviewCard.svelte'
    import MyReview from './sections/MyReview.svelte'
    import CommunityReviewsSection from './sections/CommunityReviews.svelte'
    import ItadPrices from './sections/ItadPrices.svelte'
    import ProtonDB from './sections/ProtonDB.svelte'
    import PCGW from './sections/PCGW.svelte'

    let { appid } = $props()

    // ── Phase 1 state (fast fetches) ─────────────────────────────────────────
    let game             = $state<SteamGame | null>(null)
    let communityReviews = $state<CommunityReviews | null>(null)
    let myReview         = $state<SteamUserReviewEntry | null>(null)
    let playerCounts     = $state<PlayerCounts | null>(null)
    let flags            = $state<Flags>({})
    let localReview      = $state<LocalReview | null>(null)
    let trailers         = $state<Trailer[]>([])
    let localWishlisted  = $state(false)
    let loading          = $state(true)
    let phase1Sections   = $state([
        { label: 'Game',      done: false },
        { label: 'Community', done: false },
        { label: 'Reviews',   done: false },
        { label: 'Players',   done: false },
        { label: 'Flags',     done: false },
        { label: 'Journal',   done: false },
        { label: 'Trailers',  done: false },
        { label: 'Wishlist',  done: false },
    ])
    let error            = $state<string | null>(null)

    // ── Phase 2 state (background loads) ─────────────────────────────────────
    // undefined = not yet fetched (show pending), null = fetched but no data, object = data
    let hltbData    = $state<SteamGame['hltb'] | null | undefined>(undefined)
    let itadData    = $state<ItadData | null | undefined>(undefined)
    let protonData  = $state<ProtonData | null | undefined>(undefined)
    let pcgwData    = $state<PcgwData | null | undefined>(undefined)
    let newsData    = $state<NewsData | null | undefined>(undefined)
    let bgPending    = $state(0)
    let hltbNeeded   = $state(false)
    let itadNeeded   = $state(false)
    let pcgwNeeded   = $state(false)
    let phase2Active = $state(false)

    interface Section { label: string; done: boolean }
    let phase2Sections = $derived<Section[]>(
        !phase2Active ? [] : [
            ...(hltbNeeded ? [{ label: 'HLTB',   done: hltbData   !== undefined }] : []),
            ...(itadNeeded ? [{ label: 'ITAD',   done: itadData   !== undefined }] : []),
            ...(pcgwNeeded ? [{ label: 'PCGW',   done: pcgwData   !== undefined }] : []),
            { label: 'Proton', done: protonData !== undefined },
            { label: 'News',   done: newsData   !== undefined },
        ]
    )

    // Effective HLTB: prefer background load; return undefined (show spinner) while Phase 2
    // is actively fetching and Phase 1 had no matched result to fall back to.
    let effectiveHltb = $derived(
        hltbData !== undefined ? hltbData :
        (hltbNeeded && !game?.hltb?.matched) ? undefined :
        game?.hltb
    )
    // Effective ITAD: undefined → spinner while Phase 2 fetching and no Phase 1 fallback
    let effectiveItad = $derived(
        itadData !== undefined ? itadData :
        (itadNeeded && !game?.itad) ? undefined :
        game?.itad
    )

    // ── Screenshot modal ──────────────────────────────────────────────────────
    let _modalEl: HTMLElement | null = null, _modalSrcs: string[] = [], _modalIdx = 0

    function _modalNav(delta: number) {
        _modalIdx = (_modalIdx + delta + _modalSrcs.length) % _modalSrcs.length
        ;(_modalEl!.querySelector('.shot-modal-img') as HTMLImageElement).src = _modalSrcs[_modalIdx]
    }
    function _openModal(srcs: string[], idx = 0) {
        if (!_modalEl) {
            _modalEl = document.createElement('div')
            _modalEl.className = 'shot-modal'
            _modalEl.innerHTML = `<div class="shot-modal-backdrop"></div><button class="shot-modal-prev shot-modal-nav" aria-label="Previous">&#8249;</button><img class="shot-modal-img" src="" alt="Screenshot"><button class="shot-modal-next shot-modal-nav" aria-label="Next">&#8250;</button><button class="shot-modal-close" aria-label="Close">✕</button>`
            document.body.appendChild(_modalEl)
            _modalEl.querySelector('.shot-modal-backdrop')!.addEventListener('click', _closeModal)
            _modalEl.querySelector('.shot-modal-close')!.addEventListener('click', _closeModal)
            _modalEl.querySelector('.shot-modal-prev')!.addEventListener('click', () => _modalNav(-1))
            _modalEl.querySelector('.shot-modal-next')!.addEventListener('click', () => _modalNav(1))
            document.addEventListener('keydown', e => {
                if (!_modalEl?.classList.contains('shot-modal--open')) return
                if (e.key === 'Escape')     _closeModal()
                if (e.key === 'ArrowLeft')  _modalNav(-1)
                if (e.key === 'ArrowRight') _modalNav(1)
            })
            window.addEventListener('popstate', () => _closeModal())
        }
        _modalSrcs = srcs
        _modalIdx  = idx
        ;(_modalEl!.querySelector('.shot-modal-img') as HTMLImageElement).src = srcs[idx]
        const hidden = srcs.length <= 1
        ;(_modalEl!.querySelector('.shot-modal-prev') as HTMLElement).style.display = hidden ? 'none' : ''
        ;(_modalEl!.querySelector('.shot-modal-next') as HTMLElement).style.display = hidden ? 'none' : ''
        _modalEl!.classList.add('shot-modal--open')
    }
    function _closeModal() { _modalEl?.classList.remove('shot-modal--open') }

    // ── Worker manager ────────────────────────────────────────────────────────
    const workerMgr = (() => {
        let _w: Worker | null = null, _seq = 0
        const _cbs: Map<number, (data: any) => void> = new Map()
        const _ok  = typeof Worker !== 'undefined'

        function _boot() {
            if (_w) return _w
            _w = new Worker(new URL('../../workers/game-refresh.worker.js', import.meta.url))
            _w.onmessage = ({ data }) => { const cb = _cbs.get(data.id); if (cb) { _cbs.delete(data.id); cb(data) } }
            _w.onerror   = ()       => { for (const [id, cb] of _cbs) { _cbs.delete(id); cb({ id, data: null }) } }
            return _w
        }
        function _post(msg: any): Promise<any> {
            return new Promise<any>(resolve => { const id = _seq++; _cbs.set(id, resolve); _boot().postMessage({ ...msg, id }) })
        }
        async function _mainGet(url: string) { try { const r = await fetch(url); return { data: r.ok ? await r.json() : null } } catch { return { data: null } } }
        async function _mainPostGet(pu: string, gu: string) { try { await fetch(pu, { method: 'POST' }); const r = await fetch(gu); return { data: r.ok ? await r.json() : null } } catch { return { data: null } } }

        return {
            fetch(url: string)                        { return _ok ? _post({ type: 'get',      url })             : _mainGet(url) },
            sync(postUrl: string, getUrl: string)     { return _ok ? _post({ type: 'post_get', postUrl, getUrl }) : _mainPostGet(postUrl, getUrl) },
        }
    })()

    // ── Container ref (for NavRail) ───────────────────────────────────────────
    let containerEl = $state<HTMLElement | null>(null)

    // ── Refresh callbacks wired to workerMgr ──────────────────────────────────
    async function refreshItad() {
        const { data } = await workerMgr.sync(`/relay/api/itad/sync/${appid}?force=true`, `/relay/api/itad/${appid}`)
        itadData = data ?? {}
    }

    async function refreshProton() {
        const { data } = await workerMgr.sync(`/relay/api/protondb/sync/${appid}?force=true`, `/relay/api/protondb/${appid}`)
        protonData = (data?.notFound || !data?.tier) ? null : data
    }

    async function refreshPcgw() {
        const { data } = await workerMgr.sync(`/relay/api/pcgw/sync/${appid}?force=true`, `/relay/api/pcgw/${appid}`)
        pcgwData = data?.found ? data : null
    }

    // ── Community btn navigation ──────────────────────────────────────────────
    function handleCommunityClick(e: MouseEvent) {
        e.preventDefault()
        e.stopPropagation()
        sessionStorage.setItem('gj_game_from', 'game')
        navigate(`community/${appid}`)
    }

    // ── Local Review ──────────────────────────────────────────────────────────
    async function openLocalReview() {
        const res = await fetch(`/api/local-reviews/${appid}`)
        const existing = res.ok ? await res.json() : null
        const saved = await openReviewModal(appid, game?.name ?? 'Game', existing)
        if (saved) {
            const fresh = await fetch(`/api/local-reviews/${appid}`)
            localReview = fresh.ok ? await fresh.json() : null
        }
    }

    function tracked(p: Promise<Response>, label: string): Promise<Response> {
        return p.then(r => {
            const idx = phase1Sections.findIndex(s => s.label === label)
            if (idx !== -1) phase1Sections[idx] = { ...phase1Sections[idx], done: true }
            return r
        })
    }

    // ── Phase 1: fast data fetch ──────────────────────────────────────────────
    onMount(async () => {
        document.getElementById('main-content')?.classList.add('has-game-hero')
        try {
            const [gameRes, crRes, mrRes, pcRes, flagsRes, localRevRes, trailersRes, localWlRes] = await Promise.all([
                tracked(fetch(`/relay/api/games/${appid}`),                       'Game'),
                tracked(fetch(`/relay/api/steam/community-reviews/${appid}`),     'Community'),
                tracked(fetch(`/relay/api/steam/reviews/${appid}`),               'Reviews'),
                tracked(fetch(`/relay/api/player-counts/${appid}`),               'Players'),
                tracked(fetch(`/api/flags/${appid}`),                             'Flags'),
                tracked(fetch(`/api/local-reviews/${appid}`),                     'Journal'),
                tracked(fetch(`/relay/api/videos/${appid}`),                      'Trailers'),
                tracked(fetch(`/api/local-wishlist/${appid}`),                    'Wishlist'),
            ])
            if (!gameRes.ok) throw new Error(gameRes.status === 404 ? 'Game not found' : `HTTP ${gameRes.status}`)

            game             = await gameRes.json()
            communityReviews = crRes.ok      ? await crRes.json()              : null
            myReview         = mrRes.ok      ? await mrRes.json()              : null
            playerCounts     = pcRes.ok      ? await pcRes.json()              : null
            flags            = flagsRes.ok   ? await flagsRes.json()           : {}
            localReview      = localRevRes.ok ? await localRevRes.json()       : null
            trailers         = trailersRes.ok ? await trailersRes.json()       : []
            localWishlisted  = localWlRes.ok  ? (await localWlRes.json()).wishlisted : false
        } catch (err) {
            error = (err as Error).message
            loading = false
            return
        }
        loading = false
        if (!game) return

        // ── Phase 2: background section loading ───────────────────────────────
        const name    = encodeURIComponent(game.name ?? '')
        const status  = releaseStatus(game)
        const isDisc  = game.source === 'discovered'
        const notSoon = status !== 'coming_soon'
        const needsCommunitySync = communityReviews === null

        const hasHltb = notSoon && !game.hltb?.matched
        const hasItad = true
        const hasPcgw = notSoon
        const hasAbout = !game.store?.detailedDescription && game.store && !game.store.unavailable && !isDisc

        let pending = 5 // protondb, news, reddit, community-sync always count (even if skipped below)
        if (hasHltb)         pending++
        if (hasItad)         pending++
        if (hasPcgw)         pending++
        if (hasAbout)        pending++
        if (!needsCommunitySync) pending-- // reddit + community sync: community-sync only if needed
        bgPending = pending

        hltbNeeded   = hasHltb
        itadNeeded   = hasItad
        pcgwNeeded   = hasPcgw
        phase2Active = true

        const dec = () => { bgPending = Math.max(0, bgPending - 1) }

        // HLTB
        if (hasHltb) {
            ;(async () => {
                try {
                    const { data } = await workerMgr.fetch(`/relay/api/hltb/${appid}?fetch=true&name=${name}`)
                    const hasTimes = data?.matched && (data.gameplayMain ?? data.gameplayMainExtra ?? data.gameplayCompletionist) != null
                    hltbData = hasTimes ? data : null
                } catch { hltbData = null }
                finally { dec() }
            })()
        }

        // ITAD
        ;(async () => {
            try {
                const url = isDisc ? `/relay/api/itad/${appid}?fetch=true&name=${name}` : `/relay/api/itad/${appid}`
                const { data } = await workerMgr.fetch(url)
                itadData = data ?? {}
            } catch { itadData = {} }
            finally { dec() }
        })()

        // PCGW
        if (hasPcgw) {
            ;(async () => {
                try {
                    const url = isDisc ? `/relay/api/pcgw/${appid}?fetch=true&name=${name}` : `/relay/api/pcgw/${appid}`
                    const { data } = await workerMgr.fetch(url)
                    pcgwData = data?.found ? data : null
                } catch { pcgwData = null }
                finally { dec() }
            })()
        }

        // ProtonDB
        ;(async () => {
            try {
                const { data: raw } = await workerMgr.fetch(`/relay/api/protondb/${appid}`)
                protonData = (raw?.notFound || !raw?.tier) ? null : raw
            } catch { protonData = null }
            finally { dec() }
        })()

        // News
        ;(async () => {
            try {
                const { data: raw } = await workerMgr.fetch(`/relay/api/news/${appid}`)
                let news = raw
                if (newsBBCodeDirty(news)) {
                    try {
                        await fetch(`/relay/api/admin/news/${appid}/refresh`, { method: 'POST' })
                        const fresh = await fetch(`/relay/api/news/${appid}`)
                        if (fresh.ok) news = await fresh.json()
                    } catch { /* render whatever we have */ }
                } else {
                    fetch(`/relay/api/admin/news/${appid}/refresh`, { method: 'POST' }).catch(() => {})
                }
                newsData = news
            } catch { newsData = null }
            finally { dec() }
        })()

        // Reddit cache warm (silent, no section)
        ;(async () => {
            try { await workerMgr.fetch(`/relay/api/reddit/${appid}?name=${encodeURIComponent(name)}`) } catch { /* silent */ }
            finally { dec() }
        })()

        // Community reviews sync (if not cached)
        if (needsCommunitySync && notSoon) {
            ;(async () => {
                try {
                    await fetch(`/relay/api/steam/community-reviews/${appid}/sync`, { method: 'POST' })
                    const res = await fetch(`/relay/api/steam/community-reviews/${appid}`)
                    if (res.ok) communityReviews = await res.json()
                } catch { /* non-critical */ }
                finally { dec() }
            })()
        }

        // About description (library/wishlist games missing description)
        if (hasAbout) {
            ;(async () => {
                try {
                    const res = await fetch(`/relay/api/games/${appid}?refresh=true`)
                    if (res.ok) {
                        const refreshed = await res.json()
                        if (refreshed.store?.detailedDescription) {
                            game = { ...game!, store: { ...game!.store, detailedDescription: refreshed.store.detailedDescription } } as SteamGame
                        }
                    }
                } catch { /* silent */ }
                finally { dec() }
            })()
        }
    })

    onDestroy(() => {
        _modalEl?.remove()
        document.getElementById('main-content')?.classList.remove('has-game-hero')
    })

    // ── HLTB refresh handler (passed to HltbSection) ──────────────────────────
    async function refreshHltb() {
        const { data: newGame } = await workerMgr.sync(
            `/relay/api/hltb/sync/${appid}?force=true`,
            `/relay/api/games/${appid}`)
        if (newGame) {
            game     = newGame
            hltbData = newGame.hltb
        }
    }
</script>

<svelte:head><title>{game?.name ?? ''}</title></svelte:head>

<div bind:this={containerEl}>
    {#if loading}
        <div class="game-p1-loader">
            <div class="community-loader"></div>
            <div class="game-p1-cells">
                {#each phase1Sections as s (s.label)}
                    <div class="game-p1-cell" class:game-p1-cell--done={s.done}>{s.label}</div>
                {/each}
            </div>
        </div>
    {:else if error}
        <p class="page-error">Failed to load: {escapeHtml(error)}</p>
    {:else if game}
        <GameHero
            {game}
            {communityReviews}
            protonData={protonData ?? null}
            itad={effectiveItad}
            hltb={effectiveHltb}
            sections={phase2Sections}
        />

        {#if game.store?.unavailable}
            <div class="game-unavailable-banner">
                <span class="game-unavailable-icon">&#9888;</span> This game is no longer available on the Steam store.
            </div>
        {/if}

        <ReleaseBanner {game} />

        <div class="game-flags-bar">
            <FlagsBar {appid} bind:flags bind:localWishlisted {game} />
        </div>

        <div class="game-body">
            <!-- Trailers -->
            {#if trailers.length}
                <Trailers {appid} {trailers} />
            {/if}

            <!-- About This Game -->
            <About {game} />

            <!-- How Long To Beat -->
            {#if effectiveHltb !== undefined}
                <HltbSection {game} hltb={effectiveHltb} onRefresh={refreshHltb} />
            {:else if hltbNeeded}
                <section class="game-section" id="game-sec-hltb">
                    <h2 class="game-section-title">How Long To Beat</h2>
                    <div class="game-sec-pending"><div class="community-loader"></div></div>
                </section>
            {/if}

            <!-- Player Count -->
            <PlayerChart data={playerCounts} />

            <!-- Screenshots -->
            <Screenshots {game} onShotClick={_openModal} />

            <!-- News (background-loaded) -->
            {#if newsData !== undefined}
                <News news={newsData} />
            {/if}

            <!-- Local Review -->
            <section class="game-section rev-local-section" id="game-sec-local-review">
                <h2 class="game-section-title">Local Review</h2>
                {#if localReview}
                    <LocalReviewCard review={localReview} />
                    <button class="rev-edit-btn" onclick={openLocalReview}>Edit Review</button>
                {:else}
                    <button class="rev-no-review" onclick={openLocalReview}>✦ Write a Review for this game</button>
                    <button class="rev-write-btn" onclick={openLocalReview}>✦ Write a Review</button>
                {/if}
            </section>

            <!-- My Steam Review -->
            <MyReview entry={myReview} />

            <!-- Community Reviews -->
            <CommunityReviewsSection data={communityReviews} {game} />

            <!-- ITAD Prices (background-loaded) -->
            {#if effectiveItad !== undefined}
                <ItadPrices itad={effectiveItad} {game} onRefresh={refreshItad} />
            {:else if itadNeeded}
                <section class="game-section" id="game-sec-itad">
                    <h2 class="game-section-title">Prices</h2>
                    <div class="game-sec-pending"><div class="community-loader"></div></div>
                </section>
            {/if}

            <!-- ProtonDB (background-loaded) -->
            {#if protonData !== undefined}
                <ProtonDB protonData={protonData} {game} onRefresh={refreshProton} />
            {/if}

            <!-- PCGamingWiki (background-loaded) -->
            {#if pcgwData !== undefined}
                <PCGW {pcgwData} {game} onRefresh={refreshPcgw} />
            {:else if pcgwNeeded}
                <section class="game-section" id="game-sec-pcgw">
                    <h2 class="game-section-title">PCGamingWiki</h2>
                    <div class="game-sec-pending"><div class="community-loader"></div></div>
                </section>
            {/if}
        </div>

        <!-- Floating nav rail (portal to body) -->
        <NavRail container={containerEl} />
    {/if}
</div>
