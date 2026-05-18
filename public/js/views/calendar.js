import { escapeHtml } from '../utils.js'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DOW    = ['Su','Mo','Tu','We','Th','Fr','Sa']

let _year      = new Date().getFullYear()
let _dayMap    = new Map()   // 'YYYY-MM-DD' → [{ appid, name, durationMin }]
let _releaseMap = new Map()  // 'YYYY-MM-DD' → [{ appid, name }]
let _container = null
let _mode      = 'play'      // 'play' | 'releases'

// ── Public entry points ───────────────────────────────────────────────────────

export async function renderCalendar(container) {
    _mode      = 'play'
    _container = container
    _dayMap    = new Map()
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
}

export async function renderReleases(container) {
    _mode       = 'releases'
    _container  = container
    _releaseMap = new Map()
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

// ── Data builders ─────────────────────────────────────────────────────────────

function _buildDayMap(sessions, flags = {}) {
    const map = new Map()
    for (const [appidStr, game] of Object.entries(sessions)) {
        if (flags[appidStr]?.software || flags[Number(appidStr)]?.software) continue
        for (const session of game.sessions ?? []) {
            const day = session.startedAt.slice(0, 10)
            if (!map.has(day)) map.set(day, [])
            map.get(day).push({
                appid:       Number(appidStr),
                name:        game.name,
                durationMin: session.durationMin,
            })
        }
    }
    return map
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
    const today = new Date().toISOString().slice(0, 10)
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
        const overlay = e.isRelease
            ? ''
            : `<div class="cal-entry-overlay"><span class="cal-entry-tag">${_fmt(e.durationMin)}</span></div>`
        return `
        <a class="cal-entry${e.isRelease ? ' cal-entry--release' : ''}" href="/game/${e.appid}"
           title="${escapeHtml(e.name)}${e.isRelease ? ' — Release day' : ` — ${_fmt(e.durationMin)}`}">
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
