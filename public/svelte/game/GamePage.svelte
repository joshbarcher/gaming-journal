<script>
    import { onMount, onDestroy } from 'svelte'
    import { escapeHtml } from '../../js/utils.js'
    import { navigate } from '../../js/router.js'
    import { openReviewModal, renderLocalReviewCard } from '../../js/review-modal.js'
    import GameHero from './GameHero.svelte'
    import FlagsBar from './FlagsBar.svelte'
    import HltbSection from './HltbSection.svelte'
    import PlayerChart from './PlayerChart.svelte'
    import NavRail from './NavRail.svelte'
    import {
        releaseStatus, releaseBanner,
        renderAbout, renderTrailers, initTrailers,
        renderScreenshots, renderMyReview, initSteamReview,
        renderCommunityReviews, renderItad, renderProtondb, renderProtonBadge,
        renderPcgw, renderNews, initNews,
        newsBBCodeDirty,
    } from '../../js/views/game-render.js'

    let { appid } = $props()

    // ── Phase 1 state (fast fetches) ─────────────────────────────────────────
    let game             = $state(null)
    let communityReviews = $state(null)
    let myReview         = $state(null)
    let playerCounts     = $state(null)
    let flags            = $state({})
    let localReview      = $state(null)
    let trailers         = $state([])
    let localWishlisted  = $state(false)
    let loading          = $state(true)
    let error            = $state(null)

    // ── Phase 2 state (background loads) ─────────────────────────────────────
    // undefined = not yet fetched (show pending), null = fetched but no data, object = data
    let hltbData    = $state(undefined)
    let itadData    = $state(undefined)
    let protonData  = $state(undefined)
    let pcgwData    = $state(undefined)
    let newsData    = $state(undefined)
    let bgPending   = $state(0)

    // Effective HLTB: prefer background load, fall back to phase-1 game data
    let effectiveHltb = $derived(hltbData !== undefined ? hltbData : game?.hltb)
    // Effective ITAD: undefined until background resolves, then the object (or {})
    let effectiveItad = $derived(itadData !== undefined ? itadData : game?.itad)

    // ── Screenshot modal (vanilla JS — screenshots are {@html}) ──────────────
    let _modalEl = null, _modalSrcs = [], _modalIdx = 0

    function _modalNav(delta) {
        _modalIdx = (_modalIdx + delta + _modalSrcs.length) % _modalSrcs.length
        _modalEl.querySelector('.shot-modal-img').src = _modalSrcs[_modalIdx]
    }
    function _openModal(srcs, idx = 0) {
        if (!_modalEl) {
            _modalEl = document.createElement('div')
            _modalEl.className = 'shot-modal'
            _modalEl.innerHTML = `<div class="shot-modal-backdrop"></div><button class="shot-modal-prev shot-modal-nav" aria-label="Previous">&#8249;</button><img class="shot-modal-img" src="" alt="Screenshot"><button class="shot-modal-next shot-modal-nav" aria-label="Next">&#8250;</button><button class="shot-modal-close" aria-label="Close">✕</button>`
            document.body.appendChild(_modalEl)
            _modalEl.querySelector('.shot-modal-backdrop').addEventListener('click', _closeModal)
            _modalEl.querySelector('.shot-modal-close').addEventListener('click', _closeModal)
            _modalEl.querySelector('.shot-modal-prev').addEventListener('click', () => _modalNav(-1))
            _modalEl.querySelector('.shot-modal-next').addEventListener('click', () => _modalNav(1))
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
        _modalEl.querySelector('.shot-modal-img').src = srcs[idx]
        const hidden = srcs.length <= 1
        _modalEl.querySelector('.shot-modal-prev').style.display = hidden ? 'none' : ''
        _modalEl.querySelector('.shot-modal-next').style.display = hidden ? 'none' : ''
        _modalEl.classList.add('shot-modal--open')
    }
    function _closeModal() { _modalEl?.classList.remove('shot-modal--open') }

    // ── Worker manager ────────────────────────────────────────────────────────
    const workerMgr = (() => {
        let _w = null, _seq = 0
        const _cbs = new Map()
        const _ok  = typeof Worker !== 'undefined'

        function _boot() {
            if (_w) return _w
            _w = new Worker('/js/workers/game-refresh.worker.js')
            _w.onmessage = ({ data }) => { const cb = _cbs.get(data.id); if (cb) { _cbs.delete(data.id); cb(data) } }
            _w.onerror   = ()       => { for (const [id, cb] of _cbs) { _cbs.delete(id); cb({ id, data: null }) } }
            return _w
        }
        function _post(msg) {
            return new Promise(resolve => { const id = _seq++; _cbs.set(id, resolve); _boot().postMessage({ ...msg, id }) })
        }
        async function _mainGet(url) { try { const r = await fetch(url); return { data: r.ok ? await r.json() : null } } catch { return { data: null } } }
        async function _mainPostGet(pu, gu) { try { await fetch(pu, { method: 'POST' }); const r = await fetch(gu); return { data: r.ok ? await r.json() : null } } catch { return { data: null } } }

        return {
            fetch(url)            { return _ok ? _post({ type: 'get',      url })             : _mainGet(url) },
            sync(postUrl, getUrl) { return _ok ? _post({ type: 'post_get', postUrl, getUrl }) : _mainPostGet(postUrl, getUrl) },
        }
    })()

    // ── Container ref (for NavRail) ───────────────────────────────────────────
    let containerEl = $state(null)

    // ── Element refs for {@html} sections that need post-render init ──────────
    let trailersEl     = $state(null)
    let steamReviewEl  = $state(null)
    let shotsEl        = $state(null)
    let newsEl         = $state(null)
    let itadEl         = $state(null)
    let pcgwEl         = $state(null)
    let protondbEl     = $state(null)

    // Wire interactive event handlers after each {@html} section renders
    $effect(() => { if (trailersEl && trailers.length)  initTrailers(trailersEl) })
    $effect(() => { if (steamReviewEl && myReview)      initSteamReview(steamReviewEl) })
    $effect(() => { if (newsEl && newsData)             initNews(newsEl) })

    $effect(() => {
        if (!shotsEl) return
        shotsEl.addEventListener('click', e => {
            const img = e.target.closest('.game-shot-img')
            if (img) {
                const srcs = [...shotsEl.querySelectorAll('.game-shot-img')].map(i => i.src)
                _openModal(srcs, srcs.indexOf(img.src))
            }
        })
    })

    $effect(() => {
        if (!itadEl || effectiveItad === undefined) return
        const btn = itadEl.querySelector('[data-role="itad-refresh"]')
        if (!btn) return
        const handler = async () => {
            btn.classList.add('game-refresh-btn--spinning')
            btn.disabled = true
            try {
                const { data } = await workerMgr.sync(`/relay/api/itad/sync/${appid}?force=true`, `/relay/api/itad/${appid}`)
                itadData = data ?? {}
            } catch { /* silent */ } finally {
                btn.classList.remove('game-refresh-btn--spinning')
                btn.disabled = false
            }
        }
        btn.addEventListener('click', handler)
        return () => btn.removeEventListener('click', handler)
    })

    $effect(() => {
        if (!pcgwEl || !pcgwData?.found) return
        const btn = pcgwEl.querySelector('[data-role="pcgw-refresh"]')
        if (!btn) return
        const handler = async () => {
            btn.classList.add('game-refresh-btn--spinning')
            btn.disabled = true
            try {
                const { data } = await workerMgr.sync(`/relay/api/pcgw/sync/${appid}?force=true`, `/relay/api/pcgw/${appid}`)
                pcgwData = data
            } catch { /* silent */ } finally {
                btn.classList.remove('game-refresh-btn--spinning')
                btn.disabled = false
            }
        }
        btn.addEventListener('click', handler)
        return () => btn.removeEventListener('click', handler)
    })

    $effect(() => {
        if (!protondbEl || !protonData?.tier) return
        const btn = protondbEl.querySelector('[data-role="protondb-refresh"]')
        if (!btn) return
        const handler = async () => {
            btn.classList.add('game-refresh-btn--spinning')
            btn.disabled = true
            try {
                const { data: fresh } = await workerMgr.sync(`/relay/api/protondb/sync/${appid}?force=true`, `/relay/api/protondb/${appid}`)
                protonData = (fresh?.notFound || !fresh?.tier) ? null : fresh
            } catch { /* silent */ } finally {
                btn.classList.remove('game-refresh-btn--spinning')
                btn.disabled = false
            }
        }
        btn.addEventListener('click', handler)
        return () => btn.removeEventListener('click', handler)
    })

    // ── Community btn navigation ──────────────────────────────────────────────
    function handleCommunityClick(e) {
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

    // ── Phase 1: fast data fetch ──────────────────────────────────────────────
    onMount(async () => {
        try {
            const [gameRes, crRes, mrRes, pcRes, flagsRes, localRevRes, trailersRes, localWlRes] = await Promise.all([
                fetch(`/relay/api/games/${appid}`),
                fetch(`/relay/api/steam/community-reviews/${appid}`),
                fetch(`/relay/api/steam/reviews/${appid}`),
                fetch(`/relay/api/player-counts/${appid}`),
                fetch(`/api/flags/${appid}`),
                fetch(`/api/local-reviews/${appid}`),
                fetch(`/relay/api/videos/${appid}`),
                fetch(`/api/local-wishlist/${appid}`),
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
            error = err.message
            loading = false
            return
        }
        loading = false

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
                            game = { ...game, store: { ...game.store, detailedDescription: refreshed.store.detailedDescription } }
                        }
                    }
                } catch { /* silent */ }
                finally { dec() }
            })()
        }
    })

    onDestroy(() => { _modalEl?.remove() })

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

<div bind:this={containerEl}>
    {#if loading}
        <p class="page-loading">Loading…</p>
    {:else if error}
        <p class="page-error">Failed to load: {escapeHtml(error)}</p>
    {:else}
        <GameHero
            {game}
            {communityReviews}
            {protonData}
            itad={effectiveItad}
            hltb={effectiveHltb}
            {bgPending}
        />

        {#if game.store?.unavailable}
            <div class="game-unavailable-banner">
                <span class="game-unavailable-icon">&#9888;</span> This game is no longer available on the Steam store.
            </div>
        {/if}

        {@html releaseBanner(game)}

        <div class="game-flags-bar">
            <FlagsBar {appid} bind:flags bind:localWishlisted {game} />
        </div>

        <div class="game-body">
            <!-- Trailers -->
            {#if trailers.length}
                <div bind:this={trailersEl}>
                    {@html renderTrailers(appid, trailers)}
                </div>
            {/if}

            <!-- About This Game -->
            {#if game.store?.detailedDescription}
                {@html renderAbout(game)}
            {/if}

            <!-- How Long To Beat -->
            {#if effectiveHltb !== undefined}
                <HltbSection {game} hltb={effectiveHltb} onRefresh={refreshHltb} />
            {:else}
                <!-- pending placeholder; HltbSection renders once background load resolves -->
            {/if}

            <!-- Player Count -->
            <PlayerChart data={playerCounts} />

            <!-- Screenshots -->
            <div bind:this={shotsEl}>
                {@html renderScreenshots(game)}
            </div>

            <!-- News (background-loaded) -->
            {#if newsData}
                <div bind:this={newsEl}>
                    {@html renderNews(newsData)}
                </div>
            {/if}

            <!-- Local Review -->
            <section class="game-section rev-local-section" id="game-sec-local-review">
                <h2 class="game-section-title">Local Review</h2>
                {#if localReview}
                    {@html renderLocalReviewCard(localReview, appid)}
                    <button class="rev-edit-btn" onclick={openLocalReview}>Edit Review</button>
                {:else}
                    <button class="rev-no-review" onclick={openLocalReview}>✦ Write a Review for this game</button>
                    <button class="rev-write-btn" onclick={openLocalReview}>✦ Write a Review</button>
                {/if}
            </section>

            <!-- My Steam Review -->
            {#if myReview?.review}
                <div bind:this={steamReviewEl}>
                    {@html renderMyReview(myReview)}
                </div>
            {/if}

            <!-- Community Reviews -->
            {@html renderCommunityReviews(communityReviews, game)}

            <!-- ITAD Prices (background-loaded) -->
            {#if effectiveItad !== undefined}
                <div bind:this={itadEl}>
                    {@html renderItad(effectiveItad, game)}
                </div>
            {/if}

            <!-- ProtonDB (background-loaded) -->
            {#if protonData}
                <div bind:this={protondbEl}>
                    {@html renderProtondb(protonData, game)}
                </div>
            {/if}

            <!-- PCGamingWiki (background-loaded) -->
            {#if pcgwData?.found}
                <div bind:this={pcgwEl}>
                    {@html renderPcgw(pcgwData, game)}
                </div>
            {/if}
        </div>

        <!-- Floating nav rail (portal to body) -->
        <NavRail container={containerEl} />
    {/if}
</div>
