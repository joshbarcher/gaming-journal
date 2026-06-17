import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { applyIndent, renderListItems, parseListItems } from '../lib/js/views/page-helpers.js'

// ── parseListItems ────────────────────────────────────────────────────────────

function makeUl(innerHtml: string) {
    const dom = new JSDOM(`<body><ul>${innerHtml}</ul></body>`)
    return dom.window.document.querySelector('ul')!
}

describe('parseListItems', () => {
    it('returns empty array for an empty list', () => {
        expect(parseListItems(makeUl(''))).toEqual([])
    })

    it('returns flat items at depth 0', () => {
        const result = parseListItems(makeUl('<li>Alpha</li><li>Beta</li>'))
        expect(result.length).toBe(2)
        expect(result[0].depth).toBe(0)
        expect(result[0].html).toBe('Alpha')
        expect(result[1].depth).toBe(0)
        expect(result[1].html).toBe('Beta')
    })

    it('returns nested items at depth 1', () => {
        const result = parseListItems(makeUl('<li>Parent<ul><li>Child</li></ul></li>'))
        expect(result.length).toBe(2)
        expect(result[0].depth).toBe(0)
        expect(result[0].html).toBe('Parent')
        expect(result[1].depth).toBe(1)
        expect(result[1].html).toBe('Child')
    })

    it('excludes nested list markup from the parent item html', () => {
        const result = parseListItems(makeUl('<li>Parent<ul><li>Child</li></ul></li>'))
        expect(result[0].html).not.toContain('<ul>')
        expect(result[0].html).not.toContain('Child')
    })

    it('handles two levels of nesting', () => {
        const result = parseListItems(makeUl('<li>Root<ul><li>Mid<ul><li>Leaf</li></ul></li></ul></li>'))
        expect(result.length).toBe(3)
        expect(result[0].depth).toBe(0)
        expect(result[1].depth).toBe(1)
        expect(result[2].depth).toBe(2)
        expect(result[2].html).toBe('Leaf')
    })

    it('handles multiple siblings at each level', () => {
        const result = parseListItems(makeUl(
            '<li>A</li><li>B<ul><li>B1</li><li>B2</li></ul></li><li>C</li>'
        ))
        expect(result.length).toBe(5)
        expect(result.map(r => r.depth)).toEqual([0, 0, 1, 1, 0])
        expect(result.map(r => r.html)).toEqual(['A', 'B', 'B1', 'B2', 'C'])
    })

    it('handles ol nested inside li', () => {
        const dom = new JSDOM('<body><ul><li>Item<ol><li>Ordered</li></ol></li></ul></body>')
        const ul  = dom.window.document.querySelector('ul')!
        const result = parseListItems(ul)
        expect(result.length).toBe(2)
        expect(result[1].depth).toBe(1)
        expect(result[1].html).toBe('Ordered')
    })
})

// ── applyIndent ───────────────────────────────────────────────────────────────

describe('applyIndent — indent', () => {
    it('increases depth for items in range', () => {
        const items = [{ depth: 0, html: '' }, { depth: 0, html: '' }, { depth: 0, html: '' }]
        const result = applyIndent(items, 0, 1, false)
        expect(result[0].depth).toBe(1)
        expect(result[1].depth).toBe(1)
        expect(result[2].depth).toBe(0)
    })

    it('does not mutate the original array', () => {
        const items = [{ depth: 0, html: '' }, { depth: 0, html: '' }]
        applyIndent(items, 0, 1, false)
        expect(items[0].depth).toBe(0)
    })

    it('clamps endIdx to the last item', () => {
        const items = [{ depth: 0, html: '' }, { depth: 0, html: '' }]
        const result = applyIndent(items, 0, 99, false)
        expect(result[0].depth).toBe(1)
        expect(result[1].depth).toBe(1)
    })
})

describe('applyIndent — outdent', () => {
    it('decreases depth for items in range', () => {
        const items = [{ depth: 2, html: '' }, { depth: 1, html: '' }, { depth: 2, html: '' }]
        const result = applyIndent(items, 0, 1, true)
        expect(result[0].depth).toBe(1)
        expect(result[1].depth).toBe(0)
        expect(result[2].depth).toBe(2)
    })

    it('floors depth at 0 when already at root', () => {
        const items = [{ depth: 0, html: '' }, { depth: 0, html: '' }]
        const result = applyIndent(items, 0, 1, true)
        expect(result[0].depth).toBe(0)
        expect(result[1].depth).toBe(0)
    })
})

describe('applyIndent — out-of-bounds startIdx', () => {
    it('returns items unchanged when startIdx is negative', () => {
        const items = [{ depth: 0, html: '' }]
        const result = applyIndent(items, -1, 0, false)
        expect(result[0].depth).toBe(0)
    })

    it('returns items unchanged when startIdx is at or past items length', () => {
        const items = [{ depth: 0, html: '' }]
        const result = applyIndent(items, 1, 2, false)
        expect(result[0].depth).toBe(0)
    })
})

// ── renderListItems ───────────────────────────────────────────────────────────

describe('renderListItems', () => {
    it('returns empty string for empty items', () => {
        expect(renderListItems([], 'ul')).toBe('')
    })

    it('renders flat items as sibling <li> elements', () => {
        const items = [{ depth: 0, html: 'Alpha' }, { depth: 0, html: 'Beta' }]
        expect(renderListItems(items, 'ul')).toBe('<li>Alpha</li><li>Beta</li>')
    })

    it('uses the supplied tag for nested lists', () => {
        const items = [
            { depth: 0, html: 'Parent' },
            { depth: 1, html: 'Child' },
        ]
        const result = renderListItems(items, 'ol')
        expect(result).toContain('<ol>')
        expect(result).toContain('<li>Child</li>')
    })

    it('nests a child item inside its parent <li>', () => {
        const items = [
            { depth: 0, html: 'A' },
            { depth: 1, html: 'A1' },
            { depth: 0, html: 'B' },
        ]
        const result = renderListItems(items, 'ul')
        expect(result).toBe('<li>A<ul><li>A1</li></ul></li><li>B</li>')
    })

    it('handles multiple children under one parent', () => {
        const items = [
            { depth: 0, html: 'P' },
            { depth: 1, html: 'C1' },
            { depth: 1, html: 'C2' },
        ]
        const result = renderListItems(items, 'ul')
        expect(result).toBe('<li>P<ul><li>C1</li><li>C2</li></ul></li>')
    })

    it('handles two levels of nesting', () => {
        const items = [
            { depth: 0, html: 'Root' },
            { depth: 1, html: 'Mid' },
            { depth: 2, html: 'Leaf' },
        ]
        const result = renderListItems(items, 'ul')
        expect(result).toBe('<li>Root<ul><li>Mid<ul><li>Leaf</li></ul></li></ul></li>')
    })

    it('normalises items that start at a non-zero minimum depth', () => {
        const items = [{ depth: 1, html: 'A' }, { depth: 1, html: 'B' }]
        const result = renderListItems(items, 'ul')
        expect(result).toBe('<li>A</li><li>B</li>')
    })
})
