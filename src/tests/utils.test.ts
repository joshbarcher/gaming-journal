import { describe, it, expect } from 'vitest'
import {
    escapeHtml,
    progressPercent,
    isSuperComplete,
    groupPagesByType,
} from '../lib/js/utils.js'

// ── escapeHtml ────────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
    it('returns empty string for null', () => {
        expect(escapeHtml(null)).toBe('')
    })

    it('returns empty string for undefined', () => {
        expect(escapeHtml(undefined)).toBe('')
    })

    it('returns plain text unchanged', () => {
        expect(escapeHtml('hello world')).toBe('hello world')
    })

    it('escapes ampersand', () => {
        expect(escapeHtml('a & b')).toBe('a &amp; b')
    })

    it('escapes less-than', () => {
        expect(escapeHtml('<div>')).toBe('&lt;div&gt;')
    })

    it('escapes double quotes', () => {
        expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;')
    })

    it('escapes all special chars in a single string', () => {
        expect(escapeHtml('<a href="x&y">')).toBe('&lt;a href=&quot;x&amp;y&quot;&gt;')
    })
})

// ── progressPercent ───────────────────────────────────────────────────────────

describe('progressPercent — type progress', () => {
    it('returns 0 for empty tasks', () => {
        expect(progressPercent({ type: 'progress', tasks: [] })).toBe(0)
    })

    it('returns 0 when all tasks are optional (no required tasks)', () => {
        const page = { type: 'progress', tasks: [{ state: 'done', optional: true }] }
        expect(progressPercent(page)).toBe(0)
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
        expect(progressPercent(page)).toBe(50)
    })

    it('returns 100 when all required tasks are done', () => {
        const page = {
            type: 'progress',
            tasks: [{ state: 'done' }, { state: 'done' }],
        }
        expect(progressPercent(page)).toBe(100)
    })
})

describe('progressPercent — type progress-bars', () => {
    it('returns 0 for empty bars', () => {
        expect(progressPercent({ type: 'progress-bars', bars: [] })).toBe(0)
    })

    it('excludes optional bars from the calculation', () => {
        const page = {
            type: 'progress-bars',
            bars: [
                { optional: true, steps: [{ state: 'done' }] },
                { steps: [{ state: 'done' }, { state: 'todo' }] },
            ],
        }
        expect(progressPercent(page)).toBe(50)
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
        expect(progressPercent(page)).toBe(100)
    })

    it('returns 0 when all steps are optional', () => {
        const page = {
            type: 'progress-bars',
            bars: [{ steps: [{ state: 'done', optional: true }] }],
        }
        expect(progressPercent(page)).toBe(0)
    })
})

describe('progressPercent — type list', () => {
    it('returns 0 for empty items', () => {
        expect(progressPercent({ type: 'list', items: [] })).toBe(0)
    })

    it('returns 50 when half items are done', () => {
        const page = { type: 'list', items: [{ done: true }, { done: false }] }
        expect(progressPercent(page)).toBe(50)
    })

    it('returns 100 when all items are done', () => {
        const page = { type: 'list', items: [{ done: true }, { done: true }] }
        expect(progressPercent(page)).toBe(100)
    })
})

describe('progressPercent — other types', () => {
    it('returns 0 for unknown type', () => {
        expect(progressPercent({ type: 'notes' })).toBe(0)
    })
})

// ── isSuperComplete ───────────────────────────────────────────────────────────

describe('isSuperComplete — type progress', () => {
    it('returns false when there are no optional tasks', () => {
        const page = { type: 'progress', tasks: [{ state: 'done' }] }
        expect(isSuperComplete(page)).toBe(false)
    })

    it('returns false when optional tasks exist but none are done', () => {
        const page = { type: 'progress', tasks: [{ state: 'todo', optional: true }] }
        expect(isSuperComplete(page)).toBe(false)
    })

    it('returns true when all optional tasks are done', () => {
        const page = {
            type: 'progress',
            tasks: [
                { state: 'done' },
                { state: 'done', optional: true },
            ],
        }
        expect(isSuperComplete(page)).toBe(true)
    })

    it('returns false when some optional tasks are not done', () => {
        const page = {
            type: 'progress',
            tasks: [
                { state: 'done', optional: true },
                { state: 'todo', optional: true },
            ],
        }
        expect(isSuperComplete(page)).toBe(false)
    })
})

describe('isSuperComplete — type progress-bars', () => {
    it('returns false when no optional bars or optional steps exist', () => {
        const page = {
            type: 'progress-bars',
            bars: [{ steps: [{ state: 'done' }] }],
        }
        expect(isSuperComplete(page)).toBe(false)
    })

    it('returns true when an optional bar has all steps done', () => {
        const page = {
            type: 'progress-bars',
            bars: [{ optional: true, steps: [{ state: 'done' }] }],
        }
        expect(isSuperComplete(page)).toBe(true)
    })

    it('returns false when an optional bar has an incomplete step', () => {
        const page = {
            type: 'progress-bars',
            bars: [{ optional: true, steps: [{ state: 'done' }, { state: 'todo' }] }],
        }
        expect(isSuperComplete(page)).toBe(false)
    })

    it('returns true when a required bar has its optional step done', () => {
        const page = {
            type: 'progress-bars',
            bars: [{
                steps: [{ state: 'done' }, { state: 'done', optional: true }],
            }],
        }
        expect(isSuperComplete(page)).toBe(true)
    })

    it('returns false when a required bar has an incomplete optional step', () => {
        const page = {
            type: 'progress-bars',
            bars: [{
                steps: [{ state: 'done' }, { state: 'todo', optional: true }],
            }],
        }
        expect(isSuperComplete(page)).toBe(false)
    })
})

describe('isSuperComplete — other types', () => {
    it('returns false for type notes', () => {
        expect(isSuperComplete({ type: 'notes' })).toBe(false)
    })
})

// ── groupPagesByType ──────────────────────────────────────────────────────────

describe('groupPagesByType', () => {
    it('returns empty array for no pages', () => {
        expect(groupPagesByType([])).toEqual([])
    })

    it('groups pages under their type', () => {
        const pages = [
            { id: '1', type: 'notes', title: 'A' },
            { id: '2', type: 'notes', title: 'B' },
        ]
        const groups = groupPagesByType(pages)
        expect(groups.length).toBe(1)
        expect(groups[0].type).toBe('notes')
        expect(groups[0].pages.length).toBe(2)
    })

    it('follows TYPE_ORDER (list before progress before notes)', () => {
        const pages = [
            { id: '1', type: 'notes',    title: 'N' },
            { id: '2', type: 'progress', title: 'P' },
            { id: '3', type: 'list',     title: 'L' },
        ]
        const groups = groupPagesByType(pages)
        expect(groups.map(g => g.type)).toEqual(['list', 'progress', 'notes'])
    })

    it('uses TYPE_LABELS for known types', () => {
        const pages = [{ id: '1', type: 'list', title: 'X' }]
        const [group] = groupPagesByType(pages)
        expect(group.label).toBe('Lists')
    })

    it('omits pages with types not in TYPE_ORDER', () => {
        const pages = [{ id: '1', type: 'custom-widget', title: 'X' }]
        expect(groupPagesByType(pages)).toEqual([])
    })

    it('omits types with no pages', () => {
        const pages = [{ id: '1', type: 'progress', title: 'P' }]
        const groups = groupPagesByType(pages)
        expect(groups.every(g => g.type !== 'list')).toBe(true)
        expect(groups.every(g => g.type !== 'notes')).toBe(true)
    })
})
