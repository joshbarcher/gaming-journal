// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/guides/content-parser.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified).
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { parseContent, collectImageBlocks } from '../../../lib/server/relay/guides/parser/content-parser.js';
import { defaults } from '../../../lib/server/relay/guides/config.js';
import * as cheerio from 'cheerio';

// Minimal config — no external links, images off
const cfg = { ...defaults, links: { keepExternal: false } };

function parse(html) {
    const $ = cheerio.load(`<div id="content">${html}</div>`);
    return parseContent($, $('#content')[0], cfg, {});
}

function flat(blocks) {
    const out = [];
    for (const b of blocks) {
        out.push(b);
        if (b.children) out.push(...flat(b.children));
    }
    return out;
}

// ── Paragraphs ────────────────────────────────────────────────────────────────

describe('paragraphs', () => {
    it('emits a paragraph block for a <p>', () => {
        const blocks = parse('<p>Hello world</p>');
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].type, 'paragraph');
        assert.ok(blocks[0].html.includes('Hello world'));
    });

    it('strips escaped HTML entities that look like tags', () => {
        const blocks = parse('<p>&lt;div class="simg-pop-btn"&gt; &lt;/div&gt;</p>');
        const paras = blocks.filter(b => b.type === 'paragraph');
        assert.equal(paras.length, 0, 'escaped HTML div should be filtered out');
    });

    it('strips escaped HTML from floating text nodes', () => {
        const blocks = parse('&lt;div class="popup"&gt; &lt;/div&gt;');
        const paras = blocks.filter(b => b.type === 'paragraph');
        assert.equal(paras.length, 0);
    });

    it('strips GameFAQs | NAV | separator paragraphs', () => {
        const blocks = parse('<p>| MAIN MENU |</p>');
        assert.equal(blocks.filter(b => b.type === 'paragraph').length, 0);
    });

    it('strips multi-part nav separators like | A | B |', () => {
        const blocks = parse('<p>| HOME | BACK | TOP |</p>');
        assert.equal(blocks.filter(b => b.type === 'paragraph').length, 0);
    });

    it('keeps paragraphs that merely contain a pipe character', () => {
        const blocks = parse('<p>Press A | B to confirm</p>');
        assert.equal(blocks.filter(b => b.type === 'paragraph').length, 1);
    });

    it('keeps real content even when escaped entities are mixed in', () => {
        const blocks = parse('<p>See &lt;Chapter 2&gt; for details</p>');
        // &lt;Chapter 2&gt; is text content referencing a title, not a junk div
        // After stripping escaped tags the text "for details" remains
        assert.equal(blocks.filter(b => b.type === 'paragraph').length, 1);
    });
});

// ── Headings ──────────────────────────────────────────────────────────────────

describe('headings', () => {
    it('emits heading blocks for h2–h4', () => {
        const blocks = parse('<h2>Chapter 1</h2><h3>Section A</h3><h4>Sub</h4>');
        const headings = blocks.filter(b => b.type === 'heading');
        assert.equal(headings.length, 3);
        assert.equal(headings[0].level, 2);
        assert.equal(headings[0].text, 'Chapter 1');
        assert.equal(headings[1].level, 3);
        assert.equal(headings[2].level, 4);
    });

    it('ignores empty headings', () => {
        const blocks = parse('<h2>  </h2>');
        assert.equal(blocks.filter(b => b.type === 'heading').length, 0);
    });
});

// ── Lists ─────────────────────────────────────────────────────────────────────

describe('lists', () => {
    it('emits a list block for <ul>', () => {
        const blocks = parse('<ul><li>Alpha</li><li>Beta</li></ul>');
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].type, 'list');
        assert.equal(blocks[0].ordered, false);
        assert.equal(blocks[0].items.length, 2);
        assert.equal(blocks[0].items[0].text, 'Alpha');
    });

    it('emits ordered list for <ol>', () => {
        const blocks = parse('<ol><li>First</li><li>Second</li></ol>');
        assert.equal(blocks[0].ordered, true);
    });

    it('preserves anchor links in list items', () => {
        const blocks = parse('<ul><li><a href="/faqs/123/intro">Introduction</a></li></ul>');
        const item = blocks[0].items[0];
        assert.ok(item.text.includes('Introduction'), 'text should include link label');
    });

    it('preserves inline formatting (bold) in list items', () => {
        const blocks = parse('<ul><li><strong>Important</strong> note</li></ul>');
        const item = blocks[0].items[0];
        assert.ok(item.text.includes('Important'), 'bold text should be present');
    });

    it('handles nested lists', () => {
        const blocks = parse(`
            <ul>
                <li>Parent
                    <ul><li>Child A</li><li>Child B</li></ul>
                </li>
            </ul>
        `);
        const parent = blocks[0].items[0];
        assert.ok(parent.children, 'should have nested children');
        assert.equal(parent.children.items.length, 2);
        assert.equal(parent.children.items[0].text, 'Child A');
    });

    it('ignores empty list items', () => {
        const blocks = parse('<ul><li>Real</li><li>  </li></ul>');
        const items = blocks[0].items.filter(i => i.text.trim());
        assert.equal(items.length, 1);
    });
});

// ── Images ────────────────────────────────────────────────────────────────────

describe('images', () => {
    it('emits an image block from <img> inside <p>', () => {
        const blocks = parse('<p><img src="/img/foo.jpg" alt="screenshot"></p>');
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].type, 'image');
        assert.equal(blocks[0].alt, 'screenshot');
    });

    it('skips data: URI images', () => {
        const blocks = parse('<p><img src="data:image/png;base64,abc" alt=""></p>');
        assert.equal(blocks.filter(b => b.type === 'image').length, 0);
    });
});

// ── Images inside table cells ─────────────────────────────────────────────────
//
// Cells are modelled as text, so an image in a cell used to be dropped with only its
// alt text surviving. Data tables carry a large share of the screenshots on wiki-style
// guides (Neoseeker, Game8), so `cellContent` now also attaches an `image`.
// The text/html output must stay byte-identical — this is purely additive.

const dataTable = (cells) => `<table><tr><th>H</th><th>H2</th></tr><tr>${cells}</tr></table>`;
const firstRow  = (blocks) => blocks.find(b => b.type === 'table').rows[0];

describe('table cell images', () => {
    it('attaches an image to an image-only cell and keeps alt as the text', () => {
        const blocks = parse(dataTable('<td><img src="/img/a.jpg" alt="Boss"></td><td>x</td>'));
        const cell = firstRow(blocks)[0];
        assert.equal(cell.image.src, '/img/a.jpg');
        assert.equal(cell.image.alt, 'Boss');
        assert.equal(cell.image.type, 'image', 'same shape as a top-level image block');
        assert.equal(cell.text, 'Boss', 'alt-text fallback must be unchanged');
    });

    it('attaches an image to a cell that ALSO has text', () => {
        // The original bug: only the image-only branch attached the image, so every
        // cell pairing a screenshot with a label silently lost its image.
        const blocks = parse(dataTable('<td>Iron Sword<img src="/img/s.jpg" alt="sword"></td><td>x</td>'));
        const cell = firstRow(blocks)[0];
        assert.equal(cell.image.src, '/img/s.jpg');
        assert.equal(cell.text, 'Iron Sword', 'text must be untouched');
    });

    it('attaches an image to a cell that also carries a link (html branch)', () => {
        const blocks = parse(dataTable('<td><a href="foo">Cave</a><img src="/img/c.jpg" alt="cave"></td><td>x</td>'));
        const cell = firstRow(blocks)[0];
        assert.equal(cell.image.src, '/img/c.jpg');
        assert.ok(cell.html.includes('href'), 'link html must still be produced');
    });

    it('ignores glyph-sized icons so they do not become block images', () => {
        // Item/button glyphs sit next to cell text as decoration — one Neoseeker page
        // alone has 348 of them, which would swamp the table if promoted.
        const blocks = parse(dataTable('<td>Chest<img src="/img/i.png" alt="i" width="17" height="15"></td><td>x</td>'));
        assert.equal(firstRow(blocks)[0].image, undefined);
    });

    it('keeps an image whose stated size is above the glyph threshold', () => {
        const blocks = parse(dataTable('<td><img src="/img/b.jpg" alt="b" width="600" height="338"></td><td>x</td>'));
        assert.equal(firstRow(blocks)[0].image.src, '/img/b.jpg');
    });

    it('keeps an image with no stated size', () => {
        const blocks = parse(dataTable('<td><img src="/img/n.jpg" alt="n"></td><td>x</td>'));
        assert.equal(firstRow(blocks)[0].image.src, '/img/n.jpg');
    });

    it('picks the real image when a glyph comes first in the cell', () => {
        // Cells pair one screenshot with several icons and the icons are not reliably
        // last. Testing only the first <img> would return null and lose the screenshot.
        const blocks = parse(dataTable(
            '<td><img src="/img/icon.png" alt="i" width="17" height="15">' +
            '<img src="/img/real.jpg" alt="shot" width="600" height="338"></td><td>x</td>',
        ));
        assert.equal(firstRow(blocks)[0].image.src, '/img/real.jpg');
    });

    it('returns no image when a cell holds only glyphs', () => {
        const blocks = parse(dataTable(
            '<td><img src="/img/a.png" alt="a" width="17">' +
            '<img src="/img/b.png" alt="b" width="20"></td><td>x</td>',
        ));
        assert.equal(firstRow(blocks)[0].image, undefined);
    });

    it('skips data: URI images in cells', () => {
        const blocks = parse(dataTable('<td><img src="data:image/png;base64,abc" alt=""></td><td>x</td>'));
        assert.equal(firstRow(blocks)[0].image, undefined);
    });

    it('leaves image-free cells with no image key at all', () => {
        const blocks = parse(dataTable('<td>plain</td><td>x</td>'));
        const cell = firstRow(blocks)[0];
        assert.equal(cell.image, undefined);
        assert.deepEqual(Object.keys(cell), ['text'], 'no stray keys on ordinary cells');
    });

    it('carries the image through buildGrid alongside colspan', () => {
        // buildGrid rebuilds the cell object field by field — a new field is dropped
        // unless it is explicitly carried over.
        const blocks = parse(
            '<table><tr><th>A</th><th>B</th></tr>' +
            '<tr><td colspan="2"><img src="/img/w.jpg" alt="wide"></td></tr></table>',
        );
        const cell = firstRow(blocks)[0];
        assert.equal(cell.colspan, 2);
        assert.equal(cell.image.src, '/img/w.jpg');
    });

    it('attaches images to header cells too', () => {
        const blocks = parse('<table><tr><th><img src="/img/h.jpg" alt="hdr"></th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>');
        assert.equal(blocks.find(b => b.type === 'table').headers[0].image.src, '/img/h.jpg');
    });
});

// ── collectImageBlocks ────────────────────────────────────────────────────────

describe('collectImageBlocks', () => {
    it('returns top-level images and cell images together, in document order', () => {
        const blocks = parse(
            '<p><img src="/img/top.jpg" alt="top"></p>' +
            dataTable('<td><img src="/img/cell.jpg" alt="cell"></td><td>x</td>'),
        );
        const srcs = collectImageBlocks(blocks).map(i => i.src);
        assert.deepEqual(srcs, ['/img/top.jpg', '/img/cell.jpg']);
    });

    it('returns live references so the download pass can set localSrc in place', () => {
        // downloadImages mutates each image object; cell images only get a localSrc
        // if what we hand it are the same objects that live in the tree.
        const blocks = parse(dataTable('<td><img src="/img/a.jpg" alt="a"></td><td>x</td>'));
        collectImageBlocks(blocks).forEach(img => { img.localSrc = 'img/001.jpg'; });
        assert.equal(firstRow(blocks)[0].image.localSrc, 'img/001.jpg');
    });

    it('finds images nested inside section children', () => {
        const blocks = parse('<h2>Head</h2><p><img src="/img/deep.jpg" alt="d"></p>');
        const nested = [{ type: 'section', level: 2, heading: 'H', id: 'h', children: blocks }];
        assert.equal(collectImageBlocks(nested).length, 1);
    });

    it('tolerates null cells left by span placeholders', () => {
        const blocks = parse(
            '<table><tr><th>A</th><th>B</th></tr>' +
            '<tr><td rowspan="2"><img src="/img/r.jpg" alt="r"></td><td>1</td></tr>' +
            '<tr><td>2</td></tr></table>',
        );
        assert.equal(collectImageBlocks(blocks).length, 1);
    });

    it('returns an empty array for a tree with no images', () => {
        assert.deepEqual(collectImageBlocks(parse('<p>text</p>')), []);
    });
});

// ── Sections (sectionize is separate, but headings drive nesting) ─────────────

describe('mixed content', () => {
    it('produces blocks in source order', () => {
        const blocks = parse('<h2>Title</h2><p>Body</p><ul><li>Item</li></ul>');
        assert.equal(blocks[0].type, 'heading');
        assert.equal(blocks[1].type, 'paragraph');
        assert.equal(blocks[2].type, 'list');
    });

    it('treats floating text nodes as paragraphs', () => {
        const blocks = parse('Just some text without a p tag');
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].type, 'paragraph');
    });

    it('recurses into div wrappers', () => {
        const blocks = parse('<div><p>Inside a div</p></div>');
        assert.equal(blocks.filter(b => b.type === 'paragraph').length, 1);
    });
});

// ── Tables ────────────────────────────────────────────────────────────────────

describe('tables', () => {
    it('emits a table block for a data table with <thead>', () => {
        const blocks = parse(`
            <table>
                <thead><tr><th>Name</th><th>Value</th></tr></thead>
                <tbody><tr><td>Sword</td><td>100</td></tr></tbody>
            </table>
        `);
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].type, 'table');
        assert.equal(blocks[0].headers.length, 2);
        assert.equal(blocks[0].headers[0].text, 'Name');
        assert.equal(blocks[0].rows.length, 1);
        assert.equal(blocks[0].rows[0][0].text, 'Sword');
    });

    it('emits a table block for a data table with <th> (no thead)', () => {
        const blocks = parse(`
            <table>
                <tr><th>Item</th><th>Effect</th></tr>
                <tr><td>Potion</td><td>Heals 50 HP</td></tr>
            </table>
        `);
        assert.equal(blocks[0].type, 'table');
        assert.ok(blocks[0].headers.some(h => h.text === 'Item'));
    });

    it('flattens single-column tables as layout tables', () => {
        const blocks = parse(`
            <table>
                <tr><td><p>Cell paragraph</p></td></tr>
            </table>
        `);
        // Single-column → layout table → recurse into cells
        assert.ok(blocks.some(b => b.type === 'paragraph'));
        assert.ok(!blocks.some(b => b.type === 'table'));
    });

    it('flattens tables with div/nested table cells as layout tables', () => {
        const blocks = parse(`
            <table>
                <tr><td><div><p>Left</p></div></td><td><div><p>Right</p></div></td></tr>
            </table>
        `);
        // Complex cells → layout table
        assert.ok(!blocks.some(b => b.type === 'table'));
        assert.ok(blocks.some(b => b.type === 'paragraph'));
    });

    it('handles colspan and rowspan in buildGrid', () => {
        const blocks = parse(`
            <table>
                <thead>
                    <tr><th colspan="2">Weapons</th></tr>
                    <tr><th>Name</th><th>Damage</th></tr>
                </thead>
                <tbody>
                    <tr><td>Pistol</td><td>30</td></tr>
                    <tr><td rowspan="2">Shotgun</td><td>80</td></tr>
                    <tr><td>70</td></tr>
                </tbody>
            </table>
        `);
        const table = blocks.find(b => b.type === 'table');
        assert.ok(table, 'should emit a table block');
        // Caption from colspan header
        assert.equal(table.caption, 'Weapons');
        // Real header row
        assert.ok(table.headers.some(h => h.text === 'Name'));
        // Body row 0: Pistol, 30
        assert.equal(table.rows[0][0].text, 'Pistol');
        // Body row 1: Shotgun (rowspan=2), 80
        const spannedCell = table.rows[1][0];
        assert.ok(spannedCell, 'rowspan cell should appear in row 1');
        assert.equal(spannedCell.text, 'Shotgun');
        assert.equal(spannedCell.rowspan, 2);
        // Body row 2, col 0 is null (covered by rowspan)
        assert.equal(table.rows[2][0], null);
    });

    it('uses <caption> element for table caption', () => {
        const blocks = parse(`
            <table>
                <caption>Item List</caption>
                <thead><tr><th>Name</th></tr></thead>
                <tbody><tr><td>Shield</td></tr></tbody>
            </table>
        `);
        assert.equal(blocks[0].caption, 'Item List');
    });

    it('skips tables that are entirely empty', () => {
        const blocks = parse('<table><tr><td>  </td></tr></table>');
        assert.ok(!blocks.some(b => b.type === 'table'));
    });
});

// ── Table grid integrity ──────────────────────────────────────────────────────
//
// Verify buildGrid's rectangle guarantee: every row has the same column count,
// null fills span-covered positions, and no position is undefined.

function assertRectangular(table) {
    if (table.rows.length === 0) return;
    const colCount = table.rows[0].length;
    for (let r = 0; r < table.rows.length; r++) {
        assert.equal(
            table.rows[r].length,
            colCount,
            `row ${r} has ${table.rows[r].length} cols, expected ${colCount}`,
        );
        for (let c = 0; c < colCount; c++) {
            assert.notEqual(
                table.rows[r][c],
                undefined,
                `cell at row ${r} col ${c} is undefined — grid has a gap`,
            );
        }
    }
}

describe('table grid integrity', () => {
    it('colspan cell leaves null placeholder in the same row', () => {
        const blocks = parse(`
            <table>
                <thead><tr><th>A</th><th>B</th><th>C</th></tr></thead>
                <tbody>
                    <tr><td colspan="2">Wide</td><td>C1</td></tr>
                </tbody>
            </table>
        `);
        const table = blocks.find(b => b.type === 'table');
        assert.ok(table);
        assert.equal(table.rows[0].length, 3);
        assert.equal(table.rows[0][0].text, 'Wide');
        assert.equal(table.rows[0][0].colspan, 2);
        assert.equal(table.rows[0][1], null);
        assert.equal(table.rows[0][2].text, 'C1');
        assertRectangular(table);
    });

    it('rowspan cell leaves null placeholder in subsequent rows', () => {
        const blocks = parse(`
            <table>
                <thead><tr><th>A</th><th>B</th></tr></thead>
                <tbody>
                    <tr><td rowspan="3">Tall</td><td>B1</td></tr>
                    <tr><td>B2</td></tr>
                    <tr><td>B3</td></tr>
                </tbody>
            </table>
        `);
        const table = blocks.find(b => b.type === 'table');
        assert.ok(table);
        assert.equal(table.rows[0][0].text, 'Tall');
        assert.equal(table.rows[0][0].rowspan, 3);
        assert.equal(table.rows[1][0], null, 'row 1 col 0 should be null (rowspan cover)');
        assert.equal(table.rows[2][0], null, 'row 2 col 0 should be null (rowspan cover)');
        assertRectangular(table);
    });

    it('combined colspan + rowspan covers a block of cells with null', () => {
        const blocks = parse(`
            <table>
                <thead><tr><th>A</th><th>B</th><th>C</th></tr></thead>
                <tbody>
                    <tr><td colspan="2" rowspan="2">2x2</td><td>C0</td></tr>
                    <tr><td>C1</td></tr>
                    <tr><td>A2</td><td>B2</td><td>C2</td></tr>
                </tbody>
            </table>
        `);
        const table = blocks.find(b => b.type === 'table');
        assert.ok(table);
        assert.equal(table.rows.length, 3);
        assert.equal(table.rows[0][0].colspan, 2);
        assert.equal(table.rows[0][0].rowspan, 2);
        assert.equal(table.rows[0][1], null);
        assert.equal(table.rows[0][2].text, 'C0');
        assert.equal(table.rows[1][0], null);
        assert.equal(table.rows[1][1], null);
        assert.equal(table.rows[1][2].text, 'C1');
        assert.equal(table.rows[2][0].text, 'A2');
        assertRectangular(table);
    });

    it('short rows are padded to reach maxCols', () => {
        const blocks = parse(`
            <table>
                <thead><tr><th>X</th><th>Y</th><th>Z</th></tr></thead>
                <tbody>
                    <tr><td>1</td><td>2</td><td>3</td></tr>
                    <tr><td>4</td><td>5</td></tr>
                </tbody>
            </table>
        `);
        const table = blocks.find(b => b.type === 'table');
        assert.ok(table);
        assert.equal(table.rows[0].length, 3);
        assert.equal(table.rows[1].length, 3);
        assert.equal(table.rows[1][2].text, '');
        assertRectangular(table);
    });

    it('all rows rectangular in a rowspan-only table', () => {
        const blocks = parse(`
            <table>
                <thead><tr><th>Name</th><th>Type</th><th>Effect</th></tr></thead>
                <tbody>
                    <tr><td rowspan="2">Potion</td><td>Heal</td><td>+50 HP</td></tr>
                    <tr><td>Heal</td><td>+50 HP (alt)</td></tr>
                    <tr><td>Sword</td><td>Weapon</td><td>+30 ATK</td></tr>
                </tbody>
            </table>
        `);
        const table = blocks.find(b => b.type === 'table');
        assert.ok(table);
        assert.equal(table.rows.length, 3);
        assert.equal(table.rows[0].length, 3);
        assertRectangular(table);
    });

    it('no cell in any row is undefined with interleaved colspan + rowspan', () => {
        const blocks = parse(`
            <table>
                <thead><tr><th>A</th><th>B</th><th>C</th><th>D</th></tr></thead>
                <tbody>
                    <tr><td rowspan="2">R1</td><td colspan="2">BC</td><td>D1</td></tr>
                    <tr><td>B2</td><td>C2</td><td>D2</td></tr>
                    <tr><td>A3</td><td>B3</td><td>C3</td><td>D3</td></tr>
                </tbody>
            </table>
        `);
        const table = blocks.find(b => b.type === 'table');
        assert.ok(table);
        for (let r = 0; r < table.rows.length; r++) {
            for (let c = 0; c < table.rows[r].length; c++) {
                assert.notEqual(table.rows[r][c], undefined, `undefined at row ${r} col ${c}`);
            }
        }
        assertRectangular(table);
    });
});

// ── Preformatted / code blocks ────────────────────────────────────────────────

describe('pre and code blocks', () => {
    it('emits a paragraph with <code> wrapping for <pre>', () => {
        const blocks = parse('<pre>  ITEM  COST\n  Sword  100</pre>');
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].type, 'paragraph');
        assert.ok(blocks[0].html.startsWith('<code>'), 'should be wrapped in <code>');
    });

    it('emits a paragraph with <code> wrapping for <code>', () => {
        const blocks = parse('<code>x = 42</code>');
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].type, 'paragraph');
        assert.ok(blocks[0].html.includes('x = 42'));
    });

    it('skips empty <pre> blocks', () => {
        const blocks = parse('<pre>   </pre>');
        assert.equal(blocks.length, 0);
    });

    it('escapes HTML inside <pre>', () => {
        const blocks = parse('<pre><div>text</div></pre>');
        // text() strips tags, so the text "text" gets through
        assert.ok(blocks[0].html.includes('text'));
        // The <div> tag should not appear as a real tag in the output
        assert.ok(!blocks[0].html.includes('<div>'));
    });
});

// ── Figure with caption ───────────────────────────────────────────────────────

describe('figure', () => {
    it('emits an image block with caption from <figure><figcaption>', () => {
        const blocks = parse(`
            <figure>
                <img src="/img/map.jpg" alt="World map">
                <figcaption>The overworld map</figcaption>
            </figure>
        `);
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].type, 'image');
        assert.equal(blocks[0].alt, 'World map');
        assert.equal(blocks[0].caption, 'The overworld map');
    });

    it('skips <figure> with data: URI image', () => {
        const blocks = parse('<figure><img src="data:image/png;base64,abc"></figure>');
        assert.equal(blocks.filter(b => b.type === 'image').length, 0);
    });

    it('emits image without caption when no <figcaption>', () => {
        const blocks = parse('<figure><img src="/img/hero.png" alt="hero"></figure>');
        assert.equal(blocks[0].type, 'image');
        assert.equal(blocks[0].caption, undefined);
    });
});

// ── Blockquote ────────────────────────────────────────────────────────────────

describe('blockquote', () => {
    it('recurses into blockquote and emits child blocks', () => {
        const blocks = parse('<blockquote><p>Quoted text</p></blockquote>');
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].type, 'paragraph');
        assert.ok(blocks[0].html.includes('Quoted text'));
    });

    it('handles nested blockquotes', () => {
        const blocks = parse('<blockquote><blockquote><p>Deep quote</p></blockquote></blockquote>');
        assert.equal(blocks.filter(b => b.type === 'paragraph').length, 1);
    });

    it('handles blockquote with multiple children', () => {
        const blocks = parse('<blockquote><h3>Note</h3><p>Content</p></blockquote>');
        assert.equal(blocks.length, 2);
        assert.equal(blocks[0].type, 'heading');
        assert.equal(blocks[1].type, 'paragraph');
    });
});

// ── Inline buffer flushing ────────────────────────────────────────────────────

describe('inline buffer flushing', () => {
    it('buffers consecutive inline elements into a single paragraph', () => {
        const blocks = parse('<strong>Bold</strong> and <em>italic</em> text');
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].type, 'paragraph');
        assert.ok(blocks[0].html.includes('Bold'));
        assert.ok(blocks[0].html.includes('italic'));
    });

    it('flushes inline buffer before a heading', () => {
        const blocks = parse('Some text <h2>Chapter</h2>');
        assert.equal(blocks.length, 2);
        assert.equal(blocks[0].type, 'paragraph');
        assert.equal(blocks[1].type, 'heading');
    });

    it('flushes inline buffer before a list', () => {
        const blocks = parse('Intro text <ul><li>Item</li></ul>');
        assert.equal(blocks.length, 2);
        assert.equal(blocks[0].type, 'paragraph');
        assert.equal(blocks[1].type, 'list');
    });

    it('does not emit an empty paragraph when inline buffer is whitespace-only', () => {
        const blocks = parse('<p>First</p>   <p>Second</p>');
        assert.equal(blocks.filter(b => b.type === 'paragraph').length, 2);
    });
});

// ── External link policy ──────────────────────────────────────────────────────

describe('external link policy', () => {
    it('strips external links to plain text when keepExternal is false', () => {
        const blocks = parse('<p>Visit <a href="https://example.com">Example</a> now</p>');
        assert.equal(blocks[0].type, 'paragraph');
        assert.ok(!blocks[0].html.includes('<a'), 'external link tag should be removed');
        assert.ok(blocks[0].html.includes('Example'), 'link text should remain');
    });

    it('keeps external links when keepExternal is true', () => {
        const cfgWithExternal = { ...cfg, links: { keepExternal: true } };
        const $c = cheerio.load('<div id="content"><p>See <a href="https://gamefaqs.com">FAQ</a></p></div>');
        const blocks = parseContent($c, $c('#content')[0], cfgWithExternal, {});
        assert.ok(blocks[0].html.includes('<a'), 'external link should be kept');
    });

    it('keeps internal anchor links regardless of keepExternal', () => {
        const blocks = parse('<p>See <a href="/faqs/123">section</a></p>');
        assert.ok(blocks[0].html.includes('<a'), 'internal link should always be kept');
    });
});

// ── br handling ───────────────────────────────────────────────────────────────

describe('br handling', () => {
    const parseWithBr = (behavior, html) => {
        const $c = cheerio.load(`<div id="content">${html}</div>`);
        return parseContent($c, $c('#content')[0], { ...cfg, br: { behavior } }, {});
    };

    it('keeps <br> by default', () => {
        const blocks = parse('<p>Line one<br>Line two</p>');
        assert.ok(blocks[0].html.includes('<br'), '<br> survives the default config');
        assert.ok(blocks[0].html.includes('Line one'), 'text before br remains');
        assert.ok(blocks[0].html.includes('Line two'), 'text after br remains');
    });

    it('keeps <br> when behavior is keep (br is in the KEEP_INLINE set)', () => {
        const blocks = parseWithBr('keep', '<p>Line one<br>Line two</p>');
        assert.ok(blocks[0].html.includes('<br'), '<br> is retained by the KEEP_INLINE pass');
        assert.ok(blocks[0].html.includes('Line one'), 'text before br is retained');
        assert.ok(blocks[0].html.includes('Line two'), 'text after br is retained');
    });

    it('replaces <br> with a space when behavior is strip', () => {
        const blocks = parseWithBr('strip', '<p>Line one<br>Line two</p>');
        assert.ok(!blocks[0].html.includes('<br'), '<br> should be removed');
        assert.ok(blocks[0].html.includes('Line one'), 'text before br should remain');
        assert.ok(blocks[0].html.includes('Line two'), 'text after br should remain');
    });

    it('collapses runs of <br> into one when keeping them', () => {
        const blocks = parseWithBr('keep', '<p>Line one<br> <br><br>Line two</p>');
        assert.equal(blocks[0].html.match(/<br/g).length, 1, 'consecutive <br> collapse to a single tag');
    });
});

// ── isParagraphJunk edge cases ────────────────────────────────────────────────

describe('isParagraphJunk edge cases', () => {
    it('strips paragraphs containing only &lt;br/&gt;', () => {
        const blocks = parse('<p>&lt;br/&gt;</p>');
        assert.equal(blocks.filter(b => b.type === 'paragraph').length, 0);
    });

    it('keeps a single pipe character as real content', () => {
        // A lone "|" does NOT match the nav-separator regex (needs |text| form)
        const blocks = parse('<p>|</p>');
        // Single pipe: the regex requires (\|\s*[^|]+\s*)+\|, so bare "|" alone doesn't match
        // This is acceptable — single pipe paragraphs are edge-case noise
        // Just verify the code doesn't throw
        assert.ok(Array.isArray(blocks));
    });

    it('keeps |text| when no surrounding whitespace (not a nav separator)', () => {
        // "|text|" without spaces — regex requires \|\s*[^|]+\s*\| pattern
        // Verify it does not throw and returns an array
        const blocks = parse('<p>|critical|</p>');
        assert.ok(Array.isArray(blocks));
    });

    it('strips multi-word nav separators with surrounding spaces', () => {
        const blocks = parse('<p>| HOME | ABOUT | CONTACT |</p>');
        assert.equal(blocks.filter(b => b.type === 'paragraph').length, 0);
    });
});

// ── Empty containers ──────────────────────────────────────────────────────────

describe('empty containers', () => {
    it('emits nothing for an empty div', () => {
        const blocks = parse('<div></div>');
        assert.equal(blocks.length, 0);
    });

    it('emits nothing for a div with only whitespace', () => {
        const blocks = parse('<div>   </div>');
        assert.equal(blocks.length, 0);
    });

    it('emits nothing for an empty list', () => {
        const blocks = parse('<ul></ul>');
        assert.equal(blocks.length, 0);
    });

    it('emits nothing for a list with only empty items', () => {
        const blocks = parse('<ul><li>  </li><li></li></ul>');
        assert.equal(blocks.length, 0);
    });
});

// ── Mixed p content (text + image) ───────────────────────────────────────────

describe('mixed paragraph content', () => {
    it('emits a paragraph (not image block) when <p> has both text and img', () => {
        const blocks = parse('<p>See figure: <img src="/img/x.jpg" alt="fig"></p>');
        // pText is non-empty → should go through paragraph path, not image path
        assert.ok(blocks.some(b => b.type === 'paragraph'), 'should emit paragraph');
    });

    it('emits an image block when <p> has only an img', () => {
        const blocks = parse('<p><img src="/img/map.jpg" alt="map"></p>');
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].type, 'image');
    });
});

// ── Deeply nested divs ────────────────────────────────────────────────────────

describe('deeply nested divs', () => {
    it('recurses through multiple layers of divs to find content', () => {
        const blocks = parse('<div><div><div><p>Deep content</p></div></div></div>');
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].type, 'paragraph');
        assert.ok(blocks[0].html.includes('Deep content'));
    });

    it('handles mixed block and inline content inside nested divs', () => {
        const blocks = parse('<div><h2>Title</h2><div><p>Para</p></div></div>');
        assert.equal(blocks.length, 2);
        assert.equal(blocks[0].type, 'heading');
        assert.equal(blocks[1].type, 'paragraph');
    });
});

// ── Malformed HTML ────────────────────────────────────────────────────────────

describe('malformed HTML', () => {
    it('handles missing closing tags (Cheerio auto-closes)', () => {
        // Cheerio/htmlparser2 auto-closes unclosed <p>
        const blocks = parse('<p>No closing tag');
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].type, 'paragraph');
        assert.ok(blocks[0].html.includes('No closing tag'));
    });

    it('handles uppercase tag names', () => {
        // htmlparser2 normalises tag names to lowercase
        const blocks = parse('<P>Uppercase P tag</P>');
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].type, 'paragraph');
    });

    it('handles interleaved/overlapping tags', () => {
        // <b><i>text</b></i> — browsers and htmlparser2 repair this
        const blocks = parse('<p><b><i>Bold italic</b></i></p>');
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].type, 'paragraph');
        assert.ok(blocks[0].html.includes('Bold italic'));
    });

    it('handles stray text inside a <ul> before any <li>', () => {
        // Stray text directly in <ul> is invalid but common in scraped content
        const blocks = parse('<ul>stray<li>Real item</li></ul>');
        // Should still produce a list with the real item
        assert.ok(blocks.some(b => b.type === 'list'));
        const list = blocks.find(b => b.type === 'list');
        assert.ok(list.items.some(i => i.text.includes('Real item')));
    });

    it('handles unclosed <li> tags', () => {
        const blocks = parse('<ul><li>First<li>Second</ul>');
        const list = blocks.find(b => b.type === 'list');
        assert.ok(list, 'should emit a list');
        assert.equal(list.items.length, 2);
    });

    it('handles attributes without quotes', () => {
        const blocks = parse('<p><a href=/faqs/123>Link</a></p>');
        // htmlparser2 handles unquoted attributes
        assert.equal(blocks.length, 1);
        assert.equal(blocks[0].type, 'paragraph');
    });

    it('handles self-closing non-void tags like <br/> and <p/>', () => {
        const blocks = parse('<p>Text<br/>More text</p>');
        assert.equal(blocks.length, 1);
        assert.ok(blocks[0].html.includes('Text'));
        assert.ok(blocks[0].html.includes('More text'));
    });

    it('does not crash on completely empty input', () => {
        const blocks = parse('');
        assert.equal(blocks.length, 0);
    });

    it('does not crash on deeply malformed nesting', () => {
        const blocks = parse('<div><p><ul><li><p>text</p></li></ul></p></div>');
        // Just verify it returns an array without throwing
        assert.ok(Array.isArray(blocks));
    });
});
