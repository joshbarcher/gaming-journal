import { escapeHtml, localDateStr } from '../utils.js'
import { loadGameFilter } from './game-filter.js'

export async function renderAccount(container) {
    container.innerHTML = `<p class="page-loading">Loading account…</p>`

    let data, shouldShow
    try {
        const [res, filter] = await Promise.all([
            fetch('/relay/api/account'),
            loadGameFilter(),
        ])
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        data = await res.json()
        shouldShow = filter
    } catch (err) {
        container.innerHTML = `<p class="page-error">Failed to load account: ${escapeHtml(err.message)}</p>`
        return
    }

    const { profile, steam, stats, sessions } = data
    const recentlyPlayed = (data.recentlyPlayed ?? []).filter(g => shouldShow(g.appid))
    const mostPlayed     = (data.mostPlayed     ?? []).filter(g => shouldShow(g.appid))

    container.innerHTML = `
        ${_hero(profile, steam)}
        ${_statsStrip(stats)}
        ${_recentSection(recentlyPlayed)}
        ${_mostPlayed(mostPlayed)}
        ${_sessionHistory(sessions, shouldShow)}
    `
}

// ── Profile hero ──────────────────────────────────────────────────────────────

function _hero(profile, steam) {
    const memberYear = profile.memberSince ?? '?'
    const lastSeen   = profile.lastLogoff
        ? _fmtDate(profile.lastLogoff)
        : 'Unknown'
    const xpDisplay  = steam.xp != null
        ? `${steam.xp.toLocaleString()} XP`
        : ''
    const levelBadge = steam.level != null
        ? `<span class="acct-level-badge">Lvl ${steam.level}</span>`
        : ''

    return `
    <div class="acct-hero">
        ${profile.avatar ? `<img class="acct-avatar" src="${escapeHtml(profile.avatar)}" alt="avatar">` : ''}
        <div class="acct-hero-info">
            <h1 class="acct-name">${escapeHtml(profile.name)}</h1>
            ${profile.realName ? `<p class="acct-realname">${escapeHtml(profile.realName)}</p>` : ''}
            <div class="acct-hero-meta">
                ${levelBadge}
                ${xpDisplay ? `<span class="acct-xp">${xpDisplay}</span>` : ''}
            </div>
            <p class="acct-hero-sub">Member since ${memberYear} · Last seen ${lastSeen}</p>
            ${profile.profileUrl ? `<a class="acct-steam-link" href="${escapeHtml(profile.profileUrl)}" target="_blank" rel="noopener">View Steam Profile →</a>` : ''}
        </div>
    </div>`
}

// ── Stats strip ───────────────────────────────────────────────────────────────

function _statsStrip(stats) {
    const tiles = [
        { label: 'Hours Played',   value: stats.totalHoursPlayed?.toLocaleString() ?? '—' },
        { label: 'Games Played',   value: stats.gamesPlayed?.toLocaleString()      ?? '—' },
        { label: 'Achievements',   value: stats.achievementsUnlocked?.toLocaleString() ?? '—' },
        { label: 'Reviews',        value: stats.reviewsWritten?.toLocaleString()    ?? '—' },
        { label: 'Library',        value: stats.totalGames?.toLocaleString()        ?? '—' },
        { label: 'Wishlist',       value: stats.wishlistCount?.toLocaleString()     ?? '—' },
    ]
    return `
    <div class="acct-stats-strip">
        ${tiles.map(t => `
            <div class="acct-stat-tile">
                <span class="acct-stat-value">${t.value}</span>
                <span class="acct-stat-label">${t.label}</span>
            </div>`).join('')}
    </div>`
}

// ── Recent section ────────────────────────────────────────────────────────────

function _recentSection(recentlyPlayed) {
    if (!recentlyPlayed.length) return ''
    return `
    <section class="acct-section">
        <h2 class="acct-section-title">Recently Played</h2>
        <div class="acct-card-row">
            ${recentlyPlayed.map(g => {
                const sub = g.playtime2weeks
                    ? `${_fmtMins(g.playtime2weeks)} this week`
                    : g.lastPlayedAt ? _fmtDate(g.lastPlayedAt) : ''
                return _gameCard(g.appid, g.name, sub, _fmtHrs(g.playtimeMin))
            }).join('')}
        </div>
    </section>`
}

function _gameCard(appid, name, sub, hrs) {
    return `
    <a class="acct-game-card lib-card" href="/game/${appid}">
        <div class="lib-card-img-wrap">
            <img class="lib-card-img" src="/relay/images/steam/games/${appid}/header.jpg"
                 alt="${escapeHtml(name)}" loading="lazy"
                 onerror="this.style.display='none'">
        </div>
        <div class="lib-card-info">
            <span class="lib-card-name">${escapeHtml(name)}</span>
            <span class="acct-card-sub">${escapeHtml(sub)}</span>
            <span class="acct-card-hrs">${escapeHtml(hrs)}</span>
        </div>
    </a>`
}

// ── Most played ───────────────────────────────────────────────────────────────

function _mostPlayed(mostPlayed) {
    if (!mostPlayed.length) return ''
    const maxMin = mostPlayed[0].playtimeMin

    return `
    <section class="acct-section">
        <h2 class="acct-section-title">Most Played</h2>
        <div class="acct-most-played">
            ${mostPlayed.map((g, i) => `
            <a class="acct-mp-row" href="/game/${g.appid}">
                <span class="acct-mp-rank">${i + 1}</span>
                <span class="acct-mp-name">${escapeHtml(g.name)}</span>
                <div class="acct-mp-bar-wrap">
                    <div class="acct-mp-bar" style="width:${Math.round((g.playtimeMin / maxMin) * 100)}%"></div>
                </div>
                <span class="acct-mp-hrs">${_fmtHrs(g.playtimeMin)}</span>
            </a>`).join('')}
        </div>
    </section>`
}

// ── Session history ───────────────────────────────────────────────────────────

function _sessionHistory(sessions, shouldShow) {
    const entries = Object.entries(sessions).filter(([appid]) => shouldShow(Number(appid)))
    if (!entries.length) return `
    <section class="acct-section">
        <h2 class="acct-section-title">Session History</h2>
        <p class="acct-empty">No sessions recorded yet. Session tracking builds over time.</p>
    </section>`

    // Flatten all sessions with game info, sort newest first
    const flat = []
    for (const [, game] of entries) {
        for (const s of game.sessions ?? []) {
            flat.push({ name: game.name, ...s })
        }
    }
    flat.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))

    // Group by date
    const byDay = new Map()
    for (const s of flat) {
        const day = localDateStr(s.startedAt)
        if (!byDay.has(day)) byDay.set(day, [])
        byDay.get(day).push(s)
    }

    const rows = [...byDay.entries()].map(([day, ss]) => `
        <div class="acct-session-day">
            <span class="acct-session-date">${_fmtDayLabel(day)}</span>
            ${ss.map(s => `
            <div class="acct-session-row">
                <span class="acct-session-name">${escapeHtml(s.name)}</span>
                <span class="acct-session-dur">${s.durationMin} min</span>
            </div>`).join('')}
        </div>`).join('')

    return `
    <section class="acct-section">
        <h2 class="acct-section-title">Session History</h2>
        <div class="acct-sessions">${rows}</div>
    </section>`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _fmtHrs(minutes) {
    if (minutes == null) return ''
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    if (h === 0) return `${m}m`
    if (m === 0) return `${h}h`
    return `${h}h ${m}m`
}

function _fmtMins(minutes) {
    if (!minutes) return '0m'
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    if (h === 0) return `${m}m`
    return `${h}h ${m}m`
}

function _fmtDate(iso) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function _fmtDayLabel(dayStr) {
    return new Date(dayStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}
