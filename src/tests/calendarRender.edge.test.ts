import { describe, it, expect } from 'vitest'
import { localDateStr } from '../lib/js/utils.js'
import {
    buildDayMap,
    buildLastPlayedOverlay,
    buildReleaseMap,
    splitAtMidnight,
    localMidnight,
    fmt,
    MONTHS,
    DOW,
    type CalSession,
    type DayEntry,
} from '../lib/js/views/calendar-render.js'

// Local-time constructors keep every test timezone-independent: the assertions are
// made against localDateStr of the same instants the sessions were built from.
const iso = (y: number, m0: number, d: number, hh = 0, mm = 0) => new Date(y, m0, d, hh, mm).toISOString()

// ── splitAtMidnight — calendar math ───────────────────────────────────────────

describe('splitAtMidnight — month/year/leap boundaries', () => {
    it('splits across a month rollover (Jan 31 → Feb 1)', () => {
        const parts = splitAtMidnight({ startedAt: iso(2026, 0, 31, 23), endedAt: iso(2026, 1, 1, 1), durationMin: 120 })
        expect(parts).toHaveLength(2)
        expect(localDateStr(parts[0].startedAt)).toBe('2026-01-31')
        expect(localDateStr(parts[1].startedAt)).toBe('2026-02-01')
        expect(parts[0].durationMin + parts[1].durationMin).toBe(120)
    })

    it('splits into Feb 29 on a leap year (2028)', () => {
        const parts = splitAtMidnight({ startedAt: iso(2028, 1, 28, 23, 30), endedAt: iso(2028, 1, 29, 0, 30), durationMin: 60 })
        expect(parts).toHaveLength(2)
        expect(localDateStr(parts[1].startedAt)).toBe('2028-02-29')
    })

    it('rolls Feb 28 into Mar 1 on a non-leap year (2027)', () => {
        const parts = splitAtMidnight({ startedAt: iso(2027, 1, 28, 23, 30), endedAt: iso(2027, 2, 1, 0, 30), durationMin: 60 })
        expect(parts).toHaveLength(2)
        expect(localDateStr(parts[1].startedAt)).toBe('2027-03-01')
    })

    it('splits across a year rollover (Dec 31 → Jan 1)', () => {
        const parts = splitAtMidnight({ startedAt: iso(2026, 11, 31, 23), endedAt: iso(2027, 0, 1, 1), durationMin: 120 })
        expect(parts).toHaveLength(2)
        expect(localDateStr(parts[1].startedAt)).toBe('2027-01-01')
    })

    it('a session spanning three local days yields three parts on the right days', () => {
        const startMs = new Date(2026, 4, 17, 23, 0).getTime()
        const endMs   = new Date(2026, 4, 19, 1, 0).getTime()
        const parts = splitAtMidnight({
            startedAt:   new Date(startMs).toISOString(),
            endedAt:     new Date(endMs).toISOString(),
            durationMin: Math.round((endMs - startMs) / 60_000),
        })
        expect(parts).toHaveLength(3)
        expect(parts.map(p => localDateStr(p.startedAt))).toEqual(['2026-05-17', '2026-05-18', '2026-05-19'])
        // middle part is a full local day (duration computed from real epochs, so DST-safe)
        expect(parts[1].durationMin).toBeGreaterThanOrEqual(1380)
        expect(parts[1].durationMin).toBeLessThanOrEqual(1500)
        const total = parts.reduce((s, p) => s + p.durationMin, 0)
        expect(Math.abs(total - Math.round((endMs - startMs) / 60_000))).toBeLessThanOrEqual(2)
    })

    // REGRESSION: calendar-render.ts — a session ending exactly at local midnight was
    // once treated as crossing into the next day, producing a phantom 1-minute entry
    // (Math.max(1, …) inflating a zero-length tail) on a day the user never played.
    // Now it stays a single same-day part; this guards the phantom entry from returning.
    it('a session ending exactly at midnight stays a single same-day part', () => {
        const parts = splitAtMidnight({ startedAt: iso(2026, 4, 17, 23), endedAt: iso(2026, 4, 18, 0), durationMin: 60 })
        expect(parts).toHaveLength(1)
    })
})

// ── buildDayMap — flag/settings branches ──────────────────────────────────────

const oneSession = (name: string): { name: string; sessions: CalSession[] } => ({
    name,
    sessions: [{ startedAt: iso(2026, 4, 17, 12), endedAt: iso(2026, 4, 17, 13), durationMin: 60 }],
})
const day = localDateStr(iso(2026, 4, 17, 12))
const entriesOf = (map: Map<string, DayEntry[]>) => [...map.values()].flat()

describe('buildDayMap — visibility flags', () => {
    it('hides childLocked games by default and shows them with showChildLocked', () => {
        const sessions = { 100: oneSession('Adult Game') }
        const flags = { 100: { childLock: true } }
        expect(entriesOf(buildDayMap(sessions, flags))).toHaveLength(0)
        expect(entriesOf(buildDayMap(sessions, flags, { showChildLocked: true }))).toHaveLength(1)
    })

    it('hides filtered games by default and shows them with showFiltered', () => {
        const sessions = { 100: oneSession('Filtered Game') }
        const flags = { 100: { filtered: true } }
        expect(entriesOf(buildDayMap(sessions, flags))).toHaveLength(0)
        expect(entriesOf(buildDayMap(sessions, flags, { showFiltered: true }))).toHaveLength(1)
    })

    it('shows software when showSoftware is enabled', () => {
        const sessions = { 100: oneSession('SteamVR') }
        const flags = { 100: { software: true } }
        expect(entriesOf(buildDayMap(sessions, flags, { showSoftware: true }))).toHaveLength(1)
    })

    it('a game with no sessions array contributes nothing (and does not crash)', () => {
        const map = buildDayMap({ 100: { name: 'No Sessions' } })
        expect(map.size).toBe(0)
    })

    it('merges a cross-midnight tail with a separate same-day session of the same game', () => {
        const sessions = {
            400: {
                name: 'Portal 2',
                sessions: [
                    // 23:00 day17 → 01:00 day18 (tail: 60m on day18)
                    { startedAt: iso(2026, 4, 17, 23), endedAt: iso(2026, 4, 18, 1), durationMin: 120 },
                    // plus 30m later on day18
                    { startedAt: iso(2026, 4, 18, 12), endedAt: iso(2026, 4, 18, 12, 30), durationMin: 30 },
                ],
            },
        }
        const map = buildDayMap(sessions)
        const day18 = localDateStr(iso(2026, 4, 18, 12))
        const e = map.get(day18)!.find(x => x.appid === 400)!
        expect(map.get(day18)).toHaveLength(1) // merged, not duplicated
        expect(Math.abs(e.durationMin - 90)).toBeLessThanOrEqual(1)
    })
})

// ── buildLastPlayedOverlay ────────────────────────────────────────────────────

const rtime = Math.floor(new Date(2026, 4, 17, 15).getTime() / 1000)
const rtimeDay = localDateStr(new Date(rtime * 1000))

describe('buildLastPlayedOverlay', () => {
    it('adds a zero-duration lastPlayed marker for a game with no sessions', () => {
        const result = buildLastPlayedOverlay([{ appid: 42, name: 'Old Game', rtime_last_played: rtime }], new Map())
        const entry = result.get(rtimeDay)![0]
        expect(entry).toEqual({ appid: 42, name: 'Old Game', durationMin: 0, lastPlayed: true })
    })

    it('skips games that already have session entries anywhere in the day map', () => {
        const dayMap = new Map([[day, [{ appid: 42, name: 'Old Game', durationMin: 30 }]]])
        const result = buildLastPlayedOverlay([{ appid: 42, name: 'Old Game', rtime_last_played: rtime }], dayMap)
        expect(entriesOf(result).filter(e => e.lastPlayed)).toHaveLength(0)
    })

    it('skips games with no rtime_last_played (0 or missing)', () => {
        const result = buildLastPlayedOverlay(
            [{ appid: 1, name: 'A', rtime_last_played: 0 }, { appid: 2, name: 'B' }],
            new Map(),
        )
        expect(result.size).toBe(0)
    })

    it('appends the marker to a day that already has other games without disturbing them', () => {
        const existing = [{ appid: 999, name: 'Other', durationMin: 60 }]
        const dayMap = new Map([[rtimeDay, existing]])
        const result = buildLastPlayedOverlay([{ appid: 42, name: 'Old Game', rtime_last_played: rtime }], dayMap)
        expect(result.get(rtimeDay)).toHaveLength(2)
        expect(result.get(rtimeDay)![0]).toEqual(existing[0])
        // and the source array was not mutated
        expect(existing).toHaveLength(1)
    })

    it('does not mutate the input day map', () => {
        const dayMap = new Map<string, DayEntry[]>()
        buildLastPlayedOverlay([{ appid: 42, name: 'Old Game', rtime_last_played: rtime }], dayMap)
        expect(dayMap.size).toBe(0)
    })

    it('respects childLock and filtered settings like the session map does', () => {
        const games = [{ appid: 42, name: 'Hidden', rtime_last_played: rtime }]
        expect(entriesOf(buildLastPlayedOverlay(games, new Map(), { 42: { childLock: true } }))).toHaveLength(0)
        expect(entriesOf(buildLastPlayedOverlay(games, new Map(), { 42: { childLock: true } }, { showChildLocked: true }))).toHaveLength(1)
        expect(entriesOf(buildLastPlayedOverlay(games, new Map(), { 42: { filtered: true } }))).toHaveLength(0)
        expect(entriesOf(buildLastPlayedOverlay(games, new Map(), { 42: { filtered: true } }, { showFiltered: true }))).toHaveLength(1)
    })

    // REGRESSION: calendar-render.ts — the overlay once dropped software games
    // unconditionally while buildDayMap honoured settings.showSoftware, so enabling
    // "show software" surfaced sessions yet hid their last-played markers. The overlay
    // now respects showSoftware too; this guards the parity from regressing.
    it('shows software last-played markers when showSoftware is enabled (parity with buildDayMap)', () => {
        const result = buildLastPlayedOverlay(
            [{ appid: 42, name: 'SteamVR', rtime_last_played: rtime }],
            new Map(),
            { 42: { software: true } },
            { showSoftware: true },
        )
        expect(entriesOf(result)).toHaveLength(1)
    })
})

// ── buildReleaseMap / localMidnight / fmt ─────────────────────────────────────

describe('buildReleaseMap — duplicates', () => {
    it('keeps duplicate appids on the same date (no dedupe contract)', () => {
        const map = buildReleaseMap([
            { releaseDateIso: '2026-05-17', appid: 570, name: 'Dota 2' },
            { releaseDateIso: '2026-05-17', appid: 570, name: 'Dota 2' },
        ])
        expect(map.get('2026-05-17')).toHaveLength(2)
    })
})

describe('localMidnight — rollover inputs', () => {
    it('contract: out-of-range day/month components roll over via the Date constructor', () => {
        const d = new Date(localMidnight('2026-01-32'))
        expect(localDateStr(d)).toBe('2026-02-01')
        const feb29 = new Date(localMidnight('2027-02-29')) // 2027 is not a leap year
        expect(localDateStr(feb29)).toBe('2027-03-01')
    })
})

describe('fmt — durations', () => {
    it('covers the m / h / h+m branches and their boundaries', () => {
        expect(fmt(0)).toBe('0m')
        expect(fmt(59)).toBe('59m')
        expect(fmt(60)).toBe('1h')
        expect(fmt(61)).toBe('1h 1m')
        expect(fmt(120)).toBe('2h')
        expect(fmt(1439)).toBe('23h 59m')
    })

    it('contract: NaN is treated as zero', () => {
        expect(fmt(NaN)).toBe('0m')
    })

    it('contract: negative durations produce a nonsensical but non-crashing string', () => {
        expect(fmt(-90)).toBe('-2h -30m')
    })
})

describe('calendar constants', () => {
    it('12 months and a Sunday-first 7-day week (rendering depends on this order)', () => {
        expect(MONTHS).toHaveLength(12)
        expect(DOW).toEqual(['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'])
    })
})
