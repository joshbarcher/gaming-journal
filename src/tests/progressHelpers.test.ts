import { describe, it, expect } from 'vitest'
import {
    STATE_COLORS,
    segmentColor,
    stateLabel,
    percentToStateLabel,
    heatmapRows,
    barProgressPercent,
    percentToColor,
    globalSegments,
    pagePct,
} from '../lib/js/views/progress-helpers.js'

const DIM = 'rgba(255,255,255,0.10)'

// ── barProgressPercent ────────────────────────────────────────────────────────

describe('barProgressPercent', () => {
    it('returns 0 for a bar with no steps', () => {
        expect(barProgressPercent({ steps: [] })).toBe(0)
    })

    it('returns 0 when all steps are optional', () => {
        const bar = { steps: [{ state: 'done', optional: true }] }
        expect(barProgressPercent(bar)).toBe(0)
    })

    it('returns 100 when all required steps are done', () => {
        const bar = { steps: [{ state: 'done' }, { state: 'done' }] }
        expect(barProgressPercent(bar)).toBe(100)
    })

    it('returns 50 for half-done required steps', () => {
        const bar = { steps: [{ state: 'done' }, { state: 'todo' }] }
        expect(barProgressPercent(bar)).toBe(50)
    })

    it('ignores optional steps in both numerator and denominator', () => {
        const bar = {
            steps: [
                { state: 'done' },
                { state: 'done', optional: true },
                { state: 'todo' },
            ],
        }
        expect(barProgressPercent(bar)).toBe(50)
    })

    it('defaults steps to [] when missing', () => {
        expect(barProgressPercent({})).toBe(0)
    })
})

// ── percentToColor ────────────────────────────────────────────────────────────

describe('percentToColor', () => {
    it('returns done color at 100', () => {
        expect(percentToColor(100)).toBe(STATE_COLORS.done)
    })

    it('returns done color above 100', () => {
        expect(percentToColor(120)).toBe(STATE_COLORS.done)
    })

    it('returns working color at 50', () => {
        expect(percentToColor(50)).toBe(STATE_COLORS.working)
    })

    it('returns working color between 50 and 99', () => {
        expect(percentToColor(75)).toBe(STATE_COLORS.working)
    })

    it('returns started color at 1', () => {
        expect(percentToColor(1)).toBe(STATE_COLORS.started)
    })

    it('returns started color between 1 and 49', () => {
        expect(percentToColor(25)).toBe(STATE_COLORS.started)
    })

    it('returns dim color at 0', () => {
        expect(percentToColor(0)).toBe(DIM)
    })
})

// ── globalSegments ────────────────────────────────────────────────────────────

describe('globalSegments — type progress', () => {
    it('returns empty array for no tasks', () => {
        expect(globalSegments({ type: 'progress', tasks: [] })).toEqual([])
    })

    it('maps tasks to segments with 1-based num', () => {
        const page = {
            type: 'progress',
            tasks: [{ title: 'A', state: 'done' }, { title: 'B', state: 'started' }],
        }
        const segs = globalSegments(page)
        expect(segs[0].num).toBe(1)
        expect(segs[1].num).toBe(2)
    })

    it('done task gets done color', () => {
        const page = { type: 'progress', tasks: [{ title: 'T', state: 'done' }] }
        expect(globalSegments(page)[0].color).toBe(STATE_COLORS.done)
        expect(globalSegments(page)[0].done).toBe(true)
    })

    it('non-done task gets its state color', () => {
        const page = { type: 'progress', tasks: [{ title: 'T', state: 'started' }] }
        expect(globalSegments(page)[0].color).toBe(STATE_COLORS.started)
        expect(globalSegments(page)[0].done).toBe(false)
    })

    it('optional flag is passed through', () => {
        const page = { type: 'progress', tasks: [{ title: 'T', state: 'done', optional: true }] }
        expect(globalSegments(page)[0].optional).toBe(true)
    })
})

describe('globalSegments — type progress-bars', () => {
    it('maps bars to segments with barProgressPercent', () => {
        const page = {
            type: 'progress-bars',
            bars: [
                { title: 'Bar A', steps: [{ state: 'done' }, { state: 'done' }] },
                { title: 'Bar B', steps: [{ state: 'todo' }] },
            ],
        }
        const segs = globalSegments(page)
        expect(segs.length).toBe(2)
        expect(segs[0].color).toBe(STATE_COLORS.done)
        expect(segs[1].color).toBe(DIM)
    })
})

describe('globalSegments — type list', () => {
    it('done item gets done color', () => {
        const page = { type: 'list', items: [{ title: 'X', done: true }] }
        expect(globalSegments(page)[0].color).toBe(STATE_COLORS.done)
        expect(globalSegments(page)[0].done).toBe(true)
    })

    it('undone item gets dim color', () => {
        const page = { type: 'list', items: [{ title: 'X', done: false }] }
        expect(globalSegments(page)[0].color).toBe(DIM)
        expect(globalSegments(page)[0].done).toBe(false)
    })
})

describe('globalSegments — type counter', () => {
    it('returns a single segment', () => {
        const page = { type: 'counter', title: 'Kills', target: 10, current: 5 }
        const segs = globalSegments(page)
        expect(segs.length).toBe(1)
        expect(segs[0].num).toBe(1)
        expect(segs[0].label).toBe('Kills')
    })

    it('calculates percent from current/target', () => {
        const page = { type: 'counter', title: 'T', target: 10, current: 10 }
        expect(globalSegments(page)[0].color).toBe(STATE_COLORS.done)
        expect(globalSegments(page)[0].done).toBe(true)
    })

    it('returns dim color when target is 0', () => {
        const page = { type: 'counter', title: 'T', target: 0, current: 0 }
        expect(globalSegments(page)[0].color).toBe(DIM)
    })
})

describe('globalSegments — type multi-counter', () => {
    it('maps each counter to a segment', () => {
        const page = {
            type: 'multi-counter',
            counters: [
                { name: 'A', target: 4, current: 4 },
                { name: 'B', target: 4, current: 0 },
            ],
        }
        const segs = globalSegments(page)
        expect(segs.length).toBe(2)
        expect(segs[0].color).toBe(STATE_COLORS.done)
        expect(segs[1].color).toBe(DIM)
    })

    it('uses fallback name when counter has no name', () => {
        const page = { type: 'multi-counter', counters: [{ target: 1, current: 0 }] }
        expect(globalSegments(page)[0].label).toBe('Counter 1')
    })
})

describe('globalSegments — unknown type', () => {
    it('returns empty array', () => {
        expect(globalSegments({ type: 'notes' })).toEqual([])
    })
})

// ── pagePct ───────────────────────────────────────────────────────────────────

describe('pagePct — type progress', () => {
    it('returns 0 for empty tasks', () => {
        expect(pagePct({ type: 'progress', tasks: [] })).toBe(0)
    })

    it('includes optional tasks in the calculation (unlike progressPercent)', () => {
        const page = {
            type: 'progress',
            tasks: [{ state: 'done' }, { state: 'todo', optional: true }],
        }
        expect(pagePct(page)).toBe(50)
    })

    it('returns 100 when all tasks are done', () => {
        const page = { type: 'progress', tasks: [{ state: 'done' }, { state: 'done' }] }
        expect(pagePct(page)).toBe(100)
    })
})

describe('pagePct — type progress-bars', () => {
    it('returns 0 for empty bars', () => {
        expect(pagePct({ type: 'progress-bars', bars: [] })).toBe(0)
    })

    it('counts steps across all bars including optional bars', () => {
        const page = {
            type: 'progress-bars',
            bars: [
                { optional: true, steps: [{ state: 'done' }] },
                { steps: [{ state: 'todo' }] },
            ],
        }
        expect(pagePct(page)).toBe(50)
    })

    it('excludes optional steps', () => {
        const page = {
            type: 'progress-bars',
            bars: [{ steps: [{ state: 'done' }, { state: 'todo', optional: true }] }],
        }
        expect(pagePct(page)).toBe(100)
    })
})

describe('pagePct — type counter', () => {
    it('returns 0 when target is 0', () => {
        expect(pagePct({ type: 'counter', target: 0, current: 5 })).toBe(0)
    })

    it('returns percentage of current/target', () => {
        expect(pagePct({ type: 'counter', target: 4, current: 1 })).toBe(25)
    })

    it('caps at 100 when current exceeds target', () => {
        expect(pagePct({ type: 'counter', target: 4, current: 10 })).toBe(100)
    })
})

describe('pagePct — type multi-counter', () => {
    it('returns 0 when total target is 0', () => {
        const page = { type: 'multi-counter', counters: [{ target: 0, current: 0 }] }
        expect(pagePct(page)).toBe(0)
    })

    it('sums across counters', () => {
        const page = {
            type: 'multi-counter',
            counters: [
                { target: 2, current: 1 },
                { target: 2, current: 1 },
            ],
        }
        expect(pagePct(page)).toBe(50)
    })

    it('caps at 100', () => {
        const page = {
            type: 'multi-counter',
            counters: [{ target: 1, current: 99 }],
        }
        expect(pagePct(page)).toBe(100)
    })
})

describe('pagePct — other types', () => {
    it('returns 0 for unknown type', () => {
        expect(pagePct({ type: 'notes' })).toBe(0)
    })
})

// ── segmentColor ──────────────────────────────────────────────────────────────

describe('segmentColor', () => {
    it('returns done color for done state', () => {
        expect(segmentColor('done')).toBe(STATE_COLORS.done)
    })

    it('returns working color for working state', () => {
        expect(segmentColor('working')).toBe(STATE_COLORS.working)
    })

    it('returns started color for started state', () => {
        expect(segmentColor('started')).toBe(STATE_COLORS.started)
    })

    it('returns DIM for unknown state', () => {
        expect(segmentColor('todo')).toBe(DIM)
        expect(segmentColor(undefined)).toBe(DIM)
        expect(segmentColor(null)).toBe(DIM)
    })
})

// ── stateLabel ────────────────────────────────────────────────────────────────

describe('stateLabel', () => {
    it('returns display label for known states', () => {
        expect(stateLabel('started')).toBe('Started')
        expect(stateLabel('working')).toBe('Working')
        expect(stateLabel('done')).toBe('Done')
    })

    it('returns empty string for unknown state', () => {
        expect(stateLabel('todo')).toBe('')
        expect(stateLabel(undefined)).toBe('')
    })
})

// ── percentToStateLabel ───────────────────────────────────────────────────────

describe('percentToStateLabel', () => {
    it('returns Done at 100', () => {
        expect(percentToStateLabel(100)).toBe('Done')
    })

    it('returns Done above 100', () => {
        expect(percentToStateLabel(150)).toBe('Done')
    })

    it('returns Working at 50', () => {
        expect(percentToStateLabel(50)).toBe('Working')
    })

    it('returns Working between 50 and 99', () => {
        expect(percentToStateLabel(75)).toBe('Working')
    })

    it('returns Started at 1', () => {
        expect(percentToStateLabel(1)).toBe('Started')
    })

    it('returns Started between 1 and 49', () => {
        expect(percentToStateLabel(25)).toBe('Started')
    })

    it('returns empty string at 0', () => {
        expect(percentToStateLabel(0)).toBe('')
    })
})

// ── heatmapRows ───────────────────────────────────────────────────────────────

describe('heatmapRows', () => {
    it('returns empty array for empty pages', () => {
        expect(heatmapRows([])).toEqual([])
    })

    it('includes progress pages', () => {
        const pages = [{ id: 1, title: 'P', type: 'progress', tasks: [] }]
        const rows  = heatmapRows(pages)
        expect(rows.length).toBe(1)
        expect(rows[0].id).toBe(1)
        expect(rows[0].title).toBe('P')
    })

    it('includes progress-bars pages', () => {
        const pages = [{ id: 2, title: 'Bars', type: 'progress-bars', bars: [] }]
        expect(heatmapRows(pages).length).toBe(1)
    })

    it('includes list pages', () => {
        const pages = [{ id: 3, title: 'List', type: 'list', items: [] }]
        expect(heatmapRows(pages).length).toBe(1)
    })

    it('excludes pages with other types', () => {
        const pages = [
            { id: 1, title: 'Note',    type: 'notes' },
            { id: 2, title: 'Counter', type: 'counter' },
        ]
        expect(heatmapRows(pages).length).toBe(0)
    })

    it('filters and keeps only the allowed types from a mixed list', () => {
        const pages = [
            { id: 1, title: 'A', type: 'progress',      tasks: [] },
            { id: 2, title: 'B', type: 'notes' },
            { id: 3, title: 'C', type: 'progress-bars', bars: [] },
            { id: 4, title: 'D', type: 'list',          items: [] },
        ]
        const rows = heatmapRows(pages)
        expect(rows.length).toBe(3)
        expect(rows.map(r => r.id)).toEqual([1, 3, 4])
    })

    it('cells field is the result of globalSegments for each page', () => {
        const pages = [{
            id: 1, title: 'T', type: 'progress',
            tasks: [{ title: 'X', state: 'done' }],
        }]
        const rows = heatmapRows(pages)
        expect(rows[0].cells.length).toBe(1)
        expect(rows[0].cells[0].done).toBe(true)
    })
})

// ── globalSegments — missing field fallbacks ──────────────────────────────────

describe('globalSegments — missing field fallbacks', () => {
    it('progress with no tasks property returns empty array', () => {
        expect(globalSegments({ type: 'progress' })).toEqual([])
    })

    it('progress-bars with no bars property returns empty array', () => {
        expect(globalSegments({ type: 'progress-bars' })).toEqual([])
    })

    it('list with no items property returns empty array', () => {
        expect(globalSegments({ type: 'list' })).toEqual([])
    })

    it('multi-counter with no counters property returns empty array', () => {
        expect(globalSegments({ type: 'multi-counter' })).toEqual([])
    })

    it('counter with no target/current defaults to pct 0', () => {
        const segs = globalSegments({ type: 'counter', title: 'T' })
        expect(segs[0].done).toBe(false)
    })

    it('multi-counter counter with target 0 gets pct 0', () => {
        const page = { type: 'multi-counter', counters: [{ name: 'X', target: 0, current: 5 }] }
        const segs = globalSegments(page)
        expect(segs[0].done).toBe(false)
    })
})

// ── pagePct — missing field fallbacks ────────────────────────────────────────

describe('pagePct — missing field fallbacks', () => {
    it('progress with no tasks property returns 0', () => {
        expect(pagePct({ type: 'progress' })).toBe(0)
    })

    it('progress-bars with no bars property returns 0', () => {
        expect(pagePct({ type: 'progress-bars' })).toBe(0)
    })

    it('counter with no target returns 0', () => {
        expect(pagePct({ type: 'counter', current: 5 })).toBe(0)
    })

    it('counter with no current returns 0 (treated as 0 progress)', () => {
        expect(pagePct({ type: 'counter', target: 10 })).toBe(0)
    })

    it('multi-counter with no counters property returns 0', () => {
        expect(pagePct({ type: 'multi-counter' })).toBe(0)
    })

    it('multi-counter with counters missing target/current treats them as 0', () => {
        const page = { type: 'multi-counter', counters: [{}] }
        expect(pagePct(page)).toBe(0)
    })
})
