import { describe, it, expect, vi, afterEach } from 'vitest'
import {
    IC,
    STAR_LABELS,
    RATING_KEYS,
    RATING_LBLS,
    TRACKER_TYPES,
    TRACKER_META,
    fmtDate,
    cleanAchName,
    fmtHours,
    mergeSessionAchievements,
} from '../lib/js/views/journal-render.js'
import type { AchievementItem } from '../lib/types.js'

afterEach(() => {
    vi.useRealTimers()
})

// ── constants integrity ───────────────────────────────────────────────────────

describe('constants integrity', () => {
    it('every tracker type has display metadata with a working icon factory', () => {
        for (const t of TRACKER_TYPES) {
            expect(TRACKER_META[t]).toBeTruthy()
            expect(TRACKER_META[t].icon()).toContain('<svg')
        }
    })

    it('every rating key has a label', () => {
        for (const k of RATING_KEYS) expect(RATING_LBLS[k]).toBeTruthy()
    })

    it('star labels cover 0–5 plus Legendary (7 entries)', () => {
        expect(STAR_LABELS).toHaveLength(7)
        expect(STAR_LABELS[6]).toBe('Legendary')
    })

    it('IC icons are fixed markup with no interpolated data', () => {
        for (const svg of Object.values(IC)) {
            expect(svg.startsWith('<svg')).toBe(true)
            expect(svg).toContain('aria-hidden="true"')
        }
    })
})

// ── fmtDate ───────────────────────────────────────────────────────────────────

describe('fmtDate', () => {
    it('empty string for nullish/empty input', () => {
        expect(fmtDate(null)).toBe('')
        expect(fmtDate(undefined)).toBe('')
        expect(fmtDate('')).toBe('')
    })

    it('formats Date objects and timestamps as forced en-US "Mon D"', () => {
        expect(fmtDate(new Date(2026, 6, 4))).toBe('Jul 4')
        expect(fmtDate(new Date(2026, 11, 25).getTime())).toBe('Dec 25')
    })

    it('contract: a 0 timestamp (epoch) is swallowed by the falsy guard and renders ""', () => {
        expect(fmtDate(0 as unknown as number)).toBe('')
    })

    // BUG: journal-render.ts:32-35 — non-parseable strings produce an Invalid Date,
    // and toLocaleDateString on it renders the literal string "Invalid Date" into the
    // UI instead of an empty string. Severity: LOW.
    it('renders nothing (not "Invalid Date") for garbage date strings', () => {
        expect(fmtDate('not a real date')).toBe('')
    })

    it('contract: date-only ISO strings are parsed as UTC midnight, so the rendered day can shift in western timezones', () => {
        // Documenting the Date-parsing rule the function inherits: '2026-07-04' → UTC
        // midnight → local day depends on the machine's offset. Full ISO strings with a
        // time are parsed the same way by design.
        const expected = new Date('2026-07-04T00:00:00.000Z')
            .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        expect(fmtDate('2026-07-04')).toBe(expected)
    })
})

// ── cleanAchName ──────────────────────────────────────────────────────────────

describe('cleanAchName', () => {
    it('strips one leading UPPERCASE/digit prefix segment and title-cases the rest', () => {
        expect(cleanAchName('ACH_FIRST_BLOOD')).toBe('First Blood')
        expect(cleanAchName('NEW_ACHIEVEMENT_1_0')).toBe('Achievement 1 0')
    })

    it('does not strip lowercase apinames', () => {
        expect(cleanAchName('kill_100_enemies')).toBe('Kill 100 Enemies')
    })

    it('does not strip when there is no underscore after the prefix', () => {
        expect(cleanAchName('SPEEDRUN')).toBe('Speedrun')
    })

    it('strips only the first segment, greedily within that segment', () => {
        expect(cleanAchName('A1_B2_C')).toBe('B2 C')
    })

    it('degenerate inputs collapse to empty strings instead of throwing', () => {
        expect(cleanAchName('')).toBe('')
        expect(cleanAchName('ACH_')).toBe('')
        expect(cleanAchName('___')).toBe('   ') // no alnum prefix to strip → underscores become spaces
    })

    it('contract: an all-caps single-word name with trailing underscore data keeps digits', () => {
        expect(cleanAchName('ACH_100')).toBe('100')
    })
})

// ── fmtHours ──────────────────────────────────────────────────────────────────

describe('fmtHours (journal copy)', () => {
    it('em-dash for nullish, "0h" for zero', () => {
        expect(fmtHours(null)).toBe('—')
        expect(fmtHours(undefined)).toBe('—')
        expect(fmtHours(0)).toBe('0h')
    })

    it('band boundaries: tenths under 10, halves under 100, whole at 100+', () => {
        expect(fmtHours(9.94)).toBe('9.9h')
        expect(fmtHours(9.96)).toBe('10h')
        expect(fmtHours(10.3)).toBe('10.5h')
        expect(fmtHours(99.9)).toBe('100h')
        expect(fmtHours(100.4)).toBe('100h')
    })
})

// ── mergeSessionAchievements ──────────────────────────────────────────────────

const ach = (apiname: string, achieved = 0, unlocktime = 0): AchievementItem =>
    ({ apiname, achieved, unlocktime })

describe('mergeSessionAchievements', () => {
    it('returns the SAME array reference when there is nothing to merge', () => {
        const list = [ach('a')]
        expect(mergeSessionAchievements(list, null)).toBe(list)
        expect(mergeSessionAchievements(list, undefined)).toBe(list)
        expect(mergeSessionAchievements(list, [])).toBe(list)
    })

    it('marks a matching unachieved item as achieved with the session unlock time', () => {
        const list = [ach('a'), ach('b')]
        const merged = mergeSessionAchievements(list, [{ apiname: 'b', unlocktime: 1_750_000_000 }])
        expect(merged[1].achieved).toBe(1)
        expect(merged[1].unlocktime).toBe(1_750_000_000)
        expect(merged[0]).toBe(list[0]) // untouched entries keep their identity
    })

    it('does not mutate the input list (merged entries are copies)', () => {
        const list = [ach('a')]
        mergeSessionAchievements(list, [{ apiname: 'a', unlocktime: 5 }])
        expect(list[0].achieved).toBe(0)
        expect(list[0].unlocktime).toBe(0)
    })

    it('never overwrites an already-achieved item', () => {
        const list = [ach('a', 1, 999)]
        const merged = mergeSessionAchievements(list, [{ apiname: 'a', unlocktime: 5 }])
        expect(merged[0]).toBe(list[0])
        expect(merged[0].unlocktime).toBe(999)
    })

    it('falls back to "now" when the session achievement has no unlock time', () => {
        vi.useFakeTimers()
        vi.setSystemTime(1_750_000_000_000)
        const merged = mergeSessionAchievements([ach('a')], [{ apiname: 'a' }])
        expect(merged[0].unlocktime).toBe(1_750_000_000)
    })

    it('a session achievement with no matching list entry is silently ignored (no phantom rows)', () => {
        const list = [ach('a')]
        const merged = mergeSessionAchievements(list, [{ apiname: 'ghost', unlocktime: 1 }])
        expect(merged).toHaveLength(1)
        expect(merged[0].achieved).toBe(0)
    })

    it('duplicate apinames in the session list: the last one wins', () => {
        const merged = mergeSessionAchievements(
            [ach('a')],
            [{ apiname: 'a', unlocktime: 111 }, { apiname: 'a', unlocktime: 222 }],
        )
        expect(merged[0].unlocktime).toBe(222)
    })

    it('handles a large list with a small session delta without touching unrelated rows', () => {
        const list = Array.from({ length: 500 }, (_, i) => ach(`a${i}`))
        const merged = mergeSessionAchievements(list, [{ apiname: 'a250', unlocktime: 42 }])
        expect(merged.filter(a => a.achieved).map(a => a.apiname)).toEqual(['a250'])
        expect(merged[0]).toBe(list[0])
        expect(merged[499]).toBe(list[499])
    })
})
