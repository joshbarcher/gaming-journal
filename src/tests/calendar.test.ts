import { describe, it, expect } from 'vitest'
import { localDateStr as _localDateStr } from '../lib/js/utils.js'
import {
    buildDayMap as _buildDayMap,
    splitAtMidnight as _splitAtMidnight,
    localMidnight,
    buildReleaseMap,
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
        expect(map.get(key)![0].durationMin).toBe(60)
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
        const entry = map.get(key)!.find((e: any) => e.appid === 570)!
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

        expect(_localDateStr(parts[0].startedAt!)).toBe(_localDateStr(new Date(startMs)))
        expect(_localDateStr(parts[0].endedAt!)).toBe(_localDateStr(new Date(midnightMs)))
        expect(_localDateStr(parts[1].startedAt!)).toBe(_localDateStr(new Date(midnightMs)))
        expect(_localDateStr(parts[1].endedAt!)).toBe(_localDateStr(new Date(endMs)))
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

        const e17 = (map.get(day17) ?? []).find((e: any) => e.appid === 400)!
        const e18 = (map.get(day18) ?? []).find((e: any) => e.appid === 400)!

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

        const e17 = (map.get(day17) ?? []).find((e: any) => e.appid === 400)!
        const e18 = (map.get(day18) ?? []).find((e: any) => e.appid === 400)!

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
        expect(map.get('2026-05-17')!.length).toBe(2)
        expect(map.get('2026-05-18')!.length).toBe(1)
        expect(map.get('2026-05-18')![0]).toEqual({ appid: 400, name: 'Portal 2' })
    })

    it('skips entries without a releaseDateIso', () => {
        const map = buildReleaseMap([
            { appid: 570, name: 'Dota 2' },
            { releaseDateIso: '2026-05-17', appid: 440, name: 'TF2' },
        ])
        expect(map.size).toBe(1)
    })
})

