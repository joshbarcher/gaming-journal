import { describe, it, expect, vi, afterEach } from 'vitest'
import {
    uuid,
    localDateStr,
    steamStoreUrl,
    escapeHtml,
    progressPercent,
    isSuperComplete,
    groupPagesByType,
} from '../lib/js/utils.js'

afterEach(() => {
    vi.unstubAllGlobals()
})

// ── uuid ──────────────────────────────────────────────────────────────────────

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('uuid', () => {
    it('produces a v4 UUID via crypto.randomUUID when available', () => {
        expect(uuid()).toMatch(UUID_V4)
    })

    it('falls back to the manual generator when crypto is undefined', () => {
        vi.stubGlobal('crypto', undefined)
        for (let i = 0; i < 200; i++) {
            expect(uuid()).toMatch(UUID_V4) // version nibble 4, variant [89ab] every time
        }
    })

    it('falls back when crypto exists but randomUUID is missing', () => {
        vi.stubGlobal('crypto', {})
        expect(uuid()).toMatch(UUID_V4)
    })


    it('uses crypto.getRandomValues when randomUUID is missing', () => {
        const getRandomValues = vi.fn((buf: Uint8Array) => { buf.fill(0xab); return buf })
        vi.stubGlobal('crypto', { getRandomValues })
        const id = uuid()
        expect(getRandomValues).toHaveBeenCalledOnce()
        expect(id).toMatch(UUID_V4)
        expect(id).toBe('abababab-abab-4bab-abab-abababababab')
    })
    it('fallback ids are unique across many calls', () => {
        vi.stubGlobal('crypto', undefined)
        const ids = new Set(Array.from({ length: 1000 }, () => uuid()))
        expect(ids.size).toBe(1000)
    })
})

// ── localDateStr ──────────────────────────────────────────────────────────────

describe('localDateStr', () => {
    it('formats a Date object as YYYY-MM-DD', () => {
        expect(localDateStr(new Date(2026, 6, 15))).toBe('2026-07-15')
    })

    it('zero-pads single-digit month and day', () => {
        expect(localDateStr(new Date(2026, 0, 5))).toBe('2026-01-05')
    })

    it('handles year boundaries (Dec 31 / Jan 1)', () => {
        expect(localDateStr(new Date(2025, 11, 31))).toBe('2025-12-31')
        expect(localDateStr(new Date(2026, 0, 1))).toBe('2026-01-01')
    })

    it('accepts an epoch-milliseconds number', () => {
        const d = new Date(2026, 6, 15, 12, 0, 0)
        expect(localDateStr(d.getTime())).toBe('2026-07-15')
    })

    it('accepts a local ISO datetime string', () => {
        // No timezone suffix → parsed as local time, so this is TZ-safe.
        expect(localDateStr('2026-07-15T12:30:00')).toBe('2026-07-15')
    })

    it('returns NaN-NaN-NaN for an unparseable string (contract — no input validation)', () => {
        expect(localDateStr('not a date')).toBe('NaN-NaN-NaN')
    })

    it('epoch 0 with an explicit offset stays on the local calendar day', () => {
        // Midday local time avoids TZ flakiness while still exercising the number branch.
        const noon = new Date(2000, 1, 29, 12) // leap day
        expect(localDateStr(noon.getTime())).toBe('2000-02-29')
    })
})

// ── steamStoreUrl ─────────────────────────────────────────────────────────────

describe('steamStoreUrl', () => {
    it('builds the store URL from a numeric appid', () => {
        expect(steamStoreUrl(400)).toBe('https://store.steampowered.com/app/400')
    })

    it('accepts a string appid', () => {
        expect(steamStoreUrl('570')).toBe('https://store.steampowered.com/app/570')
    })

    it('does not sanitize or encode the appid (contract — callers must pass trusted ids)', () => {
        // Naive template interpolation: path traversal and quotes pass straight through.
        expect(steamStoreUrl('1/../../evil"')).toBe('https://store.steampowered.com/app/1/../../evil"')
    })
})

// ── escapeHtml — uncovered edges ──────────────────────────────────────────────

describe('escapeHtml — edges', () => {
    it('escapes every occurrence, not just the first', () => {
        expect(escapeHtml('<<&&>>""')).toBe('&lt;&lt;&amp;&amp;&gt;&gt;&quot;&quot;')
    })

    it('escapes ampersands first so pre-escaped text is not double-unescaped', () => {
        expect(escapeHtml('&lt;')).toBe('&amp;lt;')
    })

    it('coerces non-string primitives', () => {
        expect(escapeHtml(0)).toBe('0')
        expect(escapeHtml(false)).toBe('false')
        expect(escapeHtml(NaN)).toBe('NaN')
    })

    it('coerces objects via String()', () => {
        expect(escapeHtml({ toString: () => '<b>' })).toBe('&lt;b&gt;')
    })

    it('does NOT escape single quotes (contract — unsafe inside single-quoted attributes)', () => {
        // Output must only ever be placed in element content or double-quoted
        // attributes. `escapeHtml("' onmouseover='...")` would break out of a
        // single-quoted attribute — documented limitation, verify before reuse.
        expect(escapeHtml("it's")).toBe("it's")
    })

    it('does not escape backticks or slashes (contract)', () => {
        expect(escapeHtml('`/`')).toBe('`/`')
    })
})

// ── progressPercent — uncovered branches ──────────────────────────────────────

describe('progressPercent — missing collections', () => {
    it('returns 0 when tasks is undefined for type progress', () => {
        expect(progressPercent({ type: 'progress' })).toBe(0)
    })

    it('returns 0 when bars is undefined for type progress-bars', () => {
        expect(progressPercent({ type: 'progress-bars' })).toBe(0)
    })

    it('returns 0 when items is undefined for type list', () => {
        expect(progressPercent({ type: 'list' })).toBe(0)
    })

    it('returns 0 when a bar has no steps array', () => {
        expect(progressPercent({ type: 'progress-bars', bars: [{}] })).toBe(0)
    })
})

describe('progressPercent — rounding & state edge cases', () => {
    it('rounds 1/3 to 33 and 2/3 to 67', () => {
        const third = { type: 'progress', tasks: [{ state: 'done' }, { state: 'todo' }, { state: 'todo' }] }
        expect(progressPercent(third)).toBe(33)
        const twoThirds = { type: 'progress', tasks: [{ state: 'done' }, { state: 'done' }, { state: 'todo' }] }
        expect(progressPercent(twoThirds)).toBe(67)
    })

    it('treats null and unknown states as not done', () => {
        const page = { type: 'progress', tasks: [{ state: null }, { state: 'DONE' }, { state: 'done' }] }
        expect(progressPercent(page)).toBe(33) // state matching is exact and case-sensitive
    })

    it('counts truthy non-boolean done values on list items (contract)', () => {
        const page = { type: 'list', items: [{ done: 1 as unknown as boolean }, { done: 0 as unknown as boolean }] }
        expect(progressPercent(page)).toBe(50)
    })
})

// ── isSuperComplete — uncovered branches ──────────────────────────────────────

describe('isSuperComplete — edges', () => {
    it('returns false for type list (only progress types can be super-complete)', () => {
        expect(isSuperComplete({ type: 'list', items: [{ done: true }] })).toBe(false)
    })

    it('returns false when bars is undefined', () => {
        expect(isSuperComplete({ type: 'progress-bars' })).toBe(false)
    })

    it('an optional bar with an empty steps array counts as complete (contract — vacuous truth)', () => {
        // `[].every()` is true, so an optional bar the user never filled in
        // marks the page super-complete. Defensible for this data model (bars
        // are created with steps), but worth pinning down.
        expect(isSuperComplete({ type: 'progress-bars', bars: [{ optional: true, steps: [] }] })).toBe(true)
    })

    it('an optional step with null state blocks super-completion', () => {
        const page = {
            type: 'progress-bars',
            bars: [{ steps: [{ state: 'done' }, { state: null, optional: true }] }],
        }
        expect(isSuperComplete(page)).toBe(false)
    })

    it('mixed: optional bar complete but required-bar optional step unfinished → false', () => {
        const page = {
            type: 'progress-bars',
            bars: [
                { optional: true, steps: [{ state: 'done' }] },
                { steps: [{ state: 'done' }, { state: 'todo', optional: true }] },
            ],
        }
        expect(isSuperComplete(page)).toBe(false)
    })
})

// ── groupPagesByType — uncovered branches ─────────────────────────────────────

describe('groupPagesByType — edges', () => {
    it('falls back to the raw type as label for types without a TYPE_LABELS entry', () => {
        const groups = groupPagesByType([{ type: 'counter' }, { type: 'multi-counter' }])
        expect(groups.map(g => g.label)).toEqual(['counter', 'multi-counter'])
    })

    it('preserves insertion order within a group', () => {
        const pages = [
            { type: 'notes', id: 'first' },
            { type: 'list',  id: 'x' },
            { type: 'notes', id: 'second' },
        ]
        const notes = groupPagesByType(pages).find(g => g.type === 'notes')!
        expect(notes.pages.map(p => (p as { id: string }).id)).toEqual(['first', 'second'])
    })

    it('drops unknown types while keeping known ones', () => {
        const pages = [{ type: 'mystery' }, { type: 'page' }]
        const groups = groupPagesByType(pages)
        expect(groups.length).toBe(1)
        expect(groups[0].type).toBe('page')
        expect(groups[0].label).toBe('Pages')
    })
})
