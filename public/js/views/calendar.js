import { escapeHtml } from '../utils.js'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DOW    = ['Su','Mo','Tu','We','Th','Fr','Sa']

let _year        = new Date().getFullYear()
let _dayMap      = new Map()   // 'YYYY-MM-DD' → [{ appid, name, durationMin }]  (one entry per appid, aggregated)
let _releaseMap  = new Map()   // 'YYYY-MM-DD' → [{ appid, name }]
let _container   = null
let _mode        = 'play'      // 'play' | 'releases'

// ── Live session state ────────────────────────────────────────────────────────
// _liveSession  — what the relay says is currently playing
// _liveBase     — minutes already committed in _dayMap for this game *before* the
//                 current session started; live display = _liveBase + liveElapsed
let _liveSession = null   // { appid, name, sessionStartedAt } | null
let _liveBase    = 0
let _liveTimer   = null

// ── Public entry points ───────────────────────────────────────────────────────

export async function renderCalendar(container) {
    _mode      = 'play'
    _container = container
    _dayMap    = new Map()
    _stopLivePoller()
    container.innerHTML = `<p class="page-loading">Loading calendar…</p>`

    try {
        const [accountRes, flagsRes] = await Promise.all([
            fetch('/relay/api/account'),
            fetch('/api/flags'),
        ])
        if (!accountRes.ok) throw new Error(`HTTP ${accountRes.status}`)
        const data  = await accountRes.json()
        const flags = flagsRes.ok ? await flagsRes.json() : {}
        _dayMap = _buildDayMap(data.sessions ?? {}, flags)
    } catch (err) {
        container.innerHTML = `<p class="page-error">Failed to load calendar: ${escapeHtml(err.message)}</p>`
        return
    }

    _year = new Date().getFullYear()
    _draw()
    _startLivePoller()
}

export async function renderReleases(container) {
    _mode       = 'releases'
    _container  = container
    _releaseMap = new Map()
    _stopLivePoller()
    container.innerHTML = `<p class="page-loading">Loading releases…</p>`

    try {
        const res = await fetch('/relay/api/steam/releases')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        _releaseMap = _buildReleaseMap(data.releases ?? [])
    } catch (err) {
        container.innerHTML = `<p class="page-error">Failed to load releases: ${escapeHtml(err.message)}</p>`
        return
    }

    _year = new Date().getFullYear()
    _draw()
}

// ── Timezone-safe local date string ──────────────────────────────────────────
// Always use local time — never slice an ISO UTC string.

function _localDateStr(d) {
    const date = (typeof d === 'string' || typeof d === 'number') ? new Date(d) : d
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// ── Live session poller ───────────────────────────────────────────────────────

function _startLivePoller() {
    _pollLive()
    _liveTimer = setInterval(_pollLive, 60_000)
}

function _stopLivePoller() {
    if (_liveTimer) { clearInterval(_liveTimer); _liveTimer = null }
    _liveSession = null
    _liveBase    = 0
}

async function _pollLive() {
    try {
        const res = await fetch('/relay/api/steam/now-playing')
        if (!res.ok) return
        const { playing } = await res.json()

        const prevAppid   = _liveSession?.appid ?? null
        const currAppid   = playing?.appid ?? null
        const prevStarted = _liveSession?.sessionStartedAt ?? null
        const currStarted = playing?.sessionStartedAt ?? null

        // Session changed: different game, game stopped, or same game restarted
        // (sessionStartedAt changes when the relay detects a new start)
        const sessionChanged = (currAppid !== prevAppid) || (currStarted !== prevStarted)

        if (sessionChanged) {
            // Commit the previous session before switching
            if (prevAppid !== null) _freezeLiveSession()

            if (currAppid !== null) {
                // _liveBase = minutes already in _dayMap for this game today,
                // representing sessions committed *before* this new session started.
                const todayStr = _localDateStr(new Date())
                const existing = (_dayMap.get(todayStr) ?? []).find(e => e.appid === currAppid)
                _liveBase = existing?.durationMin ?? 0
            } else {
                _liveBase = 0
            }
        }

        _liveSession = playing ?? null
        _patchTodayCell()
    } catch { /* silent — non-critical */ }
}

// Bake the current live session into _dayMap as a plain (non-live) entry so
// the time persists on the calendar while the 30-min snapshot catches up.
function _freezeLiveSession() {
    if (!_liveSession) return
    const todayStr  = _localDateStr(new Date())
    const startMs   = _liveSession.sessionStartedAt
        ? new Date(_liveSession.sessionStartedAt).getTime()
        : Date.now()
    const liveMin    = Math.max(1, Math.floor((Date.now() - startMs) / 60_000))
    const frozenMin  = _liveBase + liveMin   // base + this session's elapsed = total for today

    const entries = [...(_dayMap.get(todayStr) ?? [])]
    const idx     = entries.findIndex(e => e.appid === _liveSession.appid)
    if (idx >= 0) {
        entries[idx] = { ...entries[idx], durationMin: frozenMin }
    } else {
        entries.push({ appid: _liveSession.appid, name: _liveSession.name, durationMin: frozenMin })
    }
    _dayMap.set(todayStr, entries)
}

function _patchTodayCell() {
    if (_mode !== 'play' || !_container) return
    const existing = _container.querySelector('.cal-cell--today')
    if (!existing) return   // not viewing current year

    const todayStr    = _localDateStr(new Date())
    const baseEntries = _dayMap.get(todayStr) ?? []
    let entries       = [...baseEntries]

    if (_liveSession) {
        const startMs  = _liveSession.sessionStartedAt
            ? new Date(_liveSession.sessionStartedAt).getTime()
            : Date.now()
        const liveMin  = Math.max(1, Math.floor((Date.now() - startMs) / 60_000))
        // Total = committed base (before this session) + this session's elapsed time
        const totalMin = _liveBase + liveMin

        const existingIdx = entries.findIndex(e => e.appid === _liveSession.appid)
        if (existingIdx >= 0) {
            entries = entries.map((e, i) => i === existingIdx
                ? { ...e, durationMin: totalMin, isLive: true }
                : e)
        } else {
            entries = [...entries, {
                appid:       _liveSession.appid,
                name:        _liveSession.name,
                durationMin: totalMin,
                isLive:      true,
            }]
        }
    }

    const day = Number(existing.querySelector('.cal-day-num')?.textContent)
    if (!day) return

    const tmp = document.createElement('div')
    tmp.innerHTML = _buildCell(day, true, entries, [])
    const newCell = tmp.firstElementChild
    if (newCell) existing.replaceWith(newCell)
}

// ── Data builders ─────────────────────────────────────────────────────────────

function _buildDayMap(sessions, flags = {}) {
    // Two-level aggregation: day → Map<appid, entry>
    // Multiple sessions for the same game on the same day are summed into one entry.
    const raw = new Map()

    for (const [appidStr, game] of Object.entries(sessions)) {
        if (flags[appidStr]?.software || flags[Number(appidStr)]?.software) continue
        const appid = Number(appidStr)
        for (const session of game.sessions ?? []) {
            const day = _localDateStr(session.startedAt)
            if (!raw.has(day)) raw.set(day, new Map())
            const dayMap = raw.get(day)
            if (dayMap.has(appid)) {
                dayMap.get(appid).durationMin += session.durationMin
            } else {
                dayMap.set(appid, { appid, name: game.name, durationMin: session.durationMin })
            }
        }
    }

    const result = new Map()
    for (const [day, appidMap] of raw) {
        result.set(day, [...appidMap.values()])
    }
    return result
}

function _buildReleaseMap(upcoming) {
    const map = new Map()
    for (const game of upcoming) {
        if (!game.releaseDateIso) continue
        if (!map.has(game.releaseDateIso)) map.set(game.releaseDateIso, [])
        map.get(game.releaseDateIso).push({ appid: game.appid, name: game.name })
    }
    return map
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function _draw() {
    // Use local date for "today" — not UTC
    const today = _localDateStr(new Date())
    const title = _mode === 'play' ? 'Play Calendar' : 'Release Calendar'

    _container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">${title}</h1>
        </div>
        <div class="cal-nav">
            <button class="cal-nav-btn" id="cal-prev">← ${_year - 1}</button>
            <span class="cal-nav-year">${_year}</span>
            <button class="cal-nav-btn" id="cal-next">${_year + 1} →</button>
        </div>
        <div class="cal-grid">
            ${MONTHS.map((name, m) => _buildMonth(m, name, today)).join('')}
        </div>`

    _container.querySelector('#cal-prev').addEventListener('click', () => { _year--; _draw() })
    _container.querySelector('#cal-next').addEventListener('click', () => { _year++; _draw() })

    if (_year === new Date().getFullYear()) {
        requestAnimationFrame(() => {
            const el = _container.querySelector('#cal-month-current')
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
    }
}

function _buildMonth(monthIdx, name, today) {
    const firstDow    = new Date(_year, monthIdx, 1).getDay()
    const daysInMonth = new Date(_year, monthIdx + 1, 0).getDate()
    const isCurrent   = today.startsWith(`${_year}-${String(monthIdx + 1).padStart(2, '0')}`)

    const cells = []

    for (let i = 0; i < firstDow; i++) {
        cells.push(`<div class="cal-cell cal-cell--empty"></div>`)
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${_year}-${String(monthIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
        const isToday = dateStr === today

        const entries  = _mode === 'play'     ? (_dayMap.get(dateStr)     ?? []) : []
        const releases = _mode === 'releases' ? (_releaseMap.get(dateStr) ?? []) : []

        cells.push(_buildCell(d, isToday, entries, releases))
    }

    const trailingCells = (7 - ((firstDow + daysInMonth) % 7)) % 7
    for (let i = 0; i < trailingCells; i++) {
        cells.push(`<div class="cal-cell cal-cell--empty"></div>`)
    }

    return `
    <div class="cal-month" ${isCurrent ? 'id="cal-month-current"' : ''}>
        <div class="cal-month-name">${name}</div>
        <div class="cal-month-grid">
            ${DOW.map(d => `<div class="cal-dow">${d}</div>`).join('')}
            ${cells.join('')}
        </div>
    </div>`
}

function _buildCell(day, isToday, entries, releases) {
    const cls = ['cal-cell']
    if (isToday)         cls.push('cal-cell--today')
    if (entries.length)  cls.push('cal-cell--played')
    if (releases.length) cls.push('cal-cell--release-day')

    const sorted  = [...entries].sort((a, b) => b.durationMin - a.durationMin)
    const all     = [
        ...releases.map(r => ({ ...r, isRelease: true })),
        ...sorted.map(e => ({ ...e, isRelease: false })),
    ]
    const display  = all.slice(0, 2)
    const overflow = all.length - display.length

    const entriesHtml = display.map((e, i) => {
        const overflowBadge = (!e.isRelease && i === display.length - 1 && overflow > 0)
            ? `<span class="cal-overflow">+${overflow}</span>`
            : ''
        const timeLabel = _fmt(e.durationMin)
        const overlay = e.isRelease
            ? ''
            : `<div class="cal-entry-overlay">
                 <span class="cal-entry-tag${e.isLive ? ' cal-entry-tag--live' : ''}">
                     ${e.isLive ? '<span class="cal-live-dot"></span>' : ''}${timeLabel}
                 </span>
               </div>`
        const titleText = `${escapeHtml(e.name)}${e.isRelease ? ' — Release day' : ` — ${timeLabel}${e.isLive ? ' (live)' : ''}`}`
        return `
        <a class="cal-entry${e.isRelease ? ' cal-entry--release' : ''}" href="/game/${e.appid}"
           title="${titleText}">
            <img class="cal-entry-img"
                 src="/relay/images/steam/games/${e.appid}/poster.jpg"
                 alt=""
                 loading="lazy"
                 onerror="if(!this.dataset.fb){this.dataset.fb='1';this.src='/relay/images/steam/games/${e.appid}/header.jpg'}else{this.style.display='none'}">
            ${overlay}
            ${overflowBadge}
        </a>`
    }).join('')

    return `
    <div class="${cls.join(' ')}">
        <span class="cal-day-num">${day}</span>
        <div class="cal-entries">${entriesHtml}</div>
    </div>`
}

function _fmt(minutes) {
    if (!minutes) return '0m'
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    if (h === 0) return `${m}m`
    if (m === 0) return `${h}h`
    return `${h}h ${m}m`
}
