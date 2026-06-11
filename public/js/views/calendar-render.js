import { localDateStr } from '../utils.js'

export { localDateStr }

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DOW    = ['Su','Mo','Tu','We','Th','Fr','Sa']

export function localMidnight(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number)
    return new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
}

// Splits a session record at local midnight boundaries.
export function splitAtMidnight(session) {
    if (!session.endedAt) return [session]
    const start = new Date(session.startedAt)
    const end   = new Date(session.endedAt)
    if (localDateStr(start) === localDateStr(end)) return [session]

    const parts  = []
    let   cursor = start
    while (localDateStr(cursor) !== localDateStr(end)) {
        const next = new Date(cursor)
        next.setDate(next.getDate() + 1)
        next.setHours(0, 0, 0, 0)
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

export function buildDayMap(sessions, flags = {}, settings = {}) {
    const raw = new Map()
    for (const [appidStr, game] of Object.entries(sessions)) {
        const f = flags[appidStr] ?? flags[Number(appidStr)] ?? {}
        if (f.software)                              continue
        if (f.childLock && !settings.showChildLocked) continue
        if (f.filtered  && !settings.showFiltered)    continue
        const appid = Number(appidStr)
        for (const session of game.sessions ?? []) {
            if (!session.endedAt) continue
            for (const part of splitAtMidnight(session)) {
                const day = localDateStr(part.startedAt)
                if (!raw.has(day)) raw.set(day, new Map())
                const dayMap = raw.get(day)
                if (dayMap.has(appid)) dayMap.get(appid).durationMin += part.durationMin
                else dayMap.set(appid, { appid, name: game.name, durationMin: part.durationMin })
            }
        }
    }
    const result = new Map()
    for (const [day, appidMap] of raw) result.set(day, [...appidMap.values()])
    return result
}

export function buildReleaseMap(upcoming) {
    const map = new Map()
    for (const game of upcoming) {
        if (!game.releaseDateIso) continue
        if (!map.has(game.releaseDateIso)) map.set(game.releaseDateIso, [])
        map.get(game.releaseDateIso).push({ appid: game.appid, name: game.name })
    }
    return map
}

function fmt(minutes) {
    if (!minutes) return '0m'
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    if (h === 0) return `${m}m`
    if (m === 0) return `${h}h`
    return `${h}h ${m}m`
}

export function buildCell(year, monthIdx, day, isToday, entries, releases) {
    const cls = ['cal-cell']
    if (isToday)         cls.push('cal-cell--today')
    if (entries.length)  cls.push('cal-cell--played')
    if (releases.length) cls.push('cal-cell--release-day')

    const sorted   = [...entries].sort((a, b) => b.durationMin - a.durationMin)
    const all      = [...releases.map(r => ({ ...r, isRelease: true })), ...sorted.map(e => ({ ...e, isRelease: false }))]
    const display  = all.slice(0, 3)
    const overflow = all.length - display.length

    const entriesHtml = display.map((e, i) => {
        const overflowBadge = (!e.isRelease && i === display.length - 1 && overflow > 0)
            ? `<span class="cal-overflow">+${overflow}</span>` : ''
        const timeLabel = fmt(e.durationMin)
        const overlay   = e.isRelease ? '' : `
            <div class="cal-entry-overlay">
                <span class="cal-entry-tag${e.isLive ? ' cal-entry-tag--live' : ''}">
                    ${e.isLive ? '<span class="cal-live-dot"></span>' : ''}${timeLabel}
                </span>
            </div>`
        const titleText = `${e.name}${e.isRelease ? ' — Release day' : ` — ${timeLabel}${e.isLive ? ' (live)' : ''}`}`
        return `
        <a class="cal-entry${e.isRelease ? ' cal-entry--release' : ''}" href="/game/${e.appid}" title="${titleText}">
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

export function buildMonth(year, monthIdx, name, today, dayMap, releaseMap, mode) {
    const firstDow    = new Date(year, monthIdx, 1).getDay()
    const daysInMonth = new Date(year, monthIdx + 1, 0).getDate()
    const isCurrent   = today.startsWith(`${year}-${String(monthIdx + 1).padStart(2, '0')}`)

    const cells = []
    for (let i = 0; i < firstDow; i++) cells.push(`<div class="cal-cell cal-cell--empty"></div>`)

    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr  = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
        const isToday  = dateStr === today
        const entries  = mode === 'play'     ? (dayMap.get(dateStr)     ?? []) : []
        const releases = mode === 'releases' ? (releaseMap.get(dateStr) ?? []) : []
        cells.push(buildCell(year, monthIdx, d, isToday, entries, releases))
    }

    const trailing = (7 - ((firstDow + daysInMonth) % 7)) % 7
    for (let i = 0; i < trailing; i++) cells.push(`<div class="cal-cell cal-cell--empty"></div>`)

    return `
    <div class="cal-month" ${isCurrent ? 'id="cal-month-current"' : ''}>
        <div class="cal-month-name">${name}</div>
        <div class="cal-month-grid">
            ${DOW.map(d => `<div class="cal-dow">${d}</div>`).join('')}
            ${cells.join('')}
        </div>
    </div>`
}

export { MONTHS }
