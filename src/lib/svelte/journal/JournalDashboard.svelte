<script lang="ts">
    import { onMount, onDestroy, tick } from 'svelte'
    import type { SteamGame, LocalReview, Page, AchievementItem, JournalSession, SessionAchievement, NowPlayingSession, StickyNote } from '../../types.js'
    import { api } from '../../js/api.js'
    import { navigate } from '../../js/router.js'
    import { globalSegments, pagePct, percentToColor, percentToStateLabel } from '../../js/views/progress-helpers.js'
    import {
        IC, STAR_LABELS, RATING_KEYS, RATING_LBLS, TRACKER_TYPES,
        fmtDate, fmtHours, mergeSessionAchievements,
    } from '../../js/views/journal-render.js'
    import Stars from './Stars.svelte'
    import AchievementStrip from './AchievementStrip.svelte'
    import SessionAchievements from './SessionAchievements.svelte'
    import LastSessionCard from './LastSessionCard.svelte'
    import SessionHistoryRail from './SessionHistoryRail.svelte'
    import Breadcrumb from '../Breadcrumb.svelte'
    import GuidesModal from './guide/GuidesModal.svelte'
    import { trackerSuggestJobStore } from '$lib/tracker-suggest-jobs.svelte.js'
    import { confirmDialog } from '../../js/dialog.js'

    let { appid } = $props()

    // ── Core state ─────────────────────────────────────────────────────────────

    let game          = $state<SteamGame | null>(null)
    let review        = $state<LocalReview | null>(null)
    let pages         = $state<Page[]>([])
    let journalNotes  = $state<StickyNote[]>([])
    let rawAchList    = $state<AchievementItem[]>([])
    let gameSessions  = $state<JournalSession[]>([])
    let achDuring     = $state<SessionAchievement[]>([])
    let activeSession = $state<NowPlayingSession | null>(null)
    let loading       = $state(true)
    let error         = $state<string | null>(null)
    let hltbRefreshing = $state(false)

    const activeTrackerJob = $derived(trackerSuggestJobStore.jobFor(String(appid)))

    // ── Guides ─────────────────────────────────────────────────────────────────

    interface DownloadedGuide { source: string; guideId: string; title: string; author: string | null; parsedAt: string | null; pageCount: number }
    interface SearchSource { searchedAt: string; matchedGame: { name: string; gameUrl: string; score: number } | null; guides: { title: string; url: string; type: string }[]; categories?: Record<string, { title: string; url: string; type: string }[]> }
    interface SearchData { steamId: string; sources: Record<string, SearchSource> }

    let guides         = $state<DownloadedGuide[]>([])
    let searchData     = $state<SearchData | null>(null)
    let guideModalOpen = $state(false)
    let searchingSet   = $state<Set<string>>(new Set())

    const SOURCE_LABELS: Record<string, string> = { gamefaqs: 'GameFAQs', ign: 'IGN', steam: 'Steam', game8: 'Game8', gamerguides: 'Gamer Guides', fandom: 'Fandom', neoseeker: 'Neoseeker' }
    const SOURCE_ICONS:  Record<string, string> = { gamefaqs: '/images/guides/gamefaqs.webp', ign: '/images/guides/ign.webp', steam: '/images/guides/steam.webp', game8: '/images/guides/game8.webp', gamerguides: '/images/guides/gamerguides.webp', fandom: '/images/guides/fandom.webp', neoseeker: '/images/guides/neoseeker.webp' }

    async function handleGuideDownloaded(_guideId: string) {
        const g = await fetch(`/relay/api/guides/${appid}`).then(r => r.ok ? r.json() : []).catch(() => [])
        guides = g
    }

    function mergeSource(src: string, sourceEntry: any) {
        searchData = {
            ...(searchData ?? {}),
            sources: { ...(searchData?.sources ?? {}), [src]: sourceEntry },
        }
    }

    async function runSearch(source: string) {
        if (!game || searchingSet.has(source)) return
        searchingSet = new Set([...searchingSet, source])
        try {
            const resp = await fetch(`/relay/api/guides/${appid}/search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gameName: game.name, source }),
            })

            if (resp.status === 409) {
                // Another search for this source is already running (e.g. a concurrent request).
                // Poll the cached result in a few seconds so the UI eventually updates.
                setTimeout(async () => {
                    const d = await fetch(`/relay/api/guides/${appid}/search`).then(r => r.ok ? r.json() : null).catch(() => null)
                    const entry = d?.sources?.[source]
                    if (entry) mergeSource(source, entry)
                }, 6_000)
                return
            }

            if (!resp.ok || !resp.body) return

            const reader = resp.body.getReader()
            const decoder = new TextDecoder()
            let buf = ''

            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                buf += decoder.decode(value, { stream: true })
                const parts = buf.split('\n\n')
                buf = parts.pop() ?? ''

                for (const part of parts) {
                    for (const raw of part.split('\n')) {
                        if (!raw.startsWith('data: ')) continue
                        let event: any
                        try { event = JSON.parse(raw.slice(6)) } catch { continue }
                        if (event.phase === 'done') {
                            const entry = event.data?.sources?.[source]
                            if (entry) mergeSource(source, entry)
                        }
                    }
                }
            }
        } catch { /* silent */ } finally {
            searchingSet = new Set([...searchingSet].filter(s => s !== source))
        }
    }

    async function refreshSearch() {
        if (!game) return
        await Promise.all([runSearch('gamefaqs'), runSearch('ign'), runSearch('steam'), runSearch('game8'), runSearch('gamerguides'), runSearch('fandom'), runSearch('neoseeker')])
    }

    // HLTB pin live tracking
    let basePlaytimeMin  = $state(0)   // effectiveMin from relay at load time
    let renderTime       = $state(0)   // Date.now() at load — HLTB pin uses delta from here
    let sessionElapsedMin = $state(0)  // delta since renderTime, set by 30s timer
    let sessionElapsedText = $state('—')

    // ── Derived ────────────────────────────────────────────────────────────────

    let displayAchList  = $derived(mergeSessionAchievements(rawAchList, achDuring))
    let effectivePlaytimeMin = $derived(basePlaytimeMin + sessionElapsedMin)
    let playerHours     = $derived(effectivePlaytimeMin / 60)

    let progressPages   = $derived(pages.filter(p => TRACKER_TYPES.includes(p.type)))
    let journalPages    = $derived(pages.filter(p => p.type === 'page'))
    let sortedJournalPages = $derived([...journalPages].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()))

    let closedSessions  = $derived(
        gameSessions.filter(s => s.endedAt && (s.durationMin ?? 0) >= 10)
                    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    )

    let achTotal    = $derived(displayAchList.length)
    let achUnlocked = $derived(displayAchList.filter(a => a.achieved).length)
    let achPct      = $derived(achTotal > 0 ? Math.round(achUnlocked / achTotal * 100) : 0)
    let recentAchs  = $derived([...displayAchList].filter(a => a.achieved).sort((a, b) => (b.unlocktime ?? 0) - (a.unlocktime ?? 0)).slice(0, 4))
    let sessionAchMap = $derived.by(() => {
        const m: Record<string, AchievementItem> = {}
        for (const a of displayAchList) m[a.apiname] = a
        return m
    })

    function stripHtml(html: string): string {
        return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    }

    let ratedKeys = $derived(RATING_KEYS.filter(k => review?.ratings?.[k] != null))

    let hltbMilestones = $derived.by(() => {
        const hltb = game?.hltb?.matched ? game.hltb : null
        return [
            { label: 'Main',          h: hltb?.gameplayMain          },
            { label: 'Main + Extras', h: hltb?.gameplayMainExtra     },
            { label: 'Completionist', h: hltb?.gameplayCompletionist },
        ].filter((m): m is { label: string; h: number } => m.h != null && m.h > 0)
    })

    let hltbMaxScale = $derived.by(() => {
        if (!hltbMilestones.length) return 1
        return Math.max(...hltbMilestones.map(m => m.h as number), ...(playerHours > 0 ? [playerHours] : [])) * 1.08
    })

    // Sqrt scale — prevents wide ranges from clustering left
    function hltbPct(h: number) { return (Math.sqrt(h) / Math.sqrt(hltbMaxScale)) * 100 }

    let hltbPinPct  = $derived(playerHours > 0 ? hltbPct(playerHours) : null)
    let hltbFillPct = $derived(hltbPinPct ?? (hltbMilestones.length ? hltbPct(hltbMilestones[0].h) : 0))

    const HLTB_SHORT_LABELS = ['MAIN', 'EXTRAS', 'COMPLETE']

    let hltbSegments = $derived(
        hltbMilestones.map((m, i) => {
            const leftPct = i === 0 ? 0 : hltbPct(hltbMilestones[i - 1].h)
            const isLast = i === hltbMilestones.length - 1
            return {
                shortLabel: HLTB_SHORT_LABELS[i] ?? m.label.toUpperCase(),
                h: m.h,
                leftPct,
                widthPct: (isLast ? 100 : hltbPct(m.h)) - leftPct,
            }
        })
    )

    let hltbInView = $state(false)
    let hltbBarEl  = $state<HTMLElement | null>(null)

    $effect(() => {
        if (!hltbBarEl || hltbInView) return
        const obs = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                requestAnimationFrame(() => { hltbInView = true })
                obs.disconnect()
            }
        }, { threshold: 0.1 })
        obs.observe(hltbBarEl)
        return () => obs.disconnect()
    })


    // ── Data loading ───────────────────────────────────────────────────────────

    async function loadData() {
        const [gameRes, reviewRes, pagesRes, journalNotesRes, achRes, accountRes, nowPlayingRes] = await Promise.allSettled([
            fetch(`/relay/api/games/${appid}`).then(r => r.ok ? r.json() : null),
            api.localReviews.get(appid).catch(() => null),
            api.pages.listByGame(appid).catch(() => []),
            api.journalNotes.get(appid).catch(() => []),
            fetch(`/relay/api/steam/achievements/${appid}`).then(r => r.ok ? r.json() : null),
            fetch('/relay/api/account').then(r => r.ok ? r.json() : null),
            fetch('/relay/api/steam/now-playing').then(r => r.ok ? r.json() : null),
        ])

        fetch(`/relay/api/guides/${appid}`).then(r => r.ok ? r.json() : []).then(g => { guides = g }).catch(() => {})
        fetch(`/relay/api/guides/${appid}/search`).then(r => r.ok ? r.json() : null).then(d => { searchData = d }).catch(() => {})

        const g    = (gameRes as PromiseFulfilledResult<any>).value    ?? null
        const np   = (nowPlayingRes as PromiseFulfilledResult<any>).value ?? null
        const sess = np?.playing?.appid === Number(appid) ? np.playing : null

        game         = g
        review       = (reviewRes as PromiseFulfilledResult<any>).value ?? null
        pages        = (pagesRes as PromiseFulfilledResult<any>).value  ?? []
        journalNotes = (journalNotesRes as PromiseFulfilledResult<any>).value ?? []
        rawAchList   = (achRes as PromiseFulfilledResult<any>).value?.achievements ?? []
        gameSessions = (accountRes as PromiseFulfilledResult<any>).value?.sessions?.[appid]?.sessions
                    ?? (accountRes as PromiseFulfilledResult<any>).value?.sessions?.[String(appid)]?.sessions
                    ?? []
        activeSession = sess
        achDuring    = sess?.achievementsDuring ?? []

        basePlaytimeMin  = g?.playtimeMinutes ?? 0
        renderTime       = Date.now()
        sessionElapsedMin = 0
        sessionElapsedText = '—'
    }

    // ── Timers + polling ───────────────────────────────────────────────────────

    let sessionTimer: ReturnType<typeof setInterval> | null = null
    let fastPollTimer: ReturnType<typeof setInterval> | null = null
    let slowPollTimer: ReturnType<typeof setInterval> | null = null
    let schemaTimer: ReturnType<typeof setInterval> | null = null

    function startSessionTimer() {
        if (sessionTimer) clearInterval(sessionTimer)
        const update = () => {
            const startedAt = activeSession?.sessionStartedAt
            if (!startedAt) return
            const totalMins = Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000)
            const h = Math.floor(totalMins / 60)
            const m = totalMins % 60
            sessionElapsedText = h > 0 ? `${h}h ${m}m` : `${m}m`
            sessionElapsedMin  = Math.floor((Date.now() - renderTime) / 60_000)
        }
        update()
        sessionTimer = setInterval(update, 30_000)
    }

    function startSchemaPoller() {
        if (schemaTimer || rawAchList.length > 0) return
        const MAX_TRIES = 8
        let tries = 0
        schemaTimer = setInterval(async () => {
            tries++
            try {
                const data = await fetch(`/relay/api/steam/achievements/${appid}`).then(r => r.ok ? r.json() : null)
                const achs = data?.achievements
                if (achs?.length) {
                    clearInterval(schemaTimer ?? undefined); schemaTimer = null
                    rawAchList = achs
                    return
                }
            } catch { /* retry */ }
            if (tries >= MAX_TRIES) { clearInterval(schemaTimer ?? undefined); schemaTimer = null }
        }, 15_000)
    }

    function startPollers() {
        if (activeSession) {
            startSchemaPoller()
            fastPollTimer = setInterval(async () => {
                try {
                    const np   = await fetch('/relay/api/steam/now-playing').then(r => r.ok ? r.json() : null)
                    const sess = np?.playing?.appid === Number(appid) ? np.playing : null

                    if (!sess) {
                        // Session ended — reload all data so card flips to "Last Session"
                        clearInterval(sessionTimer ?? undefined); sessionTimer = null
                        await loadData()
                        stopPollers()
                        startPollers()
                        return
                    }

                    const newAchDuring = sess.achievementsDuring ?? []
                    const changed = newAchDuring.length !== achDuring.length ||
                        (newAchDuring.length > 0 &&
                         newAchDuring[newAchDuring.length - 1]?.apiname !== achDuring[achDuring.length - 1]?.apiname)
                    if (changed) achDuring = newAchDuring
                } catch { /* silent */ }
            }, 60_000)
        }

        slowPollTimer = setInterval(async () => {
            try {
                const [achRes, gameRes] = await Promise.allSettled([
                    fetch(`/relay/api/steam/achievements/${appid}`).then(r => r.ok ? r.json() : null),
                    fetch(`/relay/api/games/${appid}`).then(r => r.ok ? r.json() : null),
                ])
                const newRaw: AchievementItem[] | undefined = (achRes as PromiseFulfilledResult<any>).value?.achievements
                const newGame = (gameRes as PromiseFulfilledResult<any>).value

                if (newRaw) {
                    if (newRaw.length !== rawAchList.length) {
                        rawAchList = newRaw
                        if (schemaTimer) { clearInterval(schemaTimer); schemaTimer = null }
                    } else if (newRaw.filter(a => a.achieved).length !== rawAchList.filter(a => a.achieved).length) {
                        rawAchList = newRaw
                    }
                }

                if (newGame?.playtimeMinutes != null && !activeSession) {
                    basePlaytimeMin = Math.max(basePlaytimeMin, newGame.playtimeMinutes)
                }
            } catch { /* silent */ }
        }, 5 * 60_000)
    }

    function stopPollers() {
        if (fastPollTimer)  { clearInterval(fastPollTimer); fastPollTimer = null }
        if (slowPollTimer)  { clearInterval(slowPollTimer); slowPollTimer = null }
        if (schemaTimer)    { clearInterval(schemaTimer);   schemaTimer   = null }
    }

    // ── Dashboard actions ──────────────────────────────────────────────────────

    async function openReview() {
        const { openReviewModal } = await import('../../js/review-modal.js')
        const res = await fetch(`/api/local-reviews/${appid}`)
        const existing = res.ok ? await res.json() : null
        await openReviewModal(appid, game?.name ?? '', existing)
        review = await api.localReviews.get(appid).catch(() => null)
    }

    async function refreshHltb() {
        hltbRefreshing = true
        try {
            await fetch(`/relay/api/hltb/sync/${appid}?force=true`, { method: 'POST' })
        } catch { /* ignore — reload anyway */ }
        await loadData()
        hltbRefreshing = false
    }

    async function enqueueTrackerSuggest() {
        if (!game || activeTrackerJob) return
        const ok = await confirmDialog(
            'AI-suggest trackers',
            `This will search the web and generate progress trackers for ${game.name}. Continue?`,
            'Generate'
        )
        if (!ok) return
        await trackerSuggestJobStore.enqueue({ steamId: String(appid), gameName: game.name })
    }

    // ── Notes wall ─────────────────────────────────────────────────────────────

    let notesWallEl: HTMLElement
    let notesWall: any = null

    // ── Heatmap tooltip ────────────────────────────────────────────────────────

    let tooltipEl: HTMLElement | null = null

    function showTip(text: string, rect: DOMRect) {
        if (!tooltipEl) {
            tooltipEl = document.createElement('div')
            tooltipEl.className = 'gj-tooltip'
            document.body.appendChild(tooltipEl)
        }
        tooltipEl.textContent = text
        tooltipEl.style.display = 'block'
        requestAnimationFrame(() => {
            const el = tooltipEl
            if (!el) return
            const tw = el.offsetWidth, th = el.offsetHeight, gap = 8
            let x = rect.left + rect.width / 2 - tw / 2
            let y = rect.top - th - gap
            if (y < gap) y = rect.bottom + gap
            el.style.left = Math.max(gap, Math.min(x, window.innerWidth  - tw - gap)) + 'px'
            el.style.top  = Math.max(gap, Math.min(y, window.innerHeight - th - gap)) + 'px'
        })
    }

    function hideTip() { if (tooltipEl) tooltipEl.style.display = 'none' }

    let _lastHeatTip: HTMLElement | null = null
    function handleHeatOver(e: MouseEvent) {
        const cell = (e.target as Element)?.closest<HTMLElement>('.gj-heat-cell[data-tooltip]') ?? null
        if (cell === _lastHeatTip) return
        _lastHeatTip = cell
        if (cell) showTip(cell.dataset.tooltip ?? '', cell.getBoundingClientRect())
        else hideTip()
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    onMount(async () => {
        try {
            await loadData()
            if (!game) { error = 'Failed to load game data.'; return }
        } catch (e) {
            error = 'Failed to load journal.'
            return
        } finally {
            loading = false
        }

        await tick()

        if (notesWallEl && journalNotes.length > 0) {
            const { StickyWall } = await import('../../js/vendor/stickywall.js')
            notesWall = new StickyWall(notesWallEl, {
                notes:     journalNotes.slice(0, 2),
                editable:  false,
                draggable: false,
                tape:      true,
                addForm:   false,
            })
        }

        if (activeSession) startSessionTimer()
        startPollers()
    })

    onDestroy(() => {
        if (sessionTimer) clearInterval(sessionTimer)
        stopPollers()
        if (tooltipEl) { tooltipEl.remove(); tooltipEl = null }
        notesWall?.destroy()
        notesWall = null
    })
</script>

{#if loading}
    <p class="page-loading">Loading journal…</p>
{:else if error}
    <p class="page-error">{error}</p>
{:else if game}
<div class="gj-dash gj-dash--with-bg" style="--jd-bg: url('{game.media?.screenshots?.[0] ?? game.media?.background ?? game.media?.header ?? ''}')">
    <div class="gj-header">
        <Breadcrumb crumbs={[
            { label: 'Home', href: '/' },
            { label: game.name, href: `/game/${appid}` },
            { label: 'Journal' },
        ]} />
        <span class="gj-header-title">Journal</span>
    </div>

    <div class="gj-grid gj-grid--with-guides"
         class:gj-grid--with-history={closedSessions.length > 0}>

        <!-- Rating card -->
        <div class="gj-card gj-card--clickable" onclick={openReview} role="button" tabindex="0">
            <div class="gj-card-header">
                <span class="gj-card-title">My Rating</span>
                {#if review && review.stars > 0}
                    <div class="gj-rating-header-stars">
                        <div class="gj-rating-stars-row"><Stars stars={review.stars} /></div>
                        <span class="gj-rating-label">{STAR_LABELS[review.stars] ?? ''}</span>
                    </div>
                {:else}
                    <span class="gj-no-data">No rating</span>
                {/if}
            </div>
            {#if review && ratedKeys.length > 0}
                <div class="gj-rating-bars">
                    {#each ratedKeys as k}
                        <div class="gj-rating-bar-labeled">
                            <div class="gj-rating-bar-fill" style="width:{review.ratings[k] * 10}%"></div>
                            <span class="gj-rating-bar-lbl">{RATING_LBLS[k]}</span>
                            <span class="gj-rating-bar-val">{review.ratings[k]}</span>
                        </div>
                    {/each}
                </div>
            {:else}
                <p class="gj-no-data">Click to add a review</p>
            {/if}
            {#if review?.review}
                <p class="gj-review-preview">{review.review}</p>
            {/if}
        </div>

        <!-- Achievement card -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="gj-card gj-card--clickable" role="button" tabindex="0"
             onclick={() => navigate(`journal/${appid}/achievements`)}>
            <div class="gj-card-header">
                <span class="gj-card-title">Achievements</span>
            </div>
            {#if achTotal > 0}
                <div class="gj-ach-summary">
                    <div class="gj-ach-summary-line">
                        <span>{achUnlocked} / {achTotal} unlocked</span>
                        <span>{achPct}%</span>
                    </div>
                    <div class="gj-ach-track">
                        <div class="gj-ach-fill" style="width:{achPct}%"></div>
                    </div>
                </div>
                {#if recentAchs.length > 0}
                    <p class="gj-ach-recent-label">Recent</p>
                    <AchievementStrip achievements={recentAchs} />
                {/if}
            {:else}
                <p class="gj-no-data">No achievement data</p>
            {/if}
        </div>

        <!-- Last Session (always shown) -->
        <LastSessionCard sessions={gameSessions} displayAchList={displayAchList} {appid} />

        <!-- Guides card: always col 3, always row-span 2. Always visible.
             Must come before HLTB in the DOM so auto-placement fills cols 1-2 around it. -->
        <div class="gj-card gj-card--guides-panel" style="grid-column:3;grid-row:2/4">
            <div class="gj-card-header">
                <span class="gj-card-title">Guides{guides.length > 0 ? ` (${guides.length})` : ''}</span>
                <button class="gj-find-guides-btn" onclick={() => guideModalOpen = true}>Find</button>
            </div>

            {#if guides.length > 0}
                <div class="gj-guide-dl-list" class:gj-guide-dl-list--grid={guides.length >= 5}>
                    {#each guides as g (g.source + g.guideId)}
                        <a class="gj-guide-dl-tile"
                           href="/journal/{appid}/guides/{g.source}/{g.guideId}"
                           onclick={(e) => { e.preventDefault(); navigate(`journal/${appid}/guides/${g.source}/${g.guideId}`) }}>
                            <img class="gj-guide-dl-tile-icon" src={SOURCE_ICONS[g.source]} alt={SOURCE_LABELS[g.source] ?? g.source}>
                            <div class="gj-guide-dl-tile-body">
                                <span class="gj-guide-dl-tile-title">{g.title}</span>
                                <span class="gj-guide-dl-tile-meta">{SOURCE_LABELS[g.source] ?? g.source} · {g.pageCount} pages</span>
                            </div>
                        </a>
                    {/each}
                </div>
            {:else}
                <p class="gj-no-data">No guides downloaded yet</p>
            {/if}
        </div>

        <!-- HLTB card: always spans cols 1-2 (guides always in col 3) -->
        <div class="gj-card gj-card--hltb gj-card--span2">
            {#if hltbMilestones.length === 0}
                <p class="gj-no-data">{playerHours > 0 ? `Played ${fmtHours(playerHours)} — no HLTB data` : 'No playtime or HLTB data'}</p>
            {:else}
                <div class="hltb-bar-wrap" class:hltb--inview={hltbInView} bind:this={hltbBarEl}>
                    {#if hltbPinPct != null}
                        <div class="hltb-pin" style="left:{hltbPinPct.toFixed(2)}%">
                            {fmtHours(playerHours)} played
                        </div>
                    {/if}
                    <div class="hltb-track">
                        <div class="hltb-fill" style="width:{hltbInView ? hltbFillPct.toFixed(2) : '0'}%"></div>
                        {#each hltbSegments as seg, i}
                            {#if i > 0}
                                <div class="hltb-seg-divider" style="left:{seg.leftPct.toFixed(2)}%"></div>
                            {/if}
                            <div class="hltb-segment" style="left:{seg.leftPct.toFixed(2)}%; width:{seg.widthPct.toFixed(2)}%">
                                <span class="hltb-seg-label">{seg.shortLabel}</span>
                                <span class="hltb-seg-hours">{fmtHours(seg.h)}</span>
                            </div>
                        {/each}
                    </div>
                </div>
            {/if}
        </div>

        <!-- Session history rail: always visible, spans cols 1-2 (narrowed by CSS when guides exist) -->
        <SessionHistoryRail sessions={closedSessions} />

        <!-- Row 4: three individual cards, one per column -->

        <!-- Progress trackers -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="gj-card gj-card--clickable {progressPages.length > 0 ? 'gj-card--fill' : ''}" role="button" tabindex="0"
             onclick={(e) => { if ((e.target as Element)?.closest('.gj-heat-cell')) return; navigate(`journal/${appid}/progress`) }}>
            <div class="gj-card-header">
                <span class="gj-card-title">Progress Trackers</span>
                {#if activeTrackerJob}
                    <a class="game-refresh-btn game-refresh-btn--link"
                       href="/downloads"
                       onclick={(e) => e.stopPropagation()}>→ Downloads</a>
                {:else}
                    <button
                        class="game-refresh-btn"
                        onclick={(e) => { e.stopPropagation(); enqueueTrackerSuggest() }}
                        title="AI-suggest trackers"
                    >✦</button>
                {/if}
            </div>
            {#if progressPages.length > 0}
                <div class="gj-heat-grid" onmouseover={handleHeatOver} onmouseleave={() => { _lastHeatTip = null; hideTip() }}>
                    {#each progressPages as p}
                        {@const pct = pagePct(p)}
                        {@const color = percentToColor(pct)}
                        {@const state = percentToStateLabel(pct)}
                        {@const tip = state ? `${p.title} · ${state} (${pct}%)` : `${p.title} · ${pct}%`}
                        <a class="gj-heat-cell{pct === 0 ? ' gj-heat-cell--empty' : ''}" href="/{p.id}" data-tooltip={tip} style="background:{color}">
                            <span class="gj-heat-cell-title">{p.title}</span>
                            <span class="gj-heat-cell-pct">{pct}%</span>
                        </a>
                    {/each}
                </div>
            {:else}
                <p class="gj-no-data">No trackers yet</p>
            {/if}
        </div>

        <!-- Notes -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="gj-card gj-card--clickable" role="button" tabindex="0"
             onclick={(e) => { if ((e.target as Element)?.closest('.sw-note')) return; navigate(`journal/${appid}/notes`) }}>
            <div class="gj-card-header">
                <span class="gj-card-title">Notes</span>
            </div>
            {#if journalNotes.length > 0}
                <div class="gj-dash-notes-wall" bind:this={notesWallEl}></div>
            {:else}
                <p class="gj-no-data">No notes yet</p>
            {/if}
        </div>

        <!-- Journal Pages -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="gj-card gj-card--clickable" role="button" tabindex="0"
             onclick={(e) => { if ((e.target as Element)?.closest('.gj-page-card')) return; navigate(`journal/${appid}/pages`) }}>
            <div class="gj-card-header">
                <span class="gj-card-title">Journal Pages</span>
            </div>
            {#if sortedJournalPages.length > 0}
                <div class="gj-pages-cards">
                    {#each sortedJournalPages.slice(0, 3) as p (p.id)}
                        {@const preview = stripHtml(p.content ?? '')}
                        <a class="gj-page-card" href="/{p.id}">
                            <span class="gj-page-card-icon">{@html IC.file}</span>
                            <span class="gj-page-card-name">{p.title}</span>
                            <span class="gj-page-card-date">Edited {fmtDate(p.updatedAt)}</span>
                            <span class="gj-page-card-preview">{preview || 'No content yet'}</span>
                        </a>
                    {/each}
                </div>
            {:else}
                <p class="gj-no-data">No pages yet</p>
            {/if}
        </div>

    </div>
</div>

{#if guideModalOpen}
    <GuidesModal
        {appid}
        {searchData}
        {guides}
        gameName={game?.name ?? ''}
        {searchingSet}
        onClose={() => guideModalOpen = false}
        onDownloaded={handleGuideDownloaded}
        {runSearch}
        {refreshSearch}
    />
{/if}
{/if}
