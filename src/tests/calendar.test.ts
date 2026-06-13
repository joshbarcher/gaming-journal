import { describe, it, expect } from 'vitest'
import { localDateStr as _localDateStr } from '../lib/js/utils.js'
import {
    buildDayMap as _buildDayMap,
    splitAtMidnight as _splitAtMidnight,
    localMidnight,
    buildReleaseMap,
    buildCell,
    buildMonth,
} from '../lib/js/views/calendar-render.js'

// ── _localDateStr ─────────────────────────────────────────────────────────────

describe('_localDateStr', () => {
    it('converts a UTC ISO string to a local YYYY-MM-DD string', () => {
        const iso = '2026-05-17T12:00:00.000Z'
        const result = _localDateStr(iso)
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        const d = new Date(iso)
        const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        expect(result).toBe(expected)
    })

    it('accepts a Date object', () => {
        const d = new Date('2026-05-17T12:00:00.000Z')
        const result = _localDateStr(d)
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })
})

// ── _buildDayMap — basic ──────────────────────────────────────────────────────

describe('_buildDayMap — basic', () => {
    it('returns an empty map for empty sessions', () => {
        const map = _buildDayMap({})
        expect(map.size).toBe(0)
    })

    it('maps a single session to its start date', () => {
        const sessions = {
            570: {
                name: 'Dota 2',
                sessions: [{ startedAt: '2026-05-17T12:00:00.000Z', endedAt: '2026-05-17T13:00:00.000Z', durationMin: 60 }],
            },
        }
        const map = _buildDayMap(sessions)
        const d = new Date('2026-05-17T12:00:00.000Z')
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        expect(map.has(key)).toBe(true)
        expect(map.get(key)[0].durationMin).toBe(60)
    })

    it('sums two sessions for the same game on the same day', () => {
        const sessions = {
            570: {
                name: 'Dota 2',
                sessions: [
                    { startedAt: '2026-05-17T10:00:00.000Z', durationMin: 45 },
                    { startedAt: '2026-05-17T14:00:00.000Z', durationMin: 30 },
                ],
            },
        }
        const map = _buildDayMap(sessions)
        const d = new Date('2026-05-17T10:00:00.000Z')
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const entry = map.get(key).find((e: any) => e.appid === 570)
        expect(entry.durationMin).toBe(75)
    })

    it('filters out flagged software', () => {
        const sessions = {
            12345: { name: 'SteamVR', sessions: [{ startedAt: '2026-05-17T12:00:00.000Z', durationMin: 10 }] },
            570:   { name: 'Dota 2',  sessions: [{ startedAt: '2026-05-17T12:00:00.000Z', durationMin: 60 }] },
        }
        const flags = { 12345: { software: true } }
        const map = _buildDayMap(sessions, flags)

        for (const entries of map.values()) {
            for (const e of entries) {
                expect(e.appid).not.toBe(12345)
            }
        }
        const hasDota = [...map.values()].flat().some((e: any) => e.appid === 570)
        expect(hasDota).toBe(true)
    })
})

// ── _splitAtMidnight ──────────────────────────────────────────────────────────

describe('_splitAtMidnight', () => {
    it('returns the session unchanged when start and end are on the same local day', () => {
        const session = {
            startedAt:   '2026-05-17T20:00:00.000Z',
            endedAt:     '2026-05-17T22:00:00.000Z',
            durationMin: 120,
        }
        const parts = _splitAtMidnight(session)
        expect(parts.length).toBe(1)
        expect(parts[0].durationMin).toBe(120)
    })

    it('returns the session unchanged when endedAt is absent', () => {
        const session = { startedAt: '2026-05-17T22:00:00.000Z', durationMin: 30 }
        const parts = _splitAtMidnight(session)
        expect(parts.length).toBe(1)
    })

    it('splits a cross-midnight session into two parts that sum to the total', () => {
        const midnightMs = new Date(2026, 4, 18, 0, 0, 0, 0).getTime()
        const startMs    = midnightMs - 60 * 60_000
        const endMs      = midnightMs + 2 * 60 * 60_000

        const session = {
            startedAt:   new Date(startMs).toISOString(),
            endedAt:     new Date(endMs).toISOString(),
            durationMin: 180,
        }
        const parts = _splitAtMidnight(session)
        expect(parts.length).toBe(2)

        const totalMin = parts.reduce((s: number, p: any) => s + p.durationMin, 0)
        expect(Math.abs(totalMin - 180)).toBeLessThanOrEqual(1)

        expect(_localDateStr(parts[0].startedAt)).toBe(_localDateStr(new Date(startMs)))
        expect(_localDateStr(parts[0].endedAt)).toBe(_localDateStr(new Date(midnightMs)))
        expect(_localDateStr(parts[1].startedAt)).toBe(_localDateStr(new Date(midnightMs)))
        expect(_localDateStr(parts[1].endedAt)).toBe(_localDateStr(new Date(endMs)))
    })
})

// ── _buildDayMap — cross-midnight sessions ────────────────────────────────────

describe('_buildDayMap — cross-midnight', () => {
    it('splits a cross-midnight session so each day shows only its own time', () => {
        const midnightMs = new Date(2026, 4, 18, 0, 0, 0, 0).getTime()
        const startMs    = midnightMs - 60 * 60_000
        const endMs      = midnightMs + 2 * 60 * 60_000

        const sessions = {
            400: {
                name: 'Portal 2',
                sessions: [{
                    startedAt:   new Date(startMs).toISOString(),
                    endedAt:     new Date(endMs).toISOString(),
                    durationMin: 180,
                }],
            },
        }
        const map = _buildDayMap(sessions)

        const day17 = _localDateStr(new Date(startMs))
        const day18 = _localDateStr(new Date(endMs))

        expect(day17).not.toBe(day18)

        const e17 = (map.get(day17) ?? []).find((e: any) => e.appid === 400)
        const e18 = (map.get(day18) ?? []).find((e: any) => e.appid === 400)

        expect(e17).toBeTruthy()
        expect(e18).toBeTruthy()
        expect(Math.abs(e17.durationMin - 60)).toBeLessThanOrEqual(1)
        expect(Math.abs(e18.durationMin - 120)).toBeLessThanOrEqual(1)
    })

    it('handles two separate same-game sessions on different days without cross-contamination', () => {
        const sessions = {
            400: {
                name: 'Portal 2',
                sessions: [
                    { startedAt: '2026-05-17T20:00:00.000Z', endedAt: '2026-05-17T21:00:00.000Z', durationMin: 60 },
                    { startedAt: '2026-05-18T12:00:00.000Z', endedAt: '2026-05-18T13:30:00.000Z', durationMin: 90 },
                ],
            },
        }
        const map = _buildDayMap(sessions)

        const day17 = _localDateStr('2026-05-17T20:00:00.000Z')
        const day18 = _localDateStr('2026-05-18T12:00:00.000Z')

        const e17 = (map.get(day17) ?? []).find((e: any) => e.appid === 400)
        const e18 = (map.get(day18) ?? []).find((e: any) => e.appid === 400)

        expect(e17).toBeTruthy()
        expect(e18).toBeTruthy()
        expect(e17.durationMin).toBe(60)
        expect(e18.durationMin).toBe(90)
    })
})

// ── localMidnight ─────────────────────────────────────────────────────────────

describe('localMidnight', () => {
    it('returns the Unix ms timestamp of midnight local time for a date string', () => {
        const ts = localMidnight('2026-05-17')
        const d  = new Date(ts)
        expect(d.getFullYear()).toBe(2026)
        expect(d.getMonth()).toBe(4)
        expect(d.getDate()).toBe(17)
        expect(d.getHours()).toBe(0)
        expect(d.getMinutes()).toBe(0)
        expect(d.getSeconds()).toBe(0)
    })

    it('returns different timestamps for different dates', () => {
        expect(localMidnight('2026-05-17')).not.toBe(localMidnight('2026-05-18'))
    })
})

// ── buildReleaseMap ───────────────────────────────────────────────────────────

describe('buildReleaseMap', () => {
    it('returns an empty map for empty input', () => {
        expect(buildReleaseMap([]).size).toBe(0)
    })

    it('groups games by releaseDateIso', () => {
        const map = buildReleaseMap([
            { releaseDateIso: '2026-05-17', appid: 570, name: 'Dota 2' },
            { releaseDateIso: '2026-05-17', appid: 440, name: 'TF2' },
            { releaseDateIso: '2026-05-18', appid: 400, name: 'Portal 2' },
        ])
        expect(map.size).toBe(2)
        expect(map.get('2026-05-17').length).toBe(2)
        expect(map.get('2026-05-18').length).toBe(1)
        expect(map.get('2026-05-18')[0]).toEqual({ appid: 400, name: 'Portal 2' })
    })

    it('skips entries without a releaseDateIso', () => {
        const map = buildReleaseMap([
            { appid: 570, name: 'Dota 2' },
            { releaseDateIso: '2026-05-17', appid: 440, name: 'TF2' },
        ])
        expect(map.size).toBe(1)
    })
})

// ── buildCell ─────────────────────────────────────────────────────────────────

describe('buildCell', () => {
    it('renders a basic empty cell with the day number', () => {
        const html = buildCell(2026, 4, 17, false, [], [])
        expect(html).toContain('cal-cell')
        expect(html).toContain('17')
        expect(html).not.toContain('cal-cell--today')
        expect(html).not.toContain('cal-cell--played')
        expect(html).not.toContain('cal-cell--release-day')
    })

    it('adds today class when isToday is true', () => {
        const html = buildCell(2026, 4, 17, true, [], [])
        expect(html).toContain('cal-cell--today')
    })

    it('adds played class and entry link when entries are present', () => {
        const html = buildCell(2026, 4, 17, false, [{ appid: 570, name: 'Dota 2', durationMin: 60 }], [])
        expect(html).toContain('cal-cell--played')
        expect(html).toContain('Dota 2')
        expect(html).toContain('/game/570')
    })

    it('adds release-day class when releases are present', () => {
        const html = buildCell(2026, 4, 17, false, [], [{ appid: 440, name: 'TF2' }])
        expect(html).toContain('cal-cell--release-day')
        expect(html).toContain('TF2')
    })

    it('formats duration: minutes only', () => {
        const html = buildCell(2026, 4, 17, false, [{ appid: 1, name: 'X', durationMin: 45 }], [])
        expect(html).toContain('45m')
    })

    it('formats duration: hours only (no minutes)', () => {
        const html = buildCell(2026, 4, 17, false, [{ appid: 1, name: 'X', durationMin: 120 }], [])
        expect(html).toContain('2h')
        expect(html).not.toContain('2h 0m')
    })

    it('formats duration: hours and minutes', () => {
        const html = buildCell(2026, 4, 17, false, [{ appid: 1, name: 'X', durationMin: 90 }], [])
        expect(html).toContain('1h 30m')
    })

    it('formats zero duration as 0m', () => {
        const html = buildCell(2026, 4, 17, false, [{ appid: 1, name: 'X', durationMin: 0 }], [])
        expect(html).toContain('0m')
    })

    it('shows overflow badge when more than 3 total items', () => {
        const entries = [1, 2, 3, 4].map(i => ({ appid: i, name: `G${i}`, durationMin: 10 }))
        const html = buildCell(2026, 4, 17, false, entries, [])
        expect(html).toContain('+1')
    })

    it('releases appear before play entries in the display', () => {
        const html = buildCell(2026, 4, 17, false,
            [{ appid: 1, name: 'Game', durationMin: 60 }],
            [{ appid: 2, name: 'Release' }]
        )
        const releaseIdx = html.indexOf('Release')
        const gameIdx    = html.indexOf('Game')
        expect(releaseIdx).toBeLessThan(gameIdx)
    })

    it('entries are sorted by durationMin descending', () => {
        const entries = [
            { appid: 1, name: 'Short',  durationMin: 10 },
            { appid: 2, name: 'Medium', durationMin: 50 },
            { appid: 3, name: 'Long',   durationMin: 90 },
        ]
        const html = buildCell(2026, 4, 17, false, entries, [])
        const longIdx   = html.indexOf('Long')
        const mediumIdx = html.indexOf('Medium')
        expect(longIdx).toBeLessThan(mediumIdx)
    })
})

// ── buildMonth ────────────────────────────────────────────────────────────────

describe('buildMonth', () => {
    it('renders a month container with the correct name', () => {
        const html = buildMonth(2026, 4, 'May', '2026-06-01', new Map(), new Map(), 'play')
        expect(html).toContain('cal-month')
        expect(html).toContain('May')
    })

    it('marks the current month with id="cal-month-current"', () => {
        const html = buildMonth(2026, 4, 'May', '2026-05-17', new Map(), new Map(), 'play')
        expect(html).toContain('id="cal-month-current"')
    })

    it('does not mark a non-current month', () => {
        const html = buildMonth(2026, 4, 'May', '2026-06-01', new Map(), new Map(), 'play')
        expect(html).not.toContain('id="cal-month-current"')
    })

    it('includes all day-of-week headers', () => {
        const html = buildMonth(2026, 4, 'May', '2026-06-01', new Map(), new Map(), 'play')
        for (const dow of ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']) {
            expect(html).toContain(`<div class="cal-dow">${dow}</div>`)
        }
    })

    it('generates empty leading cells for the first day-of-week offset', () => {
        const html = buildMonth(2026, 4, 'May', '2026-06-01', new Map(), new Map(), 'play')
        const emptyCount = (html.match(/cal-cell--empty/g) ?? []).length
        expect(emptyCount).toBeGreaterThanOrEqual(5)
    })

    it('in play mode, shows played entries from dayMap', () => {
        const dayMap = new Map([['2026-05-17', [{ appid: 570, name: 'Dota 2', durationMin: 60 }]]])
        const html = buildMonth(2026, 4, 'May', '2026-06-01', dayMap, new Map(), 'play')
        expect(html).toContain('cal-cell--played')
        expect(html).toContain('Dota 2')
    })

    it('in releases mode, shows release entries from releaseMap', () => {
        const releaseMap = new Map([['2026-05-17', [{ appid: 440, name: 'TF2' }]]])
        const html = buildMonth(2026, 4, 'May', '2026-06-01', new Map(), releaseMap, 'releases')
        expect(html).toContain('cal-cell--release-day')
    })

    it('in releases mode, does not show play entries', () => {
        const dayMap = new Map([['2026-05-17', [{ appid: 570, name: 'Dota 2', durationMin: 60 }]]])
        const html = buildMonth(2026, 4, 'May', '2026-06-01', dayMap, new Map(), 'releases')
        expect(html).not.toContain('cal-cell--played')
    })
})
