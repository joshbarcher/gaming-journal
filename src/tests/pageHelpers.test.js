import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { applyIndent, renderListItems, parseListItems } from '../lib/js/views/page-helpers.js'

// ── parseListItems ────────────────────────────────────────────────────────────

function makeUl(innerHtml) {
    const dom = new JSDOM(`<body><ul>${innerHtml}</ul></body>`)
    return dom.window.document.querySelector('ul')
}

describe('parseListItems', () => {
    it('returns empty array for an empty list', () => {
        assert.deepEqual(parseListItems(makeUl('')), [])
    })

    it('returns flat items at depth 0', () => {
        const result = parseListItems(makeUl('<li>Alpha</li><li>Beta</li>'))
        assert.equal(result.length, 2)
        assert.equal(result[0].depth, 0)
        assert.equal(result[0].html,  'Alpha')
        assert.equal(result[1].depth, 0)
        assert.equal(result[1].html,  'Beta')
    })

    it('returns nested items at depth 1', () => {
        const result = parseListItems(makeUl('<li>Parent<ul><li>Child</li></ul></li>'))
        assert.equal(result.length, 2)
        assert.equal(result[0].depth, 0)
        assert.equal(result[0].html,  'Parent')
        assert.equal(result[1].depth, 1)
        assert.equal(result[1].html,  'Child')
    })

    it('excludes nested list markup from the parent item html', () => {
        const result = parseListItems(makeUl('<li>Parent<ul><li>Child</li></ul></li>'))
        assert.ok(!result[0].html.includes('<ul>'),   'parent html must not contain nested <ul>')
        assert.ok(!result[0].html.includes('Child'),  'parent html must not contain child text')
    })

    it('handles two levels of nesting', () => {
        const result = parseListItems(makeUl('<li>Root<ul><li>Mid<ul><li>Leaf</li></ul></li></ul></li>'))
        assert.equal(result.length, 3)
        assert.equal(result[0].depth, 0)
        assert.equal(result[1].depth, 1)
        assert.equal(result[2].depth, 2)
        assert.equal(result[2].html, 'Leaf')
    })

    it('handles multiple siblings at each level', () => {
        const result = parseListItems(makeUl(
            '<li>A</li><li>B<ul><li>B1</li><li>B2</li></ul></li><li>C</li>'
        ))
        assert.equal(result.length, 5)
        assert.deepEqual(result.map(r => r.depth), [0, 0, 1, 1, 0])
        assert.deepEqual(result.map(r => r.html),  ['A', 'B', 'B1', 'B2', 'C'])
    })

    it('handles ol nested inside li', () => {
        const dom = new JSDOM('<body><ul><li>Item<ol><li>Ordered</li></ol></li></ul></body>')
        const ul  = dom.window.document.querySelector('ul')
        const result = parseListItems(ul)
        assert.equal(result.length, 2)
        assert.equal(result[1].depth, 1)
        assert.equal(result[1].html, 'Ordered')
    })
})

// ── applyIndent ───────────────────────────────────────────────────────────────

describe('applyIndent — indent', () => {
    it('increases depth for items in range', () => {
        const items = [{ depth: 0 }, { depth: 0 }, { depth: 0 }]
        const result = applyIndent(items, 0, 1, false)
        assert.equal(result[0].depth, 1)
        assert.equal(result[1].depth, 1)
        assert.equal(result[2].depth, 0)
    })

    it('does not mutate the original array', () => {
        const items = [{ depth: 0 }, { depth: 0 }]
        applyIndent(items, 0, 1, false)
        assert.equal(items[0].depth, 0)
    })

    it('clamps endIdx to the last item', () => {
        const items = [{ depth: 0 }, { depth: 0 }]
        const result = applyIndent(items, 0, 99, false)
        assert.equal(result[0].depth, 1)
        assert.equal(result[1].depth, 1)
    })
})

describe('applyIndent — outdent', () => {
    it('decreases depth for items in range', () => {
        const items = [{ depth: 2 }, { depth: 1 }, { depth: 2 }]
        const result = applyIndent(items, 0, 1, true)
        assert.equal(result[0].depth, 1)
        assert.equal(result[1].depth, 0)
        assert.equal(result[2].depth, 2)
    })

    it('floors depth at 0 when already at root', () => {
        const items = [{ depth: 0 }, { depth: 0 }]
        const result = applyIndent(items, 0, 1, true)
        assert.equal(result[0].depth, 0)
        assert.equal(result[1].depth, 0)
    })
})

describe('applyIndent — out-of-bounds startIdx', () => {
    it('returns items unchanged when startIdx is negative', () => {
        const items = [{ depth: 0 }]
        const result = applyIndent(items, -1, 0, false)
        assert.equal(result[0].depth, 0)
    })

    it('returns items unchanged when startIdx is at or past items length', () => {
        const items = [{ depth: 0 }]
        const result = applyIndent(items, 1, 2, false)
        assert.equal(result[0].depth, 0)
    })
})

// ── renderListItems ───────────────────────────────────────────────────────────

describe('renderListItems', () => {
    it('returns empty string for empty items', () => {
        assert.equal(renderListItems([], 'ul'), '')
    })

    it('renders flat items as sibling <li> elements', () => {
        const items = [{ depth: 0, html: 'Alpha' }, { depth: 0, html: 'Beta' }]
        assert.equal(renderListItems(items, 'ul'), '<li>Alpha</li><li>Beta</li>')
    })

    it('uses the supplied tag for nested lists', () => {
        const items = [
            { depth: 0, html: 'Parent' },
            { depth: 1, html: 'Child' },
        ]
        const result = renderListItems(items, 'ol')
        assert.ok(result.includes('<ol>'), 'should use <ol> for nested list')
        assert.ok(result.includes('<li>Child</li>'))
    })

    it('nests a child item inside its parent <li>', () => {
        const items = [
            { depth: 0, html: 'A' },
            { depth: 1, html: 'A1' },
            { depth: 0, html: 'B' },
        ]
        const result = renderListItems(items, 'ul')
        assert.equal(result, '<li>A<ul><li>A1</li></ul></li><li>B</li>')
    })

    it('handles multiple children under one parent', () => {
        const items = [
            { depth: 0, html: 'P' },
            { depth: 1, html: 'C1' },
            { depth: 1, html: 'C2' },
        ]
        const result = renderListItems(items, 'ul')
        assert.equal(result, '<li>P<ul><li>C1</li><li>C2</li></ul></li>')
    })

    it('handles two levels of nesting', () => {
        const items = [
            { depth: 0, html: 'Root' },
            { depth: 1, html: 'Mid' },
            { depth: 2, html: 'Leaf' },
        ]
        const result = renderListItems(items, 'ul')
        assert.equal(result, '<li>Root<ul><li>Mid<ul><li>Leaf</li></ul></li></ul></li>')
    })

    it('normalises items that start at a non-zero minimum depth', () => {
        const items = [{ depth: 1, html: 'A' }, { depth: 1, html: 'B' }]
        const result = renderListItems(items, 'ul')
        assert.equal(result, '<li>A</li><li>B</li>')
    })
})
