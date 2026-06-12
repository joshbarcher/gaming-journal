import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
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
        assert.equal(barProgressPercent({ steps: [] }), 0)
    })

    it('returns 0 when all steps are optional', () => {
        const bar = { steps: [{ state: 'done', optional: true }] }
        assert.equal(barProgressPercent(bar), 0)
    })

    it('returns 100 when all required steps are done', () => {
        const bar = { steps: [{ state: 'done' }, { state: 'done' }] }
        assert.equal(barProgressPercent(bar), 100)
    })

    it('returns 50 for half-done required steps', () => {
        const bar = { steps: [{ state: 'done' }, { state: 'todo' }] }
        assert.equal(barProgressPercent(bar), 50)
    })

    it('ignores optional steps in both numerator and denominator', () => {
        const bar = {
            steps: [
                { state: 'done' },
                { state: 'done', optional: true },
                { state: 'todo' },
            ],
        }
        // required: 2, done required: 1 → 50%
        assert.equal(barProgressPercent(bar), 50)
    })

    it('defaults steps to [] when missing', () => {
        assert.equal(barProgressPercent({}), 0)
    })
})

// ── percentToColor ────────────────────────────────────────────────────────────

describe('percentToColor', () => {
    it('returns done color at 100', () => {
        assert.equal(percentToColor(100), STATE_COLORS.done)
    })

    it('returns done color above 100', () => {
        assert.equal(percentToColor(120), STATE_COLORS.done)
    })

    it('returns working color at 50', () => {
        assert.equal(percentToColor(50), STATE_COLORS.working)
    })

    it('returns working color between 50 and 99', () => {
        assert.equal(percentToColor(75), STATE_COLORS.working)
    })

    it('returns started color at 1', () => {
        assert.equal(percentToColor(1), STATE_COLORS.started)
    })

    it('returns started color between 1 and 49', () => {
        assert.equal(percentToColor(25), STATE_COLORS.started)
    })

    it('returns dim color at 0', () => {
        assert.equal(percentToColor(0), DIM)
    })
})

// ── globalSegments ────────────────────────────────────────────────────────────

describe('globalSegments — type progress', () => {
    it('returns empty array for no tasks', () => {
        assert.deepEqual(globalSegments({ type: 'progress', tasks: [] }), [])
    })

    it('maps tasks to segments with 1-based num', () => {
        const page = {
            type: 'progress',
            tasks: [{ title: 'A', state: 'done' }, { title: 'B', state: 'started' }],
        }
        const segs = globalSegments(page)
        assert.equal(segs[0].num, 1)
        assert.equal(segs[1].num, 2)
    })

    it('done task gets done color', () => {
        const page = { type: 'progress', tasks: [{ title: 'T', state: 'done' }] }
        assert.equal(globalSegments(page)[0].color, STATE_COLORS.done)
        assert.equal(globalSegments(page)[0].done, true)
    })

    it('non-done task gets its state color', () => {
        const page = { type: 'progress', tasks: [{ title: 'T', state: 'started' }] }
        assert.equal(globalSegments(page)[0].color, STATE_COLORS.started)
        assert.equal(globalSegments(page)[0].done, false)
    })

    it('optional flag is passed through', () => {
        const page = { type: 'progress', tasks: [{ title: 'T', state: 'done', optional: true }] }
        assert.equal(globalSegments(page)[0].optional, true)
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
        assert.equal(segs.length, 2)
        assert.equal(segs[0].color, STATE_COLORS.done)   // 100%
        assert.equal(segs[1].color, DIM)                  // 0%
    })
})

describe('globalSegments — type list', () => {
    it('done item gets done color', () => {
        const page = { type: 'list', items: [{ title: 'X', done: true }] }
        assert.equal(globalSegments(page)[0].color, STATE_COLORS.done)
        assert.equal(globalSegments(page)[0].done, true)
    })

    it('undone item gets dim color', () => {
        const page = { type: 'list', items: [{ title: 'X', done: false }] }
        assert.equal(globalSegments(page)[0].color, DIM)
        assert.equal(globalSegments(page)[0].done, false)
    })
})

describe('globalSegments — type counter', () => {
    it('returns a single segment', () => {
        const page = { type: 'counter', title: 'Kills', target: 10, current: 5 }
        const segs = globalSegments(page)
        assert.equal(segs.length, 1)
        assert.equal(segs[0].num, 1)
        assert.equal(segs[0].label, 'Kills')
    })

    it('calculates percent from current/target', () => {
        const page = { type: 'counter', title: 'T', target: 10, current: 10 }
        assert.equal(globalSegments(page)[0].color, STATE_COLORS.done)
        assert.equal(globalSegments(page)[0].done, true)
    })

    it('returns dim color when target is 0', () => {
        const page = { type: 'counter', title: 'T', target: 0, current: 0 }
        assert.equal(globalSegments(page)[0].color, DIM)
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
        assert.equal(segs.length, 2)
        assert.equal(segs[0].color, STATE_COLORS.done)
        assert.equal(segs[1].color, DIM)
    })

    it('uses fallback name when counter has no name', () => {
        const page = { type: 'multi-counter', counters: [{ target: 1, current: 0 }] }
        assert.equal(globalSegments(page)[0].label, 'Counter 1')
    })
})

describe('globalSegments — unknown type', () => {
    it('returns empty array', () => {
        assert.deepEqual(globalSegments({ type: 'notes' }), [])
    })
})

// ── pagePct ───────────────────────────────────────────────────────────────────

describe('pagePct — type progress', () => {
    it('returns 0 for empty tasks', () => {
        assert.equal(pagePct({ type: 'progress', tasks: [] }), 0)
    })

    it('includes optional tasks in the calculation (unlike progressPercent)', () => {
        const page = {
            type: 'progress',
            tasks: [{ state: 'done' }, { state: 'todo', optional: true }],
        }
        // all tasks: 2, done: 1 → 50%
        assert.equal(pagePct(page), 50)
    })

    it('returns 100 when all tasks are done', () => {
        const page = { type: 'progress', tasks: [{ state: 'done' }, { state: 'done' }] }
        assert.equal(pagePct(page), 100)
    })
})

describe('pagePct — type progress-bars', () => {
    it('returns 0 for empty bars', () => {
        assert.equal(pagePct({ type: 'progress-bars', bars: [] }), 0)
    })

    it('counts steps across all bars including optional bars', () => {
        const page = {
            type: 'progress-bars',
            bars: [
                { optional: true, steps: [{ state: 'done' }] },
                { steps: [{ state: 'todo' }] },
            ],
        }
        // total required steps: 2, done: 1 → 50%
        assert.equal(pagePct(page), 50)
    })

    it('excludes optional steps', () => {
        const page = {
            type: 'progress-bars',
            bars: [{ steps: [{ state: 'done' }, { state: 'todo', optional: true }] }],
        }
        // required steps: 1, done: 1 → 100%
        assert.equal(pagePct(page), 100)
    })
})

describe('pagePct — type counter', () => {
    it('returns 0 when target is 0', () => {
        assert.equal(pagePct({ type: 'counter', target: 0, current: 5 }), 0)
    })

    it('returns percentage of current/target', () => {
        assert.equal(pagePct({ type: 'counter', target: 4, current: 1 }), 25)
    })

    it('caps at 100 when current exceeds target', () => {
        assert.equal(pagePct({ type: 'counter', target: 4, current: 10 }), 100)
    })
})

describe('pagePct — type multi-counter', () => {
    it('returns 0 when total target is 0', () => {
        const page = { type: 'multi-counter', counters: [{ target: 0, current: 0 }] }
        assert.equal(pagePct(page), 0)
    })

    it('sums across counters', () => {
        const page = {
            type: 'multi-counter',
            counters: [
                { target: 2, current: 1 },
                { target: 2, current: 1 },
            ],
        }
        assert.equal(pagePct(page), 50)
    })

    it('caps at 100', () => {
        const page = {
            type: 'multi-counter',
            counters: [{ target: 1, current: 99 }],
        }
        assert.equal(pagePct(page), 100)
    })
})

describe('pagePct — other types', () => {
    it('returns 0 for unknown type', () => {
        assert.equal(pagePct({ type: 'notes' }), 0)
    })
})

// ── segmentColor ──────────────────────────────────────────────────────────────

describe('segmentColor', () => {
    it('returns done color for done state', () => {
        assert.equal(segmentColor('done'), STATE_COLORS.done)
    })

    it('returns working color for working state', () => {
        assert.equal(segmentColor('working'), STATE_COLORS.working)
    })

    it('returns started color for started state', () => {
        assert.equal(segmentColor('started'), STATE_COLORS.started)
    })

    it('returns DIM for unknown state', () => {
        const DIM = 'rgba(255,255,255,0.10)'
        assert.equal(segmentColor('todo'),    DIM)
        assert.equal(segmentColor(undefined), DIM)
        assert.equal(segmentColor(null),      DIM)
    })
})

// ── stateLabel ────────────────────────────────────────────────────────────────

describe('stateLabel', () => {
    it('returns display label for known states', () => {
        assert.equal(stateLabel('started'), 'Started')
        assert.equal(stateLabel('working'), 'Working')
        assert.equal(stateLabel('done'),    'Done')
    })

    it('returns empty string for unknown state', () => {
        assert.equal(stateLabel('todo'),    '')
        assert.equal(stateLabel(undefined), '')
    })
})

// ── percentToStateLabel ───────────────────────────────────────────────────────

describe('percentToStateLabel', () => {
    it('returns Done at 100', () => {
        assert.equal(percentToStateLabel(100), 'Done')
    })

    it('returns Done above 100', () => {
        assert.equal(percentToStateLabel(150), 'Done')
    })

    it('returns Working at 50', () => {
        assert.equal(percentToStateLabel(50), 'Working')
    })

    it('returns Working between 50 and 99', () => {
        assert.equal(percentToStateLabel(75), 'Working')
    })

    it('returns Started at 1', () => {
        assert.equal(percentToStateLabel(1), 'Started')
    })

    it('returns Started between 1 and 49', () => {
        assert.equal(percentToStateLabel(25), 'Started')
    })

    it('returns empty string at 0', () => {
        assert.equal(percentToStateLabel(0), '')
    })
})

// ── heatmapRows ───────────────────────────────────────────────────────────────

describe('heatmapRows', () => {
    it('returns empty array for empty pages', () => {
        assert.deepEqual(heatmapRows([]), [])
    })

    it('includes progress pages', () => {
        const pages = [{ id: 1, title: 'P', type: 'progress', tasks: [] }]
        const rows  = heatmapRows(pages)
        assert.equal(rows.length, 1)
        assert.equal(rows[0].id,    1)
        assert.equal(rows[0].title, 'P')
    })

    it('includes progress-bars pages', () => {
        const pages = [{ id: 2, title: 'Bars', type: 'progress-bars', bars: [] }]
        assert.equal(heatmapRows(pages).length, 1)
    })

    it('includes list pages', () => {
        const pages = [{ id: 3, title: 'List', type: 'list', items: [] }]
        assert.equal(heatmapRows(pages).length, 1)
    })

    it('excludes pages with other types', () => {
        const pages = [
            { id: 1, title: 'Note',    type: 'notes' },
            { id: 2, title: 'Counter', type: 'counter' },
        ]
        assert.equal(heatmapRows(pages).length, 0)
    })

    it('filters and keeps only the allowed types from a mixed list', () => {
        const pages = [
            { id: 1, title: 'A', type: 'progress',      tasks: [] },
            { id: 2, title: 'B', type: 'notes' },
            { id: 3, title: 'C', type: 'progress-bars', bars: [] },
            { id: 4, title: 'D', type: 'list',          items: [] },
        ]
        const rows = heatmapRows(pages)
        assert.equal(rows.length, 3)
        assert.deepEqual(rows.map(r => r.id), [1, 3, 4])
    })

    it('cells field is the result of globalSegments for each page', () => {
        const pages = [{
            id: 1, title: 'T', type: 'progress',
            tasks: [{ title: 'X', state: 'done' }],
        }]
        const rows = heatmapRows(pages)
        assert.equal(rows[0].cells.length, 1)
        assert.equal(rows[0].cells[0].done, true)
    })
})

// ── globalSegments — missing field fallbacks ──────────────────────────────────

describe('globalSegments — missing field fallbacks', () => {
    it('progress with no tasks property returns empty array', () => {
        assert.deepEqual(globalSegments({ type: 'progress' }), [])
    })

    it('progress-bars with no bars property returns empty array', () => {
        assert.deepEqual(globalSegments({ type: 'progress-bars' }), [])
    })

    it('list with no items property returns empty array', () => {
        assert.deepEqual(globalSegments({ type: 'list' }), [])
    })

    it('multi-counter with no counters property returns empty array', () => {
        assert.deepEqual(globalSegments({ type: 'multi-counter' }), [])
    })

    it('counter with no target/current defaults to pct 0', () => {
        const segs = globalSegments({ type: 'counter', title: 'T' })
        assert.equal(segs[0].done, false)
    })

    it('multi-counter counter with target 0 gets pct 0', () => {
        const page = { type: 'multi-counter', counters: [{ name: 'X', target: 0, current: 5 }] }
        const segs = globalSegments(page)
        assert.equal(segs[0].done, false)
    })
})

// ── pagePct — missing field fallbacks ────────────────────────────────────────

describe('pagePct — missing field fallbacks', () => {
    it('progress with no tasks property returns 0', () => {
        assert.equal(pagePct({ type: 'progress' }), 0)
    })

    it('progress-bars with no bars property returns 0', () => {
        assert.equal(pagePct({ type: 'progress-bars' }), 0)
    })

    it('counter with no target returns 0', () => {
        assert.equal(pagePct({ type: 'counter', current: 5 }), 0)
    })

    it('counter with no current returns 0 (treated as 0 progress)', () => {
        assert.equal(pagePct({ type: 'counter', target: 10 }), 0)
    })

    it('multi-counter with no counters property returns 0', () => {
        assert.equal(pagePct({ type: 'multi-counter' }), 0)
    })

    it('multi-counter with counters missing target/current treats them as 0', () => {
        const page = { type: 'multi-counter', counters: [{}] }
        assert.equal(pagePct(page), 0)
    })
})
