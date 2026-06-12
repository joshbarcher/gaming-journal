<script>
    import { onMount } from 'svelte'
    import { localDateStr } from '../../js/utils.js'
    import { loadGameFilter } from '../../js/views/game-filter.js'

    let loading        = $state(true)
    let error          = $state(null)
    let profile        = $state(null)
    let steam          = $state(null)
    let stats          = $state(null)
    let recentlyPlayed = $state([])
    let mostPlayed     = $state([])
    let sessionsByDay  = $state([])
    let liveTimes      = $state({})   // startedAt → formatted duration

    function fmtHrs(minutes) {
        if (minutes == null) return ''
        const h = Math.floor(minutes / 60)
        const m = minutes % 60
        if (h === 0) return `${m}m`
        if (m === 0) return `${h}h`
        return `${h}h ${m}m`
    }

    function fmtMins(minutes) {
        if (!minutes) return '0m'
        const h = Math.floor(minutes / 60)
        const m = minutes % 60
        if (h === 0) return `${m}m`
        return `${h}h ${m}m`
    }

    function fmtDate(iso) {
        return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }

    function fmtDayLabel(dayStr) {
        return new Date(dayStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    }

    function tickLive(liveSessions) {
        const times = {}
        for (const s of liveSessions) {
            const mins = Math.max(1, Math.floor(
                (Date.now() - new Date(s.startedAt).getTime()) / 60_000
            ))
            times[s.startedAt] = fmtHrs(mins)
        }
        liveTimes = times
    }

    onMount(async () => {
        let data, shouldShow
        try {
            const [res, filter] = await Promise.all([
                fetch('/relay/api/account'),
                loadGameFilter(),
            ])
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            data      = await res.json()
            shouldShow = filter
        } catch (err) {
            error   = err.message
            loading = false
            return
        }

        profile        = data.profile
        steam          = data.steam
        stats          = data.stats
        recentlyPlayed = (data.recentlyPlayed ?? []).filter(g => shouldShow(g.appid))
        mostPlayed     = (data.mostPlayed     ?? []).filter(g => shouldShow(g.appid))

        const sessions = data.sessions ?? {}
        const entries  = Object.entries(sessions).filter(([appid]) => shouldShow(Number(appid)))
        const flat     = []
        for (const [, game] of entries) {
            for (const s of game.sessions ?? []) flat.push({ name: game.name, ...s })
        }
        flat.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))

        const byDay = new Map()
        for (const s of flat) {
            const day = localDateStr(s.startedAt)
            if (!byDay.has(day)) byDay.set(day, [])
            byDay.get(day).push(s)
        }
        sessionsByDay = [...byDay.entries()].map(([day, ss]) => ({
            day, label: fmtDayLabel(day), sessions: ss,
        }))

        loading = false

        const liveSessions = flat.filter(s => s.endedAt === null)
        if (liveSessions.length) {
            tickLive(liveSessions)
            const timer = setInterval(() => tickLive(liveSessions), 30_000)
            return () => clearInterval(timer)
        }
    })
</script>

{#if loading}
    <p class="page-loading">Loading account…</p>
{:else if error}
    <p class="page-error">Failed to load account: {error}</p>
{:else}
    <!-- Hero -->
    <div class="acct-hero">
        {#if profile.avatar}
            <img class="acct-avatar" src={profile.avatar} alt="avatar">
        {/if}
        <div class="acct-hero-info">
            <h1 class="acct-name">{profile.name}</h1>
            {#if profile.realName}<p class="acct-realname">{profile.realName}</p>{/if}
            <div class="acct-hero-meta">
                {#if steam.level != null}<span class="acct-level-badge">Lvl {steam.level}</span>{/if}
                {#if steam.xp != null}<span class="acct-xp">{steam.xp.toLocaleString()} XP</span>{/if}
            </div>
            <p class="acct-hero-sub">Member since {profile.memberSince ?? '?'} · Last seen {profile.lastLogoff ? fmtDate(profile.lastLogoff) : 'Unknown'}</p>
            {#if profile.profileUrl}
                <a class="acct-steam-link" href={profile.profileUrl} target="_blank" rel="noopener">View Steam Profile →</a>
            {/if}
        </div>
    </div>

    <!-- Stats strip -->
    <div class="acct-stats-strip">
        {#each [
            { label: 'Hours Played', value: stats.totalHoursPlayed?.toLocaleString() ?? '—' },
            { label: 'Games Played', value: stats.gamesPlayed?.toLocaleString()      ?? '—' },
            { label: 'Achievements', value: stats.achievementsUnlocked?.toLocaleString() ?? '—' },
            { label: 'Reviews',      value: stats.reviewsWritten?.toLocaleString()    ?? '—' },
            { label: 'Library',      value: stats.totalGames?.toLocaleString()        ?? '—' },
            { label: 'Wishlist',     value: stats.wishlistCount?.toLocaleString()     ?? '—' },
        ] as tile}
            <div class="acct-stat-tile">
                <span class="acct-stat-value">{tile.value}</span>
                <span class="acct-stat-label">{tile.label}</span>
            </div>
        {/each}
    </div>

    <!-- Recently played -->
    {#if recentlyPlayed.length > 0}
        <section class="acct-section">
            <h2 class="acct-section-title">Recently Played</h2>
            <div class="acct-card-row">
                {#each recentlyPlayed as g (g.appid)}
                    {@const sub = g.playtime2weeks ? `${fmtMins(g.playtime2weeks)} this week` : g.lastPlayedAt ? fmtDate(g.lastPlayedAt) : ''}
                    <a class="acct-game-card lib-card" href="/game/{g.appid}">
                        <div class="lib-card-img-wrap">
                            <img class="lib-card-img" src="/relay/images/steam/games/{g.appid}/header.jpg"
                                 alt={g.name} loading="lazy"
                                 onerror={(e) => { e.currentTarget.style.display = 'none' }}>
                        </div>
                        <div class="lib-card-info">
                            <span class="lib-card-name">{g.name}</span>
                            <span class="acct-card-sub">{sub}</span>
                            <span class="acct-card-hrs">{fmtHrs(g.playtimeMin)}</span>
                        </div>
                    </a>
                {/each}
            </div>
        </section>
    {/if}

    <!-- Most played -->
    {#if mostPlayed.length > 0}
        {@const maxMin = mostPlayed[0].playtimeMin}
        <section class="acct-section">
            <h2 class="acct-section-title">Most Played</h2>
            <div class="acct-most-played">
                {#each mostPlayed as g, i (g.appid)}
                    <a class="acct-mp-row" href="/game/{g.appid}">
                        <span class="acct-mp-rank">{i + 1}</span>
                        <img class="acct-mp-img" src="/relay/images/steam/games/{g.appid}/header.jpg"
                             alt="" loading="lazy"
                             onerror={(e) => { e.currentTarget.style.visibility = 'hidden' }}>
                        <span class="acct-mp-name">{g.name}</span>
                        <div class="acct-mp-bar-wrap">
                            <div class="acct-mp-bar" style="width:{Math.round((g.playtimeMin / maxMin) * 100)}%"></div>
                        </div>
                        <span class="acct-mp-hrs">{fmtHrs(g.playtimeMin)}</span>
                    </a>
                {/each}
            </div>
        </section>
    {/if}

    <!-- Session history -->
    <section class="acct-section">
        <h2 class="acct-section-title">Session History</h2>
        {#if sessionsByDay.length === 0}
            <p class="acct-empty">No sessions recorded yet. Session tracking builds over time.</p>
        {:else}
            <div class="acct-sessions">
                {#each sessionsByDay as { label, sessions: ss }}
                    <div class="acct-session-day">
                        <span class="acct-session-date">{label}</span>
                        {#each ss as s}
                            {#if s.endedAt === null}
                                <div class="acct-session-row acct-session-row--live" data-started-at={s.startedAt}>
                                    <span class="acct-session-name">{s.name}</span>
                                    <span class="acct-session-live-badge"><span class="acct-live-dot"></span>Now Playing</span>
                                    <span class="acct-session-dur">{liveTimes[s.startedAt] ?? fmtHrs(Math.max(1, Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 60_000)))}</span>
                                </div>
                            {:else}
                                <div class="acct-session-row">
                                    <span class="acct-session-name">{s.name}</span>
                                    <span class="acct-session-dur">{fmtHrs(s.durationMin)}</span>
                                </div>
                            {/if}
                        {/each}
                    </div>
                {/each}
            </div>
        {/if}
    </section>
{/if}
