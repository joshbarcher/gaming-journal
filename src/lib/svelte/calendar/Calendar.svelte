<script lang="ts">
    import { onMount, onDestroy } from 'svelte'
    import {
        localDateStr, localMidnight, splitAtMidnight,
        buildDayMap, buildLastPlayedOverlay, buildReleaseMap, MONTHS,
    } from '../../js/views/calendar-render.js'
    import type { DayEntry, ReleaseEntry } from '../../js/views/calendar-render.js'
    import type { NowPlayingSession } from '../../types.js'
    import { getWithTTL, setWithTTL } from '../../js/storage.js'
    import CalendarMonth from './CalendarMonth.svelte'

    type SlimGame = { appid: number; name: string; rtime_last_played?: number }
    const LP_CACHE_KEY = 'cal-lp-games'
    const LP_CACHE_TTL = 7 * 24 * 60 * 60 * 1000

    let { mode = 'play' } = $props()

    // ── State ──────────────────────────────────────────────────────────────────

    let localMode  = $state(mode)
    let year       = $state(new Date().getFullYear())
    let monthIdx   = $state(new Date().getMonth())
    let dayMap     = $state<Map<string, DayEntry[]>>(new Map())
    let releaseMap = $state<Map<string, ReleaseEntry[]>>(new Map())
    let loading    = $state(true)
    let error      = $state<string | null>(null)
    let today      = $state(localDateStr(new Date()))

    // Live session state
    let liveSession        = $state<NowPlayingSession | null>(null)
    let liveBase           = $state(0)
    let liveEffectiveStart = $state<string | null>(null)
    let liveDate           = $state<string | null>(null)
    let liveTick           = $state(0)

    let _liveTimer: ReturnType<typeof setInterval> | null = null

    let effectiveDayMap = $derived.by(() => {
        liveTick
        return buildEffectiveDayMap()
    })

    function buildEffectiveDayMap() {
        const session = liveSession
        if (!session || localMode !== 'play') return dayMap

        const todayStr   = localDateStr(new Date())
        const startMs    = liveEffectiveStart
            ? new Date(liveEffectiveStart).getTime()
            : (session.sessionStartedAt ? new Date(session.sessionStartedAt).getTime() : Date.now())
        const liveMin    = Math.max(1, Math.floor((Date.now() - startMs) / 60_000))
        const totalMin   = liveBase + liveMin

        const baseEntries = dayMap.get(todayStr) ?? []
        const existingIdx = baseEntries.findIndex(e => e.appid === session.appid)
        let todayEntries

        if (existingIdx >= 0) {
            todayEntries = baseEntries.map((e, i) =>
                i === existingIdx ? { ...e, durationMin: totalMin, isLive: true } : e
            )
        } else {
            todayEntries = [...baseEntries, {
                appid:       session.appid,
                name:        session.name ?? '',
                durationMin: totalMin,
                isLive:      true,
            }]
        }

        const m = new Map(dayMap)
        m.set(todayStr, todayEntries)
        return m
    }

    // ── Live session poller (play mode only) ──────────────────────────────────

    function startLivePoller() {
        liveDate = localDateStr(new Date())
        pollLive()
        _liveTimer = setInterval(pollLive, 60_000)
    }

    function stopLivePoller() {
        if (_liveTimer) { clearInterval(_liveTimer); _liveTimer = null }
        liveSession        = null
        liveBase           = 0
        liveEffectiveStart = null
        liveDate           = null
    }

    function commitToDay(dateStr: string, appid: number, name: string, durationMin: number) {
        const entries = [...(dayMap.get(dateStr) ?? [])]
        const idx     = entries.findIndex(e => e.appid === appid)
        if (idx >= 0) entries[idx] = { ...entries[idx], durationMin }
        else          entries.push({ appid, name, durationMin })
        const m = new Map(dayMap)
        m.set(dateStr, entries)
        dayMap = m
    }

    function freezeLiveSession() {
        const session = liveSession
        if (!session) return
        const todayStr = localDateStr(new Date())
        const startMs  = liveEffectiveStart
            ? new Date(liveEffectiveStart).getTime()
            : (session.sessionStartedAt ? new Date(session.sessionStartedAt).getTime() : Date.now())
        const liveMin    = Math.max(1, Math.floor((Date.now() - startMs) / 60_000))
        const frozenMin  = liveBase + liveMin
        commitToDay(todayStr, session.appid, session.name ?? '', frozenMin)
    }

    async function pollLive() {
        try {
            const res = await fetch('/relay/api/steam/now-playing')
            if (!res.ok) return
            const { playing } = await res.json()

            const todayStr    = localDateStr(new Date())
            const prevAppid   = liveSession?.appid ?? null
            const currAppid   = playing?.appid ?? null
            const prevStarted = liveSession?.sessionStartedAt ?? null
            const currStarted = playing?.sessionStartedAt ?? null
            const sessionChanged = (currAppid !== prevAppid) || (currStarted !== prevStarted)

            // Midnight rollover
            const activeSession = liveSession
            if (!sessionChanged && activeSession && liveDate && liveDate !== todayStr) {
                const midnight     = localMidnight(todayStr)
                const prevEffStart = liveEffectiveStart ?? activeSession.sessionStartedAt ?? new Date().toISOString()
                const prevDayMin   = Math.max(1, Math.floor((midnight - new Date(prevEffStart).getTime()) / 60_000))
                commitToDay(liveDate, activeSession.appid, activeSession.name ?? '', prevDayMin)
                liveEffectiveStart = new Date(midnight).toISOString()
                liveBase = (dayMap.get(todayStr) ?? []).find(e => e.appid === activeSession.appid)?.durationMin ?? 0
            }

            if (sessionChanged) {
                if (prevAppid !== null) freezeLiveSession()

                if (currAppid !== null) {
                    const sessionDay = localDateStr(playing.sessionStartedAt)
                    if (sessionDay !== todayStr) {
                        const midnight = localMidnight(todayStr)
                        liveEffectiveStart = new Date(midnight).toISOString()
                        const prevDayMin = Math.max(1, Math.floor((midnight - new Date(playing.sessionStartedAt).getTime()) / 60_000))
                        commitToDay(sessionDay, currAppid, playing.name, prevDayMin)
                    } else {
                        liveEffectiveStart = playing.sessionStartedAt ?? new Date().toISOString()
                    }
                    liveBase = (dayMap.get(todayStr) ?? []).find(e => e.appid === currAppid)?.durationMin ?? 0
                } else {
                    liveBase           = 0
                    liveEffectiveStart = null
                }
            }

            liveDate    = todayStr
            liveSession = playing ?? null
            liveTick    = Date.now()
            today       = todayStr
        } catch { /* silent */ }
    }

    // ── Load ───────────────────────────────────────────────────────────────────

    async function loadData(m: string) {
        loading = true
        error   = null
        dayMap     = new Map()
        releaseMap = new Map()
        try {
            if (m === 'play') {
                const cachedGames = getWithTTL<SlimGame[]>(LP_CACHE_KEY)
                const fetches: Promise<Response>[] = [
                    fetch('/relay/api/account'),
                    fetch('/api/flags'),
                    fetch('/api/settings'),
                ]
                if (!cachedGames) fetches.push(fetch('/relay/api/steam/games'))
                const responses  = await Promise.all(fetches)
                const [accountRes, flagsRes, settingsRes] = responses

                if (!accountRes.ok) throw new Error(`HTTP ${accountRes.status}`)
                const data     = await accountRes.json()
                const flags    = flagsRes.ok    ? await flagsRes.json()    : {}
                const settings = settingsRes.ok ? await settingsRes.json() : {}
                const base     = buildDayMap(data.sessions ?? {}, flags, settings)

                let games: SlimGame[]
                if (cachedGames) {
                    games = cachedGames
                } else {
                    const gamesRes  = responses[3]
                    const gamesJson = gamesRes?.ok ? await gamesRes.json() : []
                    const raw: any[] = Array.isArray(gamesJson)                                       ? gamesJson
                                     : Array.isArray(gamesJson.games)                                ? gamesJson.games
                                     : Array.isArray(gamesJson.data)                                 ? gamesJson.data
                                     : gamesJson.response && Array.isArray(gamesJson.response.games) ? gamesJson.response.games
                                     : []
                    games = raw.map(g => ({ appid: g.appid, name: g.name, rtime_last_played: g.rtime_last_played }))
                    setWithTTL(LP_CACHE_KEY, games, LP_CACHE_TTL)
                }

                dayMap = buildLastPlayedOverlay(games, base, flags, settings)
                startLivePoller()
            } else {
                const res = await fetch('/relay/api/steam/releases')
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
                const data = await res.json()
                releaseMap = buildReleaseMap(data.releases ?? [])
            }
        } catch (err) {
            error = `Failed to load ${m === 'play' ? 'calendar' : 'releases'}: ${(err as Error).message}`
        } finally {
            loading = false
        }
    }

    function setMode(m: string) {
        if (m === localMode) return
        stopLivePoller()
        localMode = m
        const url = new URL(window.location.href)
        if (m === 'play') url.searchParams.delete('mode')
        else              url.searchParams.set('mode', m)
        history.replaceState({}, '', url.toString())
        loadData(m)
    }

    // ── Keyboard navigation ───────────────────────────────────────────────────

    $effect(() => {
        function onKeydown(e: KeyboardEvent) {
            const tag = (e.target as HTMLElement).tagName
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault()
                if (monthIdx === 0) { monthIdx = 11; year-- }
                else monthIdx--
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault()
                if (monthIdx === 11) { monthIdx = 0; year++ }
                else monthIdx++
            }
        }
        window.addEventListener('keydown', onKeydown)
        return () => window.removeEventListener('keydown', onKeydown)
    })

    onMount(async () => {
        const mainEl = document.getElementById('main-content')
        if (mainEl) mainEl.style.overflow = 'hidden'
        await loadData(localMode)
    })

    onDestroy(() => {
        stopLivePoller()
        const mainEl = document.getElementById('main-content')
        if (mainEl) mainEl.style.overflow = ''
    })
</script>

<div class="cal-page">
    <div class="cal-nav">
        <span class="cal-nav-title">Calendar</span>
        <span class="cal-nav-year">{year}</span>
        <div class="cal-mode-toggle">
            <button class="cal-mode-btn" class:cal-mode-btn--active={localMode === 'play'}
                onclick={() => setMode('play')}>Play</button>
            <button class="cal-mode-btn" class:cal-mode-btn--active={localMode === 'releases'}
                onclick={() => setMode('releases')}>Releases</button>
        </div>
        <div class="cal-nav-right">
            <button class="cal-nav-btn" onclick={() => year--}>← {year - 1}</button>
            <button class="cal-nav-btn" onclick={() => year++}>{year + 1} →</button>
        </div>
        <div class="cal-nav-sep"></div>
        <div class="cal-month-tabs">
            {#each MONTHS as name, m}
                <button
                    class="cal-month-tab"
                    class:cal-month-tab--active={m === monthIdx}
                    onclick={() => monthIdx = m}
                >{name.slice(0, 3)}</button>
            {/each}
        </div>
    </div>
    <div class="cal-grid">
        {#if loading}
            <div class="cal-loading"><div class="community-loader"></div></div>
        {:else if error}
            <p class="page-error">{error}</p>
        {:else}
            <CalendarMonth
                {year}
                monthIdx={monthIdx}
                name={MONTHS[monthIdx]}
                {today}
                dayMap={effectiveDayMap}
                {releaseMap}
                mode={localMode}
            />
        {/if}
    </div>
</div>
