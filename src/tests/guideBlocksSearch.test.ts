import { describe, it, expect } from 'vitest'
import { extractPageEntries } from '../lib/guide-blocks-search'

// ── Degenerate inputs ─────────────────────────────────────────────────────────

describe('extractPageEntries — degenerate inputs', () => {
    it('returns [] for an empty blocks array', () => {
        expect(extractPageEntries([])).toEqual([])
    })

    it('throws on a non-array blocks argument (contract: caller must pass an array)', () => {
        expect(() => extractPageEntries(null as any)).toThrow()
        expect(() => extractPageEntries(undefined as any)).toThrow()
    })

    // REGRESSION: extractBlock's `switch (block.type)` once had no null guard, so a
    // null/undefined element in the blocks array crashed the whole extraction (and guide
    // search) instead of being skipped. Now such elements are skipped.
    it('skips null/undefined elements in the blocks array instead of throwing', () => {
        expect(() => extractPageEntries([null, { type: 'heading', text: 'ok' }])).not.toThrow()
        expect(extractPageEntries([undefined, { type: 'heading', text: 'ok' }] as any)).toEqual([
            { text: 'ok', blockPath: [1] },
        ])
    })

    it('ignores blocks with unknown or missing type', () => {
        const out = extractPageEntries([
            { type: 'video', src: 'x.mp4' },
            { html: '<p>no type field on this one</p>' },
            { type: undefined, text: 'nope' },
            { type: 'heading', text: 'real' },
        ])
        expect(out).toEqual([{ text: 'real', blockPath: [3] }])
    })
})

// ── Sections & path arithmetic ────────────────────────────────────────────────

describe('extractPageEntries — sections and blockPath', () => {
    it('section heading maps to [i, 0] and children to [i, j+1]', () => {
        const out = extractPageEntries([
            { type: 'paragraph', html: 'top level paragraph long enough' },
            {
                type: 'section',
                heading: 'Chapter 1',
                children: [
                    { type: 'paragraph', html: 'first child paragraph here' },
                    { type: 'heading', text: 'sub heading' },
                ],
            },
        ])
        expect(out).toEqual([
            { text: 'top level paragraph long enough', blockPath: [0] },
            { text: 'Chapter 1',                       blockPath: [1, 0] },
            { text: 'first child paragraph here',      blockPath: [1, 1] },
            { text: 'sub heading',                     blockPath: [1, 2] },
        ])
    })

    it('section with no heading still offsets children by +1 (mirrors renderer DOM layout)', () => {
        const out = extractPageEntries([
            { type: 'section', children: [{ type: 'heading', text: 'child' }] },
        ])
        // Contract: child index j=0 maps to path [0, 1] whether or not a heading exists.
        expect(out).toEqual([{ text: 'child', blockPath: [0, 1] }])
    })

    it('empty section (no heading, no children) produces no entries', () => {
        expect(extractPageEntries([{ type: 'section' }])).toEqual([])
        expect(extractPageEntries([{ type: 'section', heading: '', children: [] }])).toEqual([])
    })

    it('section whose children is not an array is treated as empty (no crash)', () => {
        const out = extractPageEntries([
            { type: 'section', heading: 'h', children: { bogus: true } },
        ])
        expect(out).toEqual([{ text: 'h', blockPath: [0, 0] }])
    })

    it('nested sections accumulate paths correctly', () => {
        const out = extractPageEntries([
            { type: 'paragraph', html: 'padding padding padding' },
            { type: 'paragraph', html: 'padding padding padding' },
            {
                type: 'section',
                heading: 'outer',
                children: [
                    {
                        type: 'section',
                        heading: 'inner',
                        children: [
                            { type: 'heading', text: 'skip me not' },
                            { type: 'paragraph', html: 'deep paragraph body text' },
                        ],
                    },
                ],
            },
        ])
        const deep = out.find(e => e.text === 'deep paragraph body text')
        // section at index 2 → inner section is child 0 → path [2,1]; paragraph is
        // inner child 1 → [2,1,2]
        expect(deep?.blockPath).toEqual([2, 1, 2])
        expect(out.find(e => e.text === 'inner')?.blockPath).toEqual([2, 1, 0])
    })

    it('survives 300-deep section nesting and produces a 301-long path', () => {
        let block: any = { type: 'paragraph', html: 'the innermost paragraph text' }
        for (let d = 0; d < 300; d++) {
            block = { type: 'section', heading: `h${d}`, children: [block] }
        }
        const out = extractPageEntries([block])
        const para = out.find(e => e.text === 'the innermost paragraph text')
        expect(para).toBeDefined()
        expect(para!.blockPath.length).toBe(301)
        expect(para!.blockPath[0]).toBe(0)
        // every nesting step is child index 0 → DOM index 1
        expect(para!.blockPath.slice(1).every(n => n === 1)).toBe(true)
        // 300 headings + 1 paragraph
        expect(out.length).toBe(301)
    })
})

// ── Headings ──────────────────────────────────────────────────────────────────

describe('extractPageEntries — headings', () => {
    it('uses text field, falling back to heading field', () => {
        expect(extractPageEntries([{ type: 'heading', text: 'from text' }]))
            .toEqual([{ text: 'from text', blockPath: [0] }])
        expect(extractPageEntries([{ type: 'heading', heading: 'from heading' }]))
            .toEqual([{ text: 'from heading', blockPath: [0] }])
        expect(extractPageEntries([{ type: 'heading', text: 'text wins', heading: 'loses' }]))
            .toEqual([{ text: 'text wins', blockPath: [0] }])
    })

    it('skips empty/missing heading text', () => {
        expect(extractPageEntries([{ type: 'heading' }])).toEqual([])
        expect(extractPageEntries([{ type: 'heading', text: '' }])).toEqual([])
    })

    it('preserves regex-special and unicode characters verbatim', () => {
        const nasty = 'C++ (100%) \\ walkthrough [part.2] — 「日本語」 $^*+?'
        expect(extractPageEntries([{ type: 'heading', text: nasty }]))
            .toEqual([{ text: nasty, blockPath: [0] }])
    })
})

// ── Paragraphs ────────────────────────────────────────────────────────────────

describe('extractPageEntries — paragraphs', () => {
    it('strips HTML tags and collapses whitespace', () => {
        const out = extractPageEntries([
            { type: 'paragraph', html: '<b>bold</b>   and\n\t<a href="x" class="y">link</a> ' },
        ])
        expect(out).toEqual([{ text: 'bold and link', blockPath: [0] }])
    })

    it('enforces the >10 char threshold on the stripped text', () => {
        // 10 chars — excluded
        expect(extractPageEntries([{ type: 'paragraph', html: '1234567890' }])).toEqual([])
        // 11 chars — included
        expect(extractPageEntries([{ type: 'paragraph', html: '12345678901' }]))
            .toEqual([{ text: '12345678901', blockPath: [0] }])
        // tags do not count toward length
        expect(extractPageEntries([{ type: 'paragraph', html: '<b><i><u>short</u></i></b>' }]))
            .toEqual([])
    })

    it('skips paragraphs with missing/undefined html', () => {
        expect(extractPageEntries([{ type: 'paragraph' }])).toEqual([])
        expect(extractPageEntries([{ type: 'paragraph', html: undefined }])).toEqual([])
    })

    it('does not decode HTML entities (contract: search text keeps raw entities)', () => {
        const out = extractPageEntries([
            { type: 'paragraph', html: 'Salt &amp; Sanctuary walkthrough' },
        ])
        expect(out[0].text).toBe('Salt &amp; Sanctuary walkthrough')
    })

    it('treats unclosed angle brackets conservatively (contract of the tag-strip regex)', () => {
        // "a < b" has no closing '>' so nothing is stripped
        const out = extractPageEntries([{ type: 'paragraph', html: 'when a < b then attack' }])
        expect(out[0].text).toBe('when a < b then attack')
        // "<6 and 7>" looks like a tag to the regex and IS stripped — documented quirk
        const out2 = extractPageEntries([{ type: 'paragraph', html: 'roll 5<6 and 7>3 to win the fight' }])
        expect(out2[0].text).toBe('roll 5 3 to win the fight')
    })
})

// ── Lists ─────────────────────────────────────────────────────────────────────

describe('extractPageEntries — lists', () => {
    it('flattens nested list items into one entry pointing at the list', () => {
        const out = extractPageEntries([
            {
                type: 'list',
                items: [
                    {
                        text: 'parent one',
                        children: { ordered: false, items: [{ text: 'child a' }, { text: 'child b' }] },
                    },
                    { text: 'parent two' },
                ],
            },
        ])
        expect(out).toEqual([
            { text: 'parent one child a child b parent two', blockPath: [0] },
        ])
    })

    it('enforces the >3 char threshold', () => {
        expect(extractPageEntries([{ type: 'list', items: [{ text: 'abc' }] }])).toEqual([])
        expect(extractPageEntries([{ type: 'list', items: [{ text: 'abcd' }] }]))
            .toEqual([{ text: 'abcd', blockPath: [0] }])
    })

    it('handles items with no text but nested children', () => {
        const out = extractPageEntries([
            {
                type: 'list',
                items: [{ children: { ordered: true, items: [{ text: 'only the child text' }] } }],
            },
        ])
        expect(out).toEqual([{ text: 'only the child text', blockPath: [0] }])
    })

    it('skips list with missing/empty items', () => {
        expect(extractPageEntries([{ type: 'list' }])).toEqual([])
        expect(extractPageEntries([{ type: 'list', items: [] }])).toEqual([])
    })

    // REGRESSION: flattenListText once did `item.text` with no null guard, so a null
    // entry in items[] crashed extraction. Now null list items are skipped.
    it('skips null list items instead of throwing', () => {
        expect(() => extractPageEntries([
            { type: 'list', items: [null, { text: 'valid item text' }] },
        ])).not.toThrow()
    })

    it('strips HTML inside item text', () => {
        const out = extractPageEntries([
            { type: 'list', items: [{ text: '<b>bold item</b> with <i>markup</i>' }] },
        ])
        expect(out).toEqual([{ text: 'bold item with markup', blockPath: [0] }])
    })
})

// ── Images ────────────────────────────────────────────────────────────────────

describe('extractPageEntries — images', () => {
    it('joins caption and alt', () => {
        expect(extractPageEntries([{ type: 'image', caption: 'cap', alt: 'alt text' }]))
            .toEqual([{ text: 'cap alt text', blockPath: [0] }])
    })

    it('works with only caption or only alt', () => {
        expect(extractPageEntries([{ type: 'image', caption: 'just cap' }]))
            .toEqual([{ text: 'just cap', blockPath: [0] }])
        expect(extractPageEntries([{ type: 'image', alt: 'just alt' }]))
            .toEqual([{ text: 'just alt', blockPath: [0] }])
    })

    it('skips images with no caption/alt (or empty strings)', () => {
        expect(extractPageEntries([{ type: 'image', src: 'x.png' }])).toEqual([])
        expect(extractPageEntries([{ type: 'image', caption: '', alt: '' }])).toEqual([])
    })
})

// ── Tables ────────────────────────────────────────────────────────────────────

describe('extractPageEntries — tables', () => {
    it('joins headers and row cells with " · ", preferring html over text', () => {
        const out = extractPageEntries([
            {
                type: 'table',
                headers: [{ text: 'Name' }, { html: '<b>Value</b>' }],
                rows: [
                    [{ text: 'HP' }, { text: '100' }],
                    [{ html: '<i>MP</i>', text: 'ignored' }, { text: '50' }],
                ],
            },
        ])
        expect(out).toEqual([
            { text: 'Name · Value · HP · 100 · MP · 50', blockPath: [0] },
        ])
    })

    it('tolerates null cells and missing headers/rows', () => {
        const out = extractPageEntries([
            {
                type: 'table',
                rows: [[null, { text: 'only cell' }, undefined]],
            },
        ])
        expect(out).toEqual([{ text: 'only cell', blockPath: [0] }])
        expect(extractPageEntries([{ type: 'table' }])).toEqual([])
        expect(extractPageEntries([{ type: 'table', headers: [], rows: [] }])).toEqual([])
    })

    it('skips a table whose cells all strip to empty', () => {
        expect(extractPageEntries([
            { type: 'table', headers: [{ text: '' }], rows: [[{ html: '<br>' }]] },
        ])).toEqual([])
    })

    it('headers-only table still produces an entry', () => {
        expect(extractPageEntries([{ type: 'table', headers: [{ text: 'Col A' }, { text: 'Col B' }] }]))
            .toEqual([{ text: 'Col A · Col B', blockPath: [0] }])
    })
})

// ── Scale ─────────────────────────────────────────────────────────────────────

describe('extractPageEntries — scale', () => {
    it('handles 8000 blocks and keeps indices aligned', () => {
        const blocks = Array.from({ length: 8000 }, (_, i) => ({
            type: 'paragraph',
            html: `paragraph number ${i} body`,
        }))
        const out = extractPageEntries(blocks)
        expect(out.length).toBe(8000)
        expect(out[0].blockPath).toEqual([0])
        expect(out[7999]).toEqual({ text: 'paragraph number 7999 body', blockPath: [7999] })
    })

    it('handles a single section with 2000 children', () => {
        const children = Array.from({ length: 2000 }, (_, i) => ({
            type: 'heading',
            text: `h${i}`,
        }))
        const out = extractPageEntries([{ type: 'section', heading: 'big', children }])
        expect(out.length).toBe(2001)
        expect(out[2000]).toEqual({ text: 'h1999', blockPath: [0, 2000] })
    })
})
