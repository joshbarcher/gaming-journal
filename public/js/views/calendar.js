import { escapeHtml, localDateStr as _localDateStr } from '../utils.js'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DOW    = ['Su','Mo','Tu','We','Th','Fr','Sa']

let _year        = new Date().getFullYear()
let _dayMap      = new Map()   // 'YYYY-MM-DD' → [{ appid, name, durationMin }]  (one entry per appid, aggregated)
let _releaseMap  = new Map()   // 'YYYY-MM-DD' → [{ appid, name }]
let _container   = null
let _mode        = 'play'      // 'play' | 'releases'

// ── Live session state ────────────────────────────────────────────────────────
// _liveSession       — what the relay says is currently playing
// _liveBase          — minutes already committed in _dayMap for this game *before*
//                      the current day's segment started
// _liveEffectiveStart — ISO string used as the zero-point for elapsed-time maths.
//                      Equals sessionStartedAt normally, but is reset to local
//                      midnight when a session crosses into a new calendar day so
//                      the live counter only shows time played *today*.
// _liveDate          — local date string of the last poll; detects midnight rollover
let _liveSession        = null   // { appid, name, sessionStartedAt } | null
let _liveBase           = 0
let _liveEffectiveStart = null   // ISO string | null
let _liveDate           = null   // 'YYYY-MM-DD' | null
let _liveTimer          = null

// ── Public entry points ───────────────────────────────────────────────────────

export async function renderCalendar(container) {
    _mode      = 'play'
    _container = container
    _dayMap    = new Map()
    _stopLivePoller()
    container.innerHTML = `<p class="page-loading">Loading calendar…</p>`

    try {
        const [accountRes, flagsRes, settingsRes] = await Promise.all([
            fetch('/relay/api/account'),
            fetch('/api/flags'),
            fetch('/api/settings'),
        ])
        if (!accountRes.ok) throw new Error(`HTTP ${accountRes.status}`)
        const data     = await accountRes.json()
        const flags    = flagsRes.ok    ? await flagsRes.json()    : {}
        const settings = settingsRes.ok ? await settingsRes.json() : {}
        _dayMap = _buildDayMap(data.sessions ?? {}, flags, settings)
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

// ── Live session poller ───────────────────────────────────────────────────────

function _startLivePoller() {
    _liveDate = _localDateStr(new Date())
    _pollLive()
    _liveTimer = setInterval(_pollLive, 60_000)
}

function _stopLivePoller() {
    if (_liveTimer) { clearInterval(_liveTimer); _liveTimer = null }
    _liveSession        = null
    _liveBase           = 0
    _liveEffectiveStart = null
    _liveDate           = null
}

async function _pollLive() {
    try {
        const res = await fetch('/relay/api/steam/now-playing')
        if (!res.ok) return
        const { playing } = await res.json()

        const todayStr    = _localDateStr(new Date())
        const prevAppid   = _liveSession?.appid ?? null
        const currAppid   = playing?.appid ?? null
        const prevStarted = _liveSession?.sessionStartedAt ?? null
        const currStarted = playing?.sessionStartedAt ?? null

        // Session changed: different game, game stopped, or same game restarted
        const sessionChanged = (currAppid !== prevAppid) || (currStarted !== prevStarted)

        // ── Midnight rollover ──────────────────────────────────────────────────
        // When the calendar day flips while a game is still running: freeze the
        // previous day's exact portion, reset the live counter to midnight, then
        // redraw so the --today class moves to the new day's cell.
        if (!sessionChanged && _liveSession && _liveDate && _liveDate !== todayStr) {
            const midnight   = _localMidnight(todayStr)          // 00:00:00 local today
            const prevEffStart = _liveEffectiveStart ?? _liveSession.sessionStartedAt
            const prevDayMin = Math.max(1, Math.floor(
                (midnight - new Date(prevEffStart).getTime()) / 60_000
            ))
            _commitToDay(_liveDate, _liveSession.appid, _liveSession.name, prevDayMin)

            _liveEffectiveStart = new Date(midnight).toISOString()
            _liveBase = (_dayMap.get(todayStr) ?? []).find(e => e.appid === _liveSession.appid)?.durationMin ?? 0
            _draw()   // flips --today to the new cell
        }
        // ──────────────────────────────────────────────────────────────────────

        if (sessionChanged) {
            if (prevAppid !== null) _freezeLiveSession()

            if (currAppid !== null) {
                const sessionDay = _localDateStr(playing.sessionStartedAt)

                if (sessionDay !== todayStr) {
                    // Session started before today (relay restart or calendar opened
                    // mid-session after midnight) — seed yesterday's portion and
                    // count live time from midnight only.
                    const midnight = _localMidnight(todayStr)
                    _liveEffectiveStart = new Date(midnight).toISOString()
                    const prevDayMin = Math.max(1, Math.floor(
                        (midnight - new Date(playing.sessionStartedAt).getTime()) / 60_000
                    ))
                    _commitToDay(sessionDay, currAppid, playing.name, prevDayMin)
                } else {
                    _liveEffectiveStart = playing.sessionStartedAt ?? new Date().toISOString()
                }

                _liveBase = (_dayMap.get(todayStr) ?? []).find(e => e.appid === currAppid)?.durationMin ?? 0
            } else {
                _liveBase           = 0
                _liveEffectiveStart = null
            }
        }

        _liveDate    = todayStr
        _liveSession = playing ?? null
        _patchTodayCell()
    } catch { /* silent — non-critical */ }
}

// Returns the Unix-ms timestamp for local midnight of the given 'YYYY-MM-DD'.
function _localMidnight(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number)
    return new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
}

// Writes (or updates) a non-live entry in _dayMap for a specific day.
function _commitToDay(dateStr, appid, name, durationMin) {
    const entries = [...(_dayMap.get(dateStr) ?? [])]
    const idx     = entries.findIndex(e => e.appid === appid)
    if (idx >= 0) {
        entries[idx] = { ...entries[idx], durationMin }
    } else {
        entries.push({ appid, name, durationMin })
    }
    _dayMap.set(dateStr, entries)
}

// Bake the current live session into _dayMap as a plain (non-live) entry.
// Uses _liveEffectiveStart (which may be local midnight, not sessionStartedAt)
// so elapsed time only counts for the current calendar day.
function _freezeLiveSession() {
    if (!_liveSession) return
    const todayStr  = _localDateStr(new Date())
    const startMs   = _liveEffectiveStart
        ? new Date(_liveEffectiveStart).getTime()
        : (_liveSession.sessionStartedAt ? new Date(_liveSession.sessionStartedAt).getTime() : Date.now())
    const liveMin   = Math.max(1, Math.floor((Date.now() - startMs) / 60_000))
    const frozenMin = _liveBase + liveMin
    _commitToDay(todayStr, _liveSession.appid, _liveSession.name, frozenMin)
}

function _patchTodayCell() {
    if (_mode !== 'play' || !_container) return
    const existing = _container.querySelector('.cal-cell--today')
    if (!existing) return   // not viewing current year

    const todayStr    = _localDateStr(new Date())
    const baseEntries = _dayMap.get(todayStr) ?? []
    let entries       = [...baseEntries]

    if (_liveSession) {
        const startMs  = _liveEffectiveStart
            ? new Date(_liveEffectiveStart).getTime()
            : (_liveSession.sessionStartedAt ? new Date(_liveSession.sessionStartedAt).getTime() : Date.now())
        const liveMin  = Math.max(1, Math.floor((Date.now() - startMs) / 60_000))
        // Total = committed base (before this session) + time played today
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

// Splits a session record at local midnight boundaries so each part is
// attributed only to the calendar day it falls on.
export function _splitAtMidnight(session) {
    if (!session.endedAt) return [session]
    const start = new Date(session.startedAt)
    const end   = new Date(session.endedAt)
    if (_localDateStr(start) === _localDateStr(end)) return [session]

    const parts  = []
    let   cursor = start

    while (_localDateStr(cursor) !== _localDateStr(end)) {
        const next = new Date(cursor)
        next.setDate(next.getDate() + 1)
        next.setHours(0, 0, 0, 0)   // local midnight of the next day
        parts.push({
            startedAt:   cursor.toISOString(),
            endedAt:     next.toISOString(),
            durationMin: Math.max(1, Math.round((next - cursor) / 60_000)),
        })
        cursor = next
    }
    parts.push({
        startedAt:   cursor.toISOString(),
        endedAt:     end.toISOString(),
        durationMin: Math.max(1, Math.round((end - cursor) / 60_000)),
    })
    return parts
}

export function _buildDayMap(sessions, flags = {}, settings = {}) {
    // Two-level aggregation: day → Map<appid, entry>
    // Cross-midnight sessions are split so each calendar day only shows the time
    // played within that day. Multiple sessions for the same game on the same day
    // are summed into one entry.
    const raw = new Map()

    for (const [appidStr, game] of Object.entries(sessions)) {
        const f = flags[appidStr] ?? flags[Number(appidStr)] ?? {}
        if (f.software)                          continue
        if (f.childLock && !settings.showChildLocked) continue
        if (f.filtered  && !settings.showFiltered)    continue
        const appid = Number(appidStr)
        for (const session of game.sessions ?? []) {
            for (const part of _splitAtMidnight(session)) {
                const day = _localDateStr(part.startedAt)
                if (!raw.has(day)) raw.set(day, new Map())
                const dayMap = raw.get(day)
                if (dayMap.has(appid)) {
                    dayMap.get(appid).durationMin += part.durationMin
                } else {
                    dayMap.set(appid, { appid, name: game.name, durationMin: part.durationMin })
                }
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
