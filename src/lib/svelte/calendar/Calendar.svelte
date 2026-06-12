<script>
    import { onMount, onDestroy, tick } from 'svelte'
    import {
        localDateStr, localMidnight, splitAtMidnight,
        buildDayMap, buildReleaseMap, buildMonth, MONTHS,
    } from '../../js/views/calendar-render.js'

    let { mode = 'play' } = $props()

    // ── State ──────────────────────────────────────────────────────────────────

    let year       = $state(new Date().getFullYear())
    let dayMap     = $state(new Map())
    let releaseMap = $state(new Map())
    let loading    = $state(true)
    let error      = $state(null)
    let calEl      = $state(null)

    // Live session state
    let liveSession        = $state(null)
    let liveBase           = $state(0)
    let liveEffectiveStart = $state(null)
    let liveDate           = $state(null)
    let liveTick           = $state(0)   // incremented each poll to force re-derive

    let _liveTimer = null

    // ── Derived calendar HTML ──────────────────────────────────────────────────

    let calendarHtml = $derived.by(() => {
        // Track all reactive inputs
        liveTick; year; mode

        const today    = localDateStr(new Date())
        const effectiveDayMap = buildEffectiveDayMap()

        return MONTHS.map((name, m) =>
            buildMonth(year, m, name, today, effectiveDayMap, releaseMap, mode)
        ).join('')
    })

    function buildEffectiveDayMap() {
        if (!liveSession || mode !== 'play') return dayMap

        const todayStr   = localDateStr(new Date())
        const startMs    = liveEffectiveStart
            ? new Date(liveEffectiveStart).getTime()
            : (liveSession.sessionStartedAt ? new Date(liveSession.sessionStartedAt).getTime() : Date.now())
        const liveMin    = Math.max(1, Math.floor((Date.now() - startMs) / 60_000))
        const totalMin   = liveBase + liveMin

        const baseEntries = dayMap.get(todayStr) ?? []
        const existingIdx = baseEntries.findIndex(e => e.appid === liveSession.appid)
        let todayEntries

        if (existingIdx >= 0) {
            todayEntries = baseEntries.map((e, i) =>
                i === existingIdx ? { ...e, durationMin: totalMin, isLive: true } : e
            )
        } else {
            todayEntries = [...baseEntries, {
                appid:       liveSession.appid,
                name:        liveSession.name,
                durationMin: totalMin,
                isLive:      true,
            }]
        }

        const m = new Map(dayMap)
        m.set(todayStr, todayEntries)
        return m
    }

    // ── Scroll to current month ────────────────────────────────────────────────

    $effect(() => {
        year; calendarHtml // track changes
        tick().then(() => {
            if (year === new Date().getFullYear()) {
                calEl?.querySelector('#cal-month-current')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
        })
    })

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

    function commitToDay(dateStr, appid, name, durationMin) {
        const entries = [...(dayMap.get(dateStr) ?? [])]
        const idx     = entries.findIndex(e => e.appid === appid)
        if (idx >= 0) entries[idx] = { ...entries[idx], durationMin }
        else          entries.push({ appid, name, durationMin })
        const m = new Map(dayMap)
        m.set(dateStr, entries)
        dayMap = m
    }

    function freezeLiveSession() {
        if (!liveSession) return
        const todayStr = localDateStr(new Date())
        const startMs  = liveEffectiveStart
            ? new Date(liveEffectiveStart).getTime()
            : (liveSession.sessionStartedAt ? new Date(liveSession.sessionStartedAt).getTime() : Date.now())
        const liveMin    = Math.max(1, Math.floor((Date.now() - startMs) / 60_000))
        const frozenMin  = liveBase + liveMin
        commitToDay(todayStr, liveSession.appid, liveSession.name, frozenMin)
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
            if (!sessionChanged && liveSession && liveDate && liveDate !== todayStr) {
                const midnight     = localMidnight(todayStr)
                const prevEffStart = liveEffectiveStart ?? liveSession.sessionStartedAt
                const prevDayMin   = Math.max(1, Math.floor((midnight - new Date(prevEffStart).getTime()) / 60_000))
                commitToDay(liveDate, liveSession.appid, liveSession.name, prevDayMin)
                liveEffectiveStart = new Date(midnight).toISOString()
                liveBase = (dayMap.get(todayStr) ?? []).find(e => e.appid === liveSession.appid)?.durationMin ?? 0
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
        } catch { /* silent */ }
    }

    // ── Load ───────────────────────────────────────────────────────────────────

    onMount(async () => {
        try {
            if (mode === 'play') {
                const [accountRes, flagsRes, settingsRes] = await Promise.all([
                    fetch('/relay/api/account'),
                    fetch('/api/flags'),
                    fetch('/api/settings'),
                ])
                if (!accountRes.ok) throw new Error(`HTTP ${accountRes.status}`)
                const data     = await accountRes.json()
                const flags    = flagsRes.ok    ? await flagsRes.json()    : {}
                const settings = settingsRes.ok ? await settingsRes.json() : {}
                dayMap = buildDayMap(data.sessions ?? {}, flags, settings)
                startLivePoller()
            } else {
                const res = await fetch('/relay/api/steam/releases')
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
                const data = await res.json()
                releaseMap = buildReleaseMap(data.releases ?? [])
            }
        } catch (err) {
            error = `Failed to load ${mode === 'play' ? 'calendar' : 'releases'}: ${err.message}`
        } finally {
            loading = false
        }
    })

    onDestroy(stopLivePoller)
</script>

{#if loading}
    <p class="page-loading">Loading {mode === 'play' ? 'calendar' : 'releases'}…</p>
{:else if error}
    <p class="page-error">{error}</p>
{:else}
    <div class="page-header">
        <h1 class="page-title">{mode === 'play' ? 'Play Calendar' : 'Release Calendar'}</h1>
    </div>
    <div class="cal-nav">
        <button class="cal-nav-btn" onclick={() => year--}>← {year - 1}</button>
        <span class="cal-nav-year">{year}</span>
        <button class="cal-nav-btn" onclick={() => year++}>{year + 1} →</button>
    </div>
    <div class="cal-grid" bind:this={calEl}>
        {@html calendarHtml}
    </div>
{/if}
