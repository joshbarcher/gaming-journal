import { describe, it, expect } from 'vitest'
import { applyIndent, renderListItems, parseListItems } from '../lib/js/views/page-helpers.js'
import type { EditorListItem } from '../lib/types.js'

function makeUl(innerHtml: string): HTMLUListElement {
    const ul = document.createElement('ul')
    ul.innerHTML = innerHtml
    return ul
}

// ── parseListItems — structural edge cases ────────────────────────────────────

describe('parseListItems — malformed and unusual structures', () => {
    it('handles a UL nested directly inside a UL (no wrapping LI)', () => {
        // Editors/paste can produce this; it exercises the non-LI walk branch.
        const ul = document.createElement('ul')
        const li = document.createElement('li')
        li.textContent = 'A'
        const inner = document.createElement('ul')
        const innerLi = document.createElement('li')
        innerLi.textContent = 'Deep'
        inner.appendChild(innerLi)
        ul.appendChild(li)
        ul.appendChild(inner)
        expect(parseListItems(ul)).toEqual([
            { depth: 0, html: 'A' },
            { depth: 1, html: 'Deep' },
        ])
    })

    it('handles two sibling nested lists inside one LI', () => {
        const result = parseListItems(makeUl('<li>P<ul><li>C1</li></ul><ul><li>C2</li></ul></li>'))
        expect(result.map(r => ({ d: r.depth, h: r.html }))).toEqual([
            { d: 0, h: 'P' }, { d: 1, h: 'C1' }, { d: 1, h: 'C2' },
        ])
    })

    it('keeps text that follows a nested list inside the parent item html', () => {
        const result = parseListItems(makeUl('<li>Before<ul><li>Child</li></ul>After</li>'))
        expect(result[0].html).toBe('BeforeAfter')
        expect(result[1].html).toBe('Child')
    })

    it('preserves inline markup verbatim, including event-handler attributes (editor round-trip contract)', () => {
        // The html field is the user's own contenteditable content — parse must not
        // rewrite it. Sanitization is a separate concern at render/save time.
        const result = parseListItems(makeUl('<li><b>bold</b> <img src="x" onerror="alert(1)"></li>'))
        expect(result[0].html).toContain('<b>bold</b>')
        expect(result[0].html).toContain('onerror="alert(1)"')
    })

    it('skips non-list children mixed into the UL', () => {
        const result = parseListItems(makeUl('<li>A</li><div>stray</div><li>B</li>'))
        expect(result.map(r => r.html)).toEqual(['A', 'B'])
    })

    it('returns items for an empty LI', () => {
        const result = parseListItems(makeUl('<li></li><li>B</li>'))
        expect(result[0]).toEqual({ depth: 0, html: '' })
    })
})

// ── applyIndent — range edge cases ────────────────────────────────────────────

describe('applyIndent — range edge cases', () => {
    it('endIdx before startIdx changes nothing but still returns fresh copies', () => {
        const items = [{ depth: 1, html: 'a' }, { depth: 1, html: 'b' }]
        const result = applyIndent(items, 1, 0, false)
        expect(result.map(i => i.depth)).toEqual([1, 1])
        expect(result[0]).not.toBe(items[0]) // copies, not the caller's objects
    })

    it('single-item range only touches that item', () => {
        const items = [{ depth: 0, html: 'a' }, { depth: 0, html: 'b' }, { depth: 0, html: 'c' }]
        const result = applyIndent(items, 1, 1, false)
        expect(result.map(i => i.depth)).toEqual([0, 1, 0])
    })

    it('mixed depths outdent independently, flooring each at 0', () => {
        const items = [{ depth: 0, html: 'a' }, { depth: 3, html: 'b' }]
        const result = applyIndent(items, 0, 1, true)
        expect(result.map(i => i.depth)).toEqual([0, 2])
    })
})

// ── renderListItems — depth-jump branches ─────────────────────────────────────

describe('renderListItems — depth jumps', () => {
    it('a +2 depth jump renders doubly-nested list wrappers', () => {
        const items: EditorListItem[] = [{ depth: 0, html: 'A' }, { depth: 2, html: 'B' }]
        expect(renderListItems(items, 'ul')).toBe('<li>A<ul><ul><li>B</li></ul></ul></li>')
    })

    it('a leading item deeper than the minimum renders before shallower siblings', () => {
        const items: EditorListItem[] = [{ depth: 2, html: 'X' }, { depth: 0, html: 'Y' }]
        expect(renderListItems(items, 'ul')).toBe('<ul><li>X</li></ul><li>Y</li>')
    })

    it('descending stairs close each level correctly', () => {
        const items: EditorListItem[] = [
            { depth: 0, html: 'A' }, { depth: 1, html: 'B' }, { depth: 2, html: 'C' },
            { depth: 1, html: 'D' }, { depth: 0, html: 'E' },
        ]
        expect(renderListItems(items, 'ul'))
            .toBe('<li>A<ul><li>B<ul><li>C</li></ul></li><li>D</li></ul></li><li>E</li>')
    })

    it('contract: item html is emitted verbatim (no escaping — editor content by design)', () => {
        const items: EditorListItem[] = [{ depth: 0, html: '<em>x</em>' }]
        expect(renderListItems(items, 'ul')).toBe('<li><em>x</em></li>')
    })

    it('contract: negative depths render like the minimum depth', () => {
        const items: EditorListItem[] = [{ depth: -1, html: 'A' }, { depth: 0, html: 'B' }]
        expect(renderListItems(items, 'ul')).toBe('<li>A<ul><li>B</li></ul></li>')
    })
})

// ── round-trip invariant ──────────────────────────────────────────────────────

describe('parse ∘ render round-trip', () => {
    it('render → parse reproduces the original well-formed items', () => {
        const items: EditorListItem[] = [
            { depth: 0, html: 'A' }, { depth: 1, html: 'A1' }, { depth: 2, html: 'A1x' },
            { depth: 1, html: 'A2' }, { depth: 0, html: 'B' },
        ]
        const ul = makeUl(renderListItems(items, 'ul'))
        expect(parseListItems(ul)).toEqual(items)
    })

    it('round-trips a large flat list without loss', () => {
        const items: EditorListItem[] = Array.from({ length: 300 }, (_, i) => ({ depth: i % 3, html: `item ${i}` }))
        // normalise: parse reproduces depths relative to structure, so only test
        // structurally valid sequences (no jumps > +1)
        let prev = 0
        const valid = items.map(it => {
            const d = Math.min(it.depth, prev + 1)
            prev = d
            return { ...it, depth: d }
        })
        const ul = makeUl(renderListItems(valid, 'ul'))
        expect(parseListItems(ul)).toEqual(valid)
    })
})
