<script lang="ts">
    import { onMount, onDestroy } from 'svelte'
    import type { SteamGame, LocalReview, Page, AchievementItem, JournalSession, SessionAchievement, NowPlayingSession } from '../../types.js'
    import { api } from '../../js/api.js'
    import { navigate } from '../../js/router.js'
    import { globalSegments, pagePct, percentToColor, percentToStateLabel } from '../../js/views/progress-helpers.js'
    import {
        IC, STAR_LABELS, RATING_KEYS, RATING_LBLS, TRACKER_TYPES,
        fmtDate, fmtHours, starsHtml, mergeSessionAchievements,
        renderRecentAchStrip, renderSessionAchs,
        renderLastSessionCard, renderSessionHistoryRail,
    } from '../../js/views/journal-render.js'

    let { appid } = $props()

    // ── Core state ─────────────────────────────────────────────────────────────

    let game         = $state<SteamGame | null>(null)
    let review       = $state<LocalReview | null>(null)
    let pages        = $state<Page[]>([])
    let rawAchList   = $state<AchievementItem[]>([])
    let gameSessions = $state<JournalSession[]>([])
    let achDuring    = $state<SessionAchievement[]>([])
    let activeSession = $state<NowPlayingSession | null>(null)
    let loading      = $state(true)
    let error        = $state<string | null>(null)
    let hltbRefreshing = $state(false)

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
    let journalPages    = $derived(pages.filter(p => p.type === 'page' || p.type === 'notes'))
    let allNotes        = $derived(review?.notes ?? [])
    let recentNotes     = $derived([...allNotes].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 2))
    let sortedJournalPages = $derived([...journalPages].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()))

    let closedSessions  = $derived(
        gameSessions.filter(s => s.endedAt && (s.durationMin ?? 0) >= 10)
                    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    )

    let achTotal    = $derived(displayAchList.length)
    let achUnlocked = $derived(displayAchList.filter(a => a.achieved).length)
    let achPct      = $derived(achTotal > 0 ? Math.round(achUnlocked / achTotal * 100) : 0)
    let recentAchs  = $derived([...displayAchList].filter(a => a.achieved).sort((a, b) => (b.unlocktime ?? 0) - (a.unlocktime ?? 0)).slice(0, 4))
    let recentAchStripHtml = $derived(renderRecentAchStrip(recentAchs))

    let sessionAchMap = $derived.by(() => {
        const m: Record<string, AchievementItem> = {}
        for (const a of displayAchList) m[a.apiname] = a
        return m
    })
    let sessionAchsHtml = $derived(renderSessionAchs(achDuring, sessionAchMap, 'No achievements yet'))

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

    let lastSessionCardHtml    = $derived(renderLastSessionCard(gameSessions, displayAchList, appid))
    let sessionHistoryRailHtml = $derived(renderSessionHistoryRail(closedSessions))

    // ── Data loading ───────────────────────────────────────────────────────────

    async function loadData() {
        const [gameRes, reviewRes, pagesRes, achRes, accountRes, nowPlayingRes] = await Promise.allSettled([
            fetch(`/relay/api/games/${appid}`).then(r => r.ok ? r.json() : null),
            api.localReviews.get(appid).catch(() => null),
            api.pages.listByGame(appid).catch(() => []),
            fetch(`/relay/api/steam/achievements/${appid}`).then(r => r.ok ? r.json() : null),
            fetch('/relay/api/account').then(r => r.ok ? r.json() : null),
            fetch('/relay/api/steam/now-playing').then(r => r.ok ? r.json() : null),
        ])

        const g    = (gameRes as PromiseFulfilledResult<any>).value    ?? null
        const np   = (nowPlayingRes as PromiseFulfilledResult<any>).value ?? null
        const sess = np?.playing?.appid === Number(appid) ? np.playing : null

        game         = g
        review       = (reviewRes as PromiseFulfilledResult<any>).value ?? null
        pages        = (pagesRes as PromiseFulfilledResult<any>).value  ?? []
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

        if (activeSession) startSessionTimer()
        startPollers()
    })

    onDestroy(() => {
        if (sessionTimer) clearInterval(sessionTimer)
        stopPollers()
        if (tooltipEl) { tooltipEl.remove(); tooltipEl = null }
    })
</script>

{#if loading}
    <p class="page-loading">Loading journal…</p>
{:else if error}
    <p class="page-error">{error}</p>
{:else if game}
<div class="gj-dash">
    <div class="gj-header">
        <a href="/game/{appid}" class="gj-back">&#8592; {game.name}</a>
        <span class="gj-header-title">Journal</span>
    </div>

    <div class="gj-grid" class:gj-grid--with-history={closedSessions.length > 0}>

        <!-- Rating card -->
        <div class="gj-card gj-card--clickable" onclick={openReview} role="button" tabindex="0">
            <div class="gj-card-header">
                <span class="gj-card-title">My Rating</span>
                {#if review && review.stars > 0}
                    <div class="gj-rating-header-stars">
                        <div class="gj-rating-stars-row">{@html starsHtml(review.stars)}</div>
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
        </div>

        <!-- Achievement card -->
        <div class="gj-card">
            <div class="gj-card-header">
                <span class="gj-card-title">Achievements</span>
                {#if achTotal > 0}
                    <a href="/journal/{appid}/achievements" class="gj-view-all">View All →</a>
                {/if}
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
                    <div class="gj-ach-strip">{@html recentAchStripHtml}</div>
                {/if}
            {:else}
                <p class="gj-no-data">No achievement data</p>
            {/if}
        </div>

        <!-- Playing Now / Last Session -->
        {#if activeSession}
            <div class="gj-card gj-card--active-session gj-card--game-bg" style="--gj-game-bg: url('/relay/images/steam/games/{appid}/header.jpg')">
                <div class="gj-card-header">
                    <span class="gj-card-title">Playing Now</span>
                    <span class="gj-active-dot"></span>
                </div>
                <div class="gj-session-stat">
                    <span class="gj-session-big">{sessionElapsedText}</span>
                    <span class="gj-session-sublabel">so far</span>
                </div>
                {#if achDuring.length > 0}
                    <p class="gj-ach-recent-label">Earned ({achDuring.length})</p>
                {/if}
                <div>{@html sessionAchsHtml}</div>
            </div>
        {:else}
            {@html lastSessionCardHtml}
        {/if}

        <!-- HLTB card -->
        <div class="gj-card gj-card--wide gj-card--hltb">
            <div class="gj-card-header">
                <span class="gj-card-title">How Long to Beat</span>
                <button
                    class="game-refresh-btn"
                    class:game-refresh-btn--spinning={hltbRefreshing}
                    disabled={hltbRefreshing}
                    onclick={refreshHltb}
                    title="Refresh HLTB data"
                >↻</button>
            </div>
            {#if hltbMilestones.length === 0}
                <p class="gj-no-data">{playerHours > 0 ? `Played ${fmtHours(playerHours)} — no HLTB data` : 'No playtime or HLTB data'}</p>
            {:else}
                <div class="hltb-bar-wrap">
                    <div class="hltb-labels-row">
                        {#each hltbMilestones as m}
                            <span class="hltb-lbl" style="left:{hltbPct(m.h).toFixed(2)}%">{m.label}</span>
                        {/each}
                    </div>
                    <div class="hltb-track-wrap">
                        <div class="hltb-track">
                            <div class="hltb-fill" style="width:{hltbFillPct.toFixed(2)}%"></div>
                        </div>
                        {#each hltbMilestones as m}
                            <div class="hltb-tick" style="left:{hltbPct(m.h).toFixed(2)}%"></div>
                        {/each}
                        {#if hltbPinPct != null}
                            <div class="hltb-pin" style="left:{hltbPinPct.toFixed(2)}%" data-label="{fmtHours(playerHours)} played"></div>
                        {/if}
                    </div>
                    <div class="hltb-hours-row">
                        {#each hltbMilestones as m}
                            <span class="hltb-hr" style="left:{hltbPct(m.h).toFixed(2)}%">{fmtHours(m.h)}</span>
                        {/each}
                    </div>
                </div>
            {/if}
        </div>

        <!-- Session history rail -->
        {#if closedSessions.length > 0}
            {@html sessionHistoryRailHtml}
        {/if}

        <!-- Progress trackers card -->
        <div class="gj-card {progressPages.length > 0 ? 'gj-card--fill' : ''}">
            <div class="gj-card-header">
                <span class="gj-card-title">Progress Trackers</span>
                <a href="/journal/{appid}/progress" class="gj-view-all">Manage →</a>
            </div>
            {#if progressPages.length > 0}
                <div class="gj-heat-grid" onmouseover={handleHeatOver} onmouseleave={() => { _lastHeatTip = null; hideTip() }}>
                    {#each progressPages as p}
                        {@const pct = pagePct(p)}
                        {@const color = percentToColor(pct)}
                        {@const state = percentToStateLabel(pct)}
                        {@const tip = state ? `${p.title} · ${state} (${pct}%)` : `${p.title} · ${pct}%`}
                        <a class="gj-heat-cell" href="/{p.id}" data-tooltip={tip} style="background:{color}"></a>
                    {/each}
                </div>
            {:else}
                <p class="gj-no-data">No trackers yet</p>
            {/if}
        </div>

        <!-- Notes + Pages card -->
        <div class="gj-card gj-card--span2 gj-card--compact-np">
            <div class="gj-cnp-body">
                <div class="gj-cnp-section">
                    <div class="gj-card-header">
                        <span class="gj-card-title">Recent Notes</span>
                        <a href="/journal/{appid}/notes" class="gj-view-all">All ({allNotes.length}) →</a>
                    </div>
                    <div class="gj-recent-notes">
                        {#if recentNotes.length > 0}
                            {#each recentNotes as n (n.id)}
                                <div class="gj-note-card gj-note-card--recent">
                                    <p class="gj-note-card-text">{n.text}</p>
                                    <div class="gj-note-date">{fmtDate(n.createdAt)}</div>
                                </div>
                            {/each}
                        {:else}
                            <p class="gj-no-data">No notes yet</p>
                        {/if}
                    </div>
                </div>
                <div class="gj-cnp-sep"></div>
                <div class="gj-cnp-section">
                    <div class="gj-card-header">
                        <span class="gj-card-title">Journal Pages</span>
                        <a href="/journal/{appid}/pages" class="gj-view-all">All ({journalPages.length}) →</a>
                    </div>
                    {#if sortedJournalPages.length > 0}
                        <div class="gj-pages-list">
                            {#each sortedJournalPages.slice(0, 3) as p (p.id)}
                                <a class="gj-page-item" href="/{p.id}">
                                    <span class="gj-page-icon">{@html p.type === 'notes' ? IC.notes : IC.file}</span>
                                    <span class="gj-page-name">{p.title}</span>
                                    <span class="gj-page-date">{fmtDate(p.updatedAt)}</span>
                                </a>
                            {/each}
                        </div>
                    {:else}
                        <p class="gj-no-data">No pages yet</p>
                    {/if}
                </div>
            </div>
        </div>

    </div>
</div>
{/if}
