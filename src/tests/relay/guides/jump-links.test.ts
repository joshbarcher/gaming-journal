// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/guides/jump-links.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified).
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mergeJumpLinks } from '../../../lib/server/relay/guides/parser/jump-links.js';

// Shorthand builders for flat ContentBlock[] fixtures.
const anchor  = (href, label = href) => ({ text: `<a href="${href}">${label}</a>` });
const list    = (...hrefs) => ({ type: 'list', ordered: false, items: hrefs.map(h => anchor(h)) });
const para    = { type: 'paragraph', html: 'body text' };
const heading = text => ({ type: 'heading', level: 3, text });

const variants = blocks => blocks.map(b => b.variant);
const hrefs    = block => block.items.map(i => i.text.match(/href="([^"]+)"/)[1]);

// ── Merging ───────────────────────────────────────────────────────────────────

describe('mergeJumpLinks — merging', () => {
    it('merges consecutive single-item anchor lists into one block', () => {
        // TheGamer emits one <ul> per link, so a 3-entry TOC arrives as 3 lists.
        const out = mergeJumpLinks([list('#a'), list('#b'), list('#c'), para]);
        assert.equal(out.length, 2);
        assert.equal(out[0].variant, 'jumplinks');
        assert.deepEqual(hrefs(out[0]), ['#a', '#b', '#c']);
        assert.equal(out[1].type, 'paragraph');
    });

    it('leaves a lone anchor list alone — one link is prose, not a TOC', () => {
        const out = mergeJumpLinks([list('#a'), para]);
        assert.equal(out[0].variant, undefined);
        assert.equal(out[0].type, 'list');
    });

    it('breaks the run on a non-jump-link block', () => {
        const out = mergeJumpLinks([list('#a'), list('#b'), para, list('#c'), list('#d')]);
        assert.deepEqual(variants(out), ['jumplinks', undefined, 'jumplinks']);
    });

    it('flattens nested sub-level entries into the pill row', () => {
        // TheGamer nests sub-headings under their parent entry.
        const nested = {
            type: 'list', ordered: false,
            items: [{ ...anchor('#a'), children: { ordered: false, items: [anchor('#a1')] } }],
        };
        const out = mergeJumpLinks([nested, list('#b')]);
        assert.equal(out.length, 1);
        assert.deepEqual(hrefs(out[0]), ['#a', '#a1', '#b']);
    });
});

// ── Rejection: things that look like jump links but aren't ────────────────────

describe('mergeJumpLinks — rejection', () => {
    it('rejects href="#" — a dead link, not a fragment', () => {
        assert.deepEqual(variants(mergeJumpLinks([list('#'), list('#')])), [undefined, undefined]);
    });

    it('rejects cross-page slug links', () => {
        assert.deepEqual(variants(mergeJumpLinks([list('Prologue'), list('Basics')])), [undefined, undefined]);
    });

    it('rejects a list mixing anchors with prose items', () => {
        const mixed = { type: 'list', items: [anchor('#a'), { text: 'plain text' }] };
        assert.equal(mergeJumpLinks([mixed])[0].variant, undefined);
    });

    it('rejects ordered lists — numbered anchor steps are walkthrough prose', () => {
        const out = mergeJumpLinks([{ ...list('#a'), ordered: true }, { ...list('#b'), ordered: true }]);
        assert.deepEqual(variants(out), [undefined, undefined]);
    });

    it('rejects an entry whose nested child is not itself a jump link', () => {
        const nested = {
            type: 'list',
            items: [{ ...anchor('#a'), children: { ordered: false, items: [{ text: 'prose' }] } }],
        };
        assert.deepEqual(variants(mergeJumpLinks([nested, list('#b')])), [undefined, undefined]);
    });
});

// ── Fragment repair ───────────────────────────────────────────────────────────
//
// TheGamer slugifies anchors from raw heading HTML; sectionize() derives section ids
// from the decoded heading text. The two disagree, so the source's own fragments
// point at nothing until repaired from the link label.

describe('mergeJumpLinks — fragment repair', () => {
    it('collapses runs of separators the source did not collapse', () => {
        const toc = [
            { type: 'list', items: [{ text: '<a href="#ryuji-sakamoto---chariot">Ryuji Sakamoto - Chariot</a>' }] },
            { type: 'list', items: [{ text: '<a href="#ann-takamaki---lovers">Ann Takamaki - Lovers</a>' }] },
        ];
        const out = mergeJumpLinks([...toc, heading('Ryuji Sakamoto - Chariot'), heading('Ann Takamaki - Lovers')]);
        assert.deepEqual(hrefs(out[0]), ['#ryuji-sakamoto-chariot', '#ann-takamaki-lovers']);
    });

    it('decodes entities the source slugified as digits (&#39; → 39)', () => {
        const toc = [
            { type: 'list', items: [{ text: '<a href="#ann-39-s-availability">Ann&#39;s Availability</a>' }] },
            { type: 'list', items: [{ text: '<a href="#the-tower">The Tower</a>' }] },
        ];
        const out = mergeJumpLinks([...toc, heading("Ann's Availability"), heading('The Tower')]);
        assert.deepEqual(hrefs(out[0]), ['#ann-s-availability', '#the-tower']);
    });

    it('leaves a fragment that already resolves untouched', () => {
        const out = mergeJumpLinks([list('#the-library'), list('#the-tower'), heading('The Library'), heading('The Tower')]);
        assert.deepEqual(hrefs(out[0]), ['#the-library', '#the-tower']);
    });

    it('leaves a fragment matching no heading untouched rather than guessing', () => {
        const out = mergeJumpLinks([list('#nowhere'), list('#gone'), heading('Something Else')]);
        assert.deepEqual(hrefs(out[0]), ['#nowhere', '#gone']);
    });
});
