import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
    escapeHtml,
    progressPercent,
    isSuperComplete,
    groupPagesByType,
} from '../lib/js/utils.js'

// ── escapeHtml ────────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
    it('returns empty string for null', () => {
        assert.equal(escapeHtml(null), '')
    })

    it('returns empty string for undefined', () => {
        assert.equal(escapeHtml(undefined), '')
    })

    it('returns plain text unchanged', () => {
        assert.equal(escapeHtml('hello world'), 'hello world')
    })

    it('escapes ampersand', () => {
        assert.equal(escapeHtml('a & b'), 'a &amp; b')
    })

    it('escapes less-than', () => {
        assert.equal(escapeHtml('<div>'), '&lt;div&gt;')
    })

    it('escapes double quotes', () => {
        assert.equal(escapeHtml('"quoted"'), '&quot;quoted&quot;')
    })

    it('escapes all special chars in a single string', () => {
        assert.equal(
            escapeHtml('<a href="x&y">'),
            '&lt;a href=&quot;x&amp;y&quot;&gt;'
        )
    })
})

// ── progressPercent ───────────────────────────────────────────────────────────

describe('progressPercent — type progress', () => {
    it('returns 0 for empty tasks', () => {
        assert.equal(progressPercent({ type: 'progress', tasks: [] }), 0)
    })

    it('returns 0 when all tasks are optional (no required tasks)', () => {
        const page = { type: 'progress', tasks: [{ state: 'done', optional: true }] }
        assert.equal(progressPercent(page), 0)
    })

    it('counts only required tasks in denominator', () => {
        const page = {
            type: 'progress',
            tasks: [
                { state: 'done' },
                { state: 'done', optional: true },
                { state: 'todo' },
            ],
        }
        // required: 2 (first and third), done required: 1 → 50%
        assert.equal(progressPercent(page), 50)
    })

    it('returns 100 when all required tasks are done', () => {
        const page = {
            type: 'progress',
            tasks: [{ state: 'done' }, { state: 'done' }],
        }
        assert.equal(progressPercent(page), 100)
    })
})

describe('progressPercent — type progress-bars', () => {
    it('returns 0 for empty bars', () => {
        assert.equal(progressPercent({ type: 'progress-bars', bars: [] }), 0)
    })

    it('excludes optional bars from the calculation', () => {
        const page = {
            type: 'progress-bars',
            bars: [
                { optional: true, steps: [{ state: 'done' }] },
                { steps: [{ state: 'done' }, { state: 'todo' }] },
            ],
        }
        // required bars: one with 1 done / 2 total → 50%
        assert.equal(progressPercent(page), 50)
    })

    it('excludes optional steps from the calculation', () => {
        const page = {
            type: 'progress-bars',
            bars: [{
                steps: [
                    { state: 'done' },
                    { state: 'todo', optional: true },
                ],
            }],
        }
        // required steps: 1, done: 1 → 100%
        assert.equal(progressPercent(page), 100)
    })

    it('returns 0 when all steps are optional', () => {
        const page = {
            type: 'progress-bars',
            bars: [{ steps: [{ state: 'done', optional: true }] }],
        }
        assert.equal(progressPercent(page), 0)
    })
})

describe('progressPercent — type list', () => {
    it('returns 0 for empty items', () => {
        assert.equal(progressPercent({ type: 'list', items: [] }), 0)
    })

    it('returns 50 when half items are done', () => {
        const page = { type: 'list', items: [{ done: true }, { done: false }] }
        assert.equal(progressPercent(page), 50)
    })

    it('returns 100 when all items are done', () => {
        const page = { type: 'list', items: [{ done: true }, { done: true }] }
        assert.equal(progressPercent(page), 100)
    })
})

describe('progressPercent — other types', () => {
    it('returns 0 for unknown type', () => {
        assert.equal(progressPercent({ type: 'notes' }), 0)
    })
})

// ── isSuperComplete ───────────────────────────────────────────────────────────

describe('isSuperComplete — type progress', () => {
    it('returns false when there are no optional tasks', () => {
        const page = { type: 'progress', tasks: [{ state: 'done' }] }
        assert.equal(isSuperComplete(page), false)
    })

    it('returns false when optional tasks exist but none are done', () => {
        const page = { type: 'progress', tasks: [{ state: 'todo', optional: true }] }
        assert.equal(isSuperComplete(page), false)
    })

    it('returns true when all optional tasks are done', () => {
        const page = {
            type: 'progress',
            tasks: [
                { state: 'done' },
                { state: 'done', optional: true },
            ],
        }
        assert.equal(isSuperComplete(page), true)
    })

    it('returns false when some optional tasks are not done', () => {
        const page = {
            type: 'progress',
            tasks: [
                { state: 'done', optional: true },
                { state: 'todo', optional: true },
            ],
        }
        assert.equal(isSuperComplete(page), false)
    })
})

describe('isSuperComplete — type progress-bars', () => {
    it('returns false when no optional bars or optional steps exist', () => {
        const page = {
            type: 'progress-bars',
            bars: [{ steps: [{ state: 'done' }] }],
        }
        assert.equal(isSuperComplete(page), false)
    })

    it('returns true when an optional bar has all steps done', () => {
        const page = {
            type: 'progress-bars',
            bars: [{ optional: true, steps: [{ state: 'done' }] }],
        }
        assert.equal(isSuperComplete(page), true)
    })

    it('returns false when an optional bar has an incomplete step', () => {
        const page = {
            type: 'progress-bars',
            bars: [{ optional: true, steps: [{ state: 'done' }, { state: 'todo' }] }],
        }
        assert.equal(isSuperComplete(page), false)
    })

    it('returns true when a required bar has its optional step done', () => {
        const page = {
            type: 'progress-bars',
            bars: [{
                steps: [{ state: 'done' }, { state: 'done', optional: true }],
            }],
        }
        assert.equal(isSuperComplete(page), true)
    })

    it('returns false when a required bar has an incomplete optional step', () => {
        const page = {
            type: 'progress-bars',
            bars: [{
                steps: [{ state: 'done' }, { state: 'todo', optional: true }],
            }],
        }
        assert.equal(isSuperComplete(page), false)
    })
})

describe('isSuperComplete — other types', () => {
    it('returns false for type notes', () => {
        assert.equal(isSuperComplete({ type: 'notes' }), false)
    })
})

// ── groupPagesByType ──────────────────────────────────────────────────────────

describe('groupPagesByType', () => {
    it('returns empty array for no pages', () => {
        assert.deepEqual(groupPagesByType([]), [])
    })

    it('groups pages under their type', () => {
        const pages = [
            { id: '1', type: 'notes', title: 'A' },
            { id: '2', type: 'notes', title: 'B' },
        ]
        const groups = groupPagesByType(pages)
        assert.equal(groups.length, 1)
        assert.equal(groups[0].type, 'notes')
        assert.equal(groups[0].pages.length, 2)
    })

    it('follows TYPE_ORDER (list before progress before notes)', () => {
        const pages = [
            { id: '1', type: 'notes',    title: 'N' },
            { id: '2', type: 'progress', title: 'P' },
            { id: '3', type: 'list',     title: 'L' },
        ]
        const groups = groupPagesByType(pages)
        assert.deepEqual(groups.map(g => g.type), ['list', 'progress', 'notes'])
    })

    it('uses TYPE_LABELS for known types', () => {
        const pages = [{ id: '1', type: 'list', title: 'X' }]
        const [group] = groupPagesByType(pages)
        assert.equal(group.label, 'Lists')
    })

    it('omits pages with types not in TYPE_ORDER', () => {
        const pages = [{ id: '1', type: 'custom-widget', title: 'X' }]
        assert.deepEqual(groupPagesByType(pages), [])
    })

    it('omits types with no pages', () => {
        const pages = [{ id: '1', type: 'progress', title: 'P' }]
        const groups = groupPagesByType(pages)
        assert.ok(groups.every(g => g.type !== 'list'))
        assert.ok(groups.every(g => g.type !== 'notes'))
    })
})
