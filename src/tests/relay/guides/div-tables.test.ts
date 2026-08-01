// @ts-nocheck — the guides parser/cleaner are untyped .js services (see content-parser.test.ts).
//
// Steam renders [table] BBCode as nested divs, which the content parser read as generic
// wrappers and flattened into one paragraph per cell — a 2x6 stat table came out as
// twelve stray lines. html-cleaner rebuilds declared div-grids into real <table>s so the
// existing table branch (and isDataTable, which keeps layout tables flattened) applies.
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { loadAndClean } from '../../../lib/server/relay/guides/parser/html-cleaner.js';
import { parseContent } from '../../../lib/server/relay/guides/parser/content-parser.js';
import { buildAdapter } from '../../../lib/server/relay/guides/steam/adapter.js';
import { defaults } from '../../../lib/server/relay/guides/config.js';

const cfg = { ...defaults, links: { keepExternal: false } };

function run(html, adapter) {
    const { $, content } = loadAndClean(`<html><body><div id="content">${html}</div></body></html>`, adapter);
    return parseContent($, content[0], cfg, {});
}

/** The Steam adapter's own selectors, scoped to the test container. */
const steam = { ...buildAdapter('#content') };
const bare  = { contentSelector: '#content', junkSelectors: [] };

const bbRow   = (tag, cells) => `<div class="bb_table_tr">${cells.map(c => `<div class="bb_table_${tag}">${c}</div>`).join('')}</div>`;
const bbTable = (rows) => `<div class="bb_table">${rows}</div>`;

// The table from the guide this was reported against (Steam guide 3771775845).
const LEVELING_NOX = bbTable(
    bbRow('th', ['Level', 'Range']) +
    bbRow('td', ['1', '150m']) +
    bbRow('td', ['2', '160m']) +
    bbRow('td', ['3', '180m']) +
    bbRow('td', ['4', '210m']) +
    bbRow('td', ['5', '250m']),
);

describe('Steam BBCode tables', () => {
    it('parses as one table block, not a paragraph per cell', () => {
        const blocks = run(LEVELING_NOX, steam);
        assert.deepEqual(blocks.map(b => b.type), ['table']);
    });

    it('keeps the header row as headers and the rest as rows', () => {
        const [table] = run(LEVELING_NOX, steam);
        assert.deepEqual(table.headers.map(h => h.text), ['Level', 'Range']);
        assert.equal(table.rows.length, 5);
        assert.deepEqual(table.rows[0].map(c => c.text), ['1', '150m']);
        assert.deepEqual(table.rows[4].map(c => c.text), ['5', '250m']);
    });

    it('preserves inline markup inside a cell', () => {
        const [table] = run(bbTable(bbRow('th', ['A']) + bbRow('td', ['<b>bold</b> and <a href="page">link</a>'])), steam);
        assert.match(table.rows[0][0].html, /<strong>bold<\/strong>/);
        assert.match(table.rows[0][0].html, /<a href="page">link<\/a>/);
    });

    it('handles a table with no header row', () => {
        const [table] = run(bbTable(bbRow('td', ['a', 'b']) + bbRow('td', ['c', 'd'])), steam);
        assert.equal(table.type, 'table');
        assert.equal(table.rows.length, 2);
    });

    it('leaves the surrounding prose in place around it', () => {
        const blocks = run(`<p>Before</p>${LEVELING_NOX}<p>After</p>`, steam);
        assert.deepEqual(blocks.map(b => b.type), ['paragraph', 'table', 'paragraph']);
    });

    it('does not fire without the adapter declaring the convention', () => {
        // Same markup, an adapter that never sees Steam pages: nothing is rewritten, so
        // this stays the old flattened behaviour rather than a table built by guesswork.
        assert.ok(!run(LEVELING_NOX, bare).some(b => b.type === 'table'));
    });
});

describe('tables buried in prose', () => {
    it('is hoisted out of a list item, where inline cleaning would shred it', () => {
        // cleanInlineHtml unwraps <table> but leaves the <tr>/<td> behind, and a list
        // item is a plain string in the block model — so the table has to become its own
        // block after the list. Real case: Steam guide 2879551630's "Technician" page.
        const blocks = run(`<ul><li>Combos:${LEVELING_NOX}</li></ul>`, steam);
        assert.deepEqual(blocks.map(b => b.type), ['list', 'table']);
        assert.deepEqual(blocks[0].items.map(i => i.text), ['Combos:']);
        assert.deepEqual(blocks[1].headers.map(h => h.text), ['Level', 'Range']);
    });

    it('is hoisted out of a paragraph', () => {
        const blocks = run(`<p>Ranges:${LEVELING_NOX}</p>`, steam);
        assert.deepEqual(blocks.map(b => b.type), ['paragraph', 'table']);
    });

    it('leaves no orphan table tags in the prose it came from', () => {
        const [list] = run(`<ul><li>Combos:${LEVELING_NOX}</li></ul>`, steam);
        assert.doesNotMatch(list.items[0].text, /<t(able|head|body|r|d|h)\b/);
    });
});

describe('layout divs stay flattened', () => {
    it('a plain wrapper stack is not mistaken for a table', () => {
        const blocks = run('<div class="row"><div class="col"><p>one</p></div><div class="col"><p>two</p></div></div>', steam);
        assert.deepEqual(blocks.map(b => b.type), ['paragraph', 'paragraph']);
    });

    it('a single-column BBCode table is still treated as layout', () => {
        // isDataTable's existing rule — one column carries no relationship worth a grid.
        const blocks = run(bbTable(bbRow('td', ['only']) + bbRow('td', ['one'])), steam);
        assert.ok(!blocks.some(b => b.type === 'table'));
    });
});

describe('ARIA grids', () => {
    it('converts role="table" markup for any source', () => {
        const html = `
            <div role="table">
                <div role="row"><span role="columnheader">Item</span><span role="columnheader">Cost</span></div>
                <div role="row"><span role="cell">Rope</span><span role="cell">50g</span></div>
            </div>`;
        const [table] = run(html, bare);
        assert.equal(table.type, 'table');
        assert.deepEqual(table.headers.map(h => h.text), ['Item', 'Cost']);
        assert.deepEqual(table.rows[0].map(c => c.text), ['Rope', '50g']);
    });

    it('converts the inner grid and leaves the wrapping one as layout', () => {
        // Converting both would nest <table> in <table>, which parseDataTable mis-reads —
        // its unscoped find('tr') counts the inner rows again as the outer's own.
        const inner = `<div role="table"><div role="row"><div role="columnheader">X</div><div role="columnheader">Y</div></div><div role="row"><div role="cell">1</div><div role="cell">2</div></div></div>`;
        const html  = `<div role="table"><div role="row"><div role="columnheader">A</div><div role="columnheader">B</div></div><div role="row"><div role="cell">${inner}</div><div role="cell">plain</div></div></div>`;
        const tables = run(html, bare).filter(b => b.type === 'table');
        assert.equal(tables.length, 1);
        assert.deepEqual(tables[0].headers.map(h => h.text), ['X', 'Y']);
        assert.deepEqual(tables[0].rows[0].map(c => c.text), ['1', '2']);
    });
});
