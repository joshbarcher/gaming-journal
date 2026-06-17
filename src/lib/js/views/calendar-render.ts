import { localDateStr } from '../utils.js'
import type { Flags, Settings } from '../../types.js'

export { localDateStr }

export const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
export const DOW    = ['Su','Mo','Tu','We','Th','Fr','Sa']

export interface CalSession {
    startedAt:   string
    endedAt?:    string
    durationMin: number
}

export interface CalGame {
    name:      string
    sessions?: CalSession[]
}

export interface DayEntry {
    appid:       number
    name:        string
    durationMin: number
    isLive?:     boolean
    lastPlayed?: boolean
}

export interface ReleaseEntry {
    appid: number
    name:  string
}

export interface UpcomingGame {
    releaseDateIso?: string
    appid:           number
    name:            string
}

export function localMidnight(dateStr: string): number {
    const [y, m, d] = dateStr.split('-').map(Number)
    return new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
}

export function splitAtMidnight(session: CalSession): CalSession[] {
    if (!session.endedAt) return [session]
    const start = new Date(session.startedAt)
    const end   = new Date(session.endedAt)
    if (localDateStr(start) === localDateStr(end)) return [session]

    const parts: CalSession[] = []
    let   cursor = start
    while (localDateStr(cursor) !== localDateStr(end)) {
        const next = new Date(cursor)
        next.setDate(next.getDate() + 1)
        next.setHours(0, 0, 0, 0)
        parts.push({
            startedAt:   cursor.toISOString(),
            endedAt:     next.toISOString(),
            durationMin: Math.max(1, Math.round((next.getTime() - cursor.getTime()) / 60_000)),
        })
        cursor = next
    }
    parts.push({
        startedAt:   cursor.toISOString(),
        endedAt:     end.toISOString(),
        durationMin: Math.max(1, Math.round((end.getTime() - cursor.getTime()) / 60_000)),
    })
    return parts
}

export function buildDayMap(
    sessions: Record<string, CalGame>,
    flags: Record<string, Flags> = {},
    settings: Partial<Settings> = {}
): Map<string, DayEntry[]> {
    const raw = new Map<string, Map<number, DayEntry>>()
    for (const [appidStr, game] of Object.entries(sessions)) {
        const f = flags[appidStr] ?? flags[Number(appidStr)] ?? {}
        if (f.software)                              continue
        if (f.childLock && !settings.showChildLocked) continue
        if (f.filtered  && !settings.showFiltered)    continue
        const appid = Number(appidStr)
        for (const session of game.sessions ?? []) {
            for (const part of splitAtMidnight(session)) {
                const day = localDateStr(part.startedAt)
                if (!raw.has(day)) raw.set(day, new Map())
                const dayMap = raw.get(day)!
                if (dayMap.has(appid)) dayMap.get(appid)!.durationMin += part.durationMin
                else dayMap.set(appid, { appid, name: game.name, durationMin: part.durationMin })
            }
        }
    }
    const result = new Map<string, DayEntry[]>()
    for (const [day, appidMap] of raw) result.set(day, [...appidMap.values()])
    return result
}

export function buildLastPlayedOverlay(
    games: Array<{ appid: number; name: string; rtime_last_played?: number }>,
    dayMap: Map<string, DayEntry[]>
): Map<string, DayEntry[]> {
    const appsWithSessions = new Set<number>()
    for (const entries of dayMap.values())
        for (const e of entries) appsWithSessions.add(e.appid)

    const result = new Map(dayMap)
    for (const game of games) {
        if (!game.rtime_last_played || appsWithSessions.has(game.appid)) continue
        const dateStr = localDateStr(new Date(game.rtime_last_played * 1000))
        const existing = result.get(dateStr) ?? []
        result.set(dateStr, [...existing, { appid: game.appid, name: game.name, durationMin: 0, lastPlayed: true }])
    }
    return result
}

export function buildReleaseMap(upcoming: UpcomingGame[]): Map<string, ReleaseEntry[]> {
    const map = new Map<string, ReleaseEntry[]>()
    for (const game of upcoming) {
        if (!game.releaseDateIso) continue
        if (!map.has(game.releaseDateIso)) map.set(game.releaseDateIso, [])
        map.get(game.releaseDateIso)!.push({ appid: game.appid, name: game.name })
    }
    return map
}

export function fmt(minutes: number): string {
    if (!minutes) return '0m'
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    if (h === 0) return `${m}m`
    if (m === 0) return `${h}h`
    return `${h}h ${m}m`
}

