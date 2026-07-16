// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/guides/content-file.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified).
/**
 * File-based content validator.
 *
 * Validates the structural integrity of a parsed content.json file — the output
 * written by parse-guide.js for each guide section.
 *
 * Usage:
 *   CONTENT_FILE=path/to/content.json node --test src/tests/guides/content-file.test.js
 *
 * Example (against NAS):
 *   CONTENT_FILE="\\\\192.168.86.74\\app-data\\relay\\guides\\251150\\gamefaqs\\82117\\chapter-1-day-1\\content.json" ^
 *     node --test src/tests/guides/content-file.test.js
 *
 * If CONTENT_FILE is not set, all tests are skipped with a helpful message.
 * Add this to CI by setting CONTENT_FILE to a fixture or a checked-in sample.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const filePath = process.env.CONTENT_FILE ?? null;

// ── Structural assertions (reusable by any test) ──────────────────────────────

export function assertRectangular(table, loc = 'table') {
    if (table.rows.length === 0) return;
    const colCount = table.rows[0].length;
    for (let r = 0; r < table.rows.length; r++) {
        assert.equal(
            table.rows[r].length,
            colCount,
            `${loc}: row ${r} has ${table.rows[r].length} cols, expected ${colCount}`,
        );
        for (let c = 0; c < colCount; c++) {
            assert.notEqual(
                table.rows[r][c],
                undefined,
                `${loc}: cell at row ${r} col ${c} is undefined (grid gap)`,
            );
        }
    }
}

export function assertCell(cell, loc) {
    if (cell === null) return; // null = span-covered — valid
    assert.ok(
        cell !== undefined,
        `${loc} is undefined — every position must be a cell object or null`,
    );
    assert.ok(typeof cell.text === 'string', `${loc}.text must be a string`);
    if (cell.colspan !== undefined) {
        assert.ok(Number.isInteger(cell.colspan) && cell.colspan >= 1, `${loc}.colspan must be a positive integer`);
    }
    if (cell.rowspan !== undefined) {
        assert.ok(Number.isInteger(cell.rowspan) && cell.rowspan >= 1, `${loc}.rowspan must be a positive integer`);
    }
}

export function assertTable(table, loc) {
    assert.ok(Array.isArray(table.headers), `${loc}.headers must be an array`);
    assert.ok(Array.isArray(table.rows),    `${loc}.rows must be an array`);

    // Header cells
    for (let c = 0; c < table.headers.length; c++) {
        assertCell(table.headers[c], `${loc}.headers[${c}]`);
    }

    // Body cells + rectangle invariant
    for (let r = 0; r < table.rows.length; r++) {
        assert.ok(Array.isArray(table.rows[r]), `${loc}.rows[${r}] must be an array`);
        for (let c = 0; c < table.rows[r].length; c++) {
            assertCell(table.rows[r][c], `${loc}.rows[${r}][${c}]`);
        }
    }

    assertRectangular(table, loc);
}

export function assertListItems(items, loc) {
    assert.ok(Array.isArray(items), `${loc} must be an array`);
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const iloc = `${loc}[${i}]`;
        assert.ok(item !== null && item !== undefined, `${iloc} must not be null/undefined`);
        assert.ok(typeof item.text === 'string', `${iloc}.text must be a string`);
        if (item.children) {
            assert.ok(typeof item.children.ordered === 'boolean', `${iloc}.children.ordered must be boolean`);
            assertListItems(item.children.items, `${iloc}.children.items`);
        }
    }
}

export function assertBlock(block, loc) {
    assert.ok(block !== null && block !== undefined, `${loc} must not be null/undefined`);
    assert.ok(typeof block.type === 'string', `${loc}.type must be a string`);

    switch (block.type) {
        case 'section':
            assert.ok(
                typeof block.heading === 'string' && block.heading.trim().length > 0,
                `${loc}.heading must be a non-empty string`,
            );
            assert.ok(
                Number.isInteger(block.level) && block.level >= 1 && block.level <= 6,
                `${loc}.level must be 1–6`,
            );
            assert.ok(typeof block.id === 'string', `${loc}.id must be a string`);
            assertBlocks(block.children, `${loc}.children`);
            break;

        case 'paragraph':
            assert.ok(
                typeof block.html === 'string' && block.html.trim().length > 0,
                `${loc}.html must be a non-empty string`,
            );
            break;

        case 'heading':
            assert.ok(
                typeof block.text === 'string' && block.text.trim().length > 0,
                `${loc}.text must be a non-empty string`,
            );
            assert.ok(
                Number.isInteger(block.level) && block.level >= 1 && block.level <= 6,
                `${loc}.level must be 1–6`,
            );
            break;

        case 'list':
            assert.ok(typeof block.ordered === 'boolean', `${loc}.ordered must be boolean`);
            assertListItems(block.items, `${loc}.items`);
            break;

        case 'image':
            assert.ok(typeof block.alt === 'string', `${loc}.alt must be a string`);
            // After parsing, localSrc holds the downloaded path (src is removed)
            assert.ok(
                block.localSrc !== undefined || block.src !== undefined,
                `${loc} must have localSrc or src`,
            );
            break;

        case 'table':
            assertTable(block, loc);
            break;

        default:
            assert.fail(`${loc} has unrecognised type: "${block.type}"`);
    }
}

export function assertBlocks(blocks, loc = 'root') {
    assert.ok(Array.isArray(blocks), `${loc} must be an array`);
    for (let i = 0; i < blocks.length; i++) {
        assertBlock(blocks[i], `${loc}[${i}]`);
    }
}

// ── File-based test suite ─────────────────────────────────────────────────────

if (!filePath) {
    describe('content-file validator', () => {
        it.skip('CONTENT_FILE not set — set it to a content.json path to run validation', () => {});
    });
} else {
    let blocks;
    let loadError;

    try {
        const raw = readFileSync(filePath, 'utf8');
        blocks = JSON.parse(raw);
    } catch (err) {
        loadError = err;
    }

    describe(`content-file: ${filePath}`, () => {
        it('file loads and parses as JSON', () => {
            if (loadError) assert.fail(`Failed to load file: ${loadError.message}`);
            assert.ok(Array.isArray(blocks), 'Top-level content.json must be an array');
        });

        it('top-level array is non-empty', () => {
            if (loadError) return;
            assert.ok(blocks.length > 0, 'content.json should have at least one block');
        });

        it('every block has a recognised type', () => {
            if (loadError) return;
            const VALID_TYPES = new Set(['section', 'paragraph', 'heading', 'list', 'image', 'table']);
            const invalid = [];
            function check(bs, loc) {
                for (let i = 0; i < bs.length; i++) {
                    const b = bs[i];
                    if (!VALID_TYPES.has(b?.type)) invalid.push(`${loc}[${i}].type = "${b?.type}"`);
                    if (b?.type === 'section') check(b.children ?? [], `${loc}[${i}].children`);
                }
            }
            check(blocks, 'root');
            assert.equal(invalid.length, 0, `Invalid types:\n  ${invalid.join('\n  ')}`);
        });

        it('every paragraph has non-empty html', () => {
            if (loadError) return;
            const bad = [];
            function check(bs, loc) {
                for (let i = 0; i < bs.length; i++) {
                    const b = bs[i];
                    if (b?.type === 'paragraph' && !b.html?.trim()) bad.push(`${loc}[${i}]`);
                    if (b?.type === 'section') check(b.children ?? [], `${loc}[${i}].children`);
                }
            }
            check(blocks, 'root');
            assert.equal(bad.length, 0, `Paragraphs with empty html:\n  ${bad.join('\n  ')}`);
        });

        it('every heading has non-empty text and level 1–6', () => {
            if (loadError) return;
            const bad = [];
            function check(bs, loc) {
                for (let i = 0; i < bs.length; i++) {
                    const b = bs[i];
                    if (b?.type === 'heading') {
                        if (!b.text?.trim() || b.level < 1 || b.level > 6) bad.push(`${loc}[${i}]`);
                    }
                    if (b?.type === 'section') check(b.children ?? [], `${loc}[${i}].children`);
                }
            }
            check(blocks, 'root');
            assert.equal(bad.length, 0, `Bad headings:\n  ${bad.join('\n  ')}`);
        });

        it('every section has non-empty heading, valid level, and id', () => {
            if (loadError) return;
            const bad = [];
            function check(bs, loc) {
                for (let i = 0; i < bs.length; i++) {
                    const b = bs[i];
                    if (b?.type === 'section') {
                        if (!b.heading?.trim() || b.level < 1 || b.level > 6 || typeof b.id !== 'string') {
                            bad.push(`${loc}[${i}]`);
                        }
                        check(b.children ?? [], `${loc}[${i}].children`);
                    }
                }
            }
            check(blocks, 'root');
            assert.equal(bad.length, 0, `Bad sections:\n  ${bad.join('\n  ')}`);
        });

        it('every list has items array and each item has a text string', () => {
            if (loadError) return;
            const bad = [];
            function checkItems(items, loc) {
                if (!Array.isArray(items)) { bad.push(`${loc} is not an array`); return; }
                for (let i = 0; i < items.length; i++) {
                    if (typeof items[i]?.text !== 'string') bad.push(`${loc}[${i}].text`);
                    if (items[i]?.children) checkItems(items[i].children.items, `${loc}[${i}].children.items`);
                }
            }
            function check(bs, loc) {
                for (let i = 0; i < bs.length; i++) {
                    const b = bs[i];
                    if (b?.type === 'list') checkItems(b.items, `${loc}[${i}].items`);
                    if (b?.type === 'section') check(b.children ?? [], `${loc}[${i}].children`);
                }
            }
            check(blocks, 'root');
            assert.equal(bad.length, 0, `Bad list items:\n  ${bad.join('\n  ')}`);
        });

        it('all tables are rectangular — no row has a different column count', () => {
            if (loadError) return;
            const errors = [];
            function check(bs, loc) {
                for (let i = 0; i < bs.length; i++) {
                    const b = bs[i];
                    if (b?.type === 'table') {
                        try {
                            assertRectangular(b, `${loc}[${i}]`);
                        } catch (err) {
                            errors.push(err.message);
                        }
                    }
                    if (b?.type === 'section') check(b.children ?? [], `${loc}[${i}].children`);
                }
            }
            check(blocks, 'root');
            assert.equal(errors.length, 0, `Table rectangle violations:\n  ${errors.join('\n  ')}`);
        });

        it('all table cells are non-undefined (null is allowed for span covers)', () => {
            if (loadError) return;
            const errors = [];
            function check(bs, loc) {
                for (let i = 0; i < bs.length; i++) {
                    const b = bs[i];
                    if (b?.type === 'table') {
                        for (let r = 0; r < b.rows.length; r++) {
                            for (let c = 0; c < b.rows[r]?.length; c++) {
                                if (b.rows[r][c] === undefined) {
                                    errors.push(`${loc}[${i}].rows[${r}][${c}] is undefined`);
                                }
                            }
                        }
                    }
                    if (b?.type === 'section') check(b.children ?? [], `${loc}[${i}].children`);
                }
            }
            check(blocks, 'root');
            assert.equal(errors.length, 0, `Undefined cells:\n  ${errors.join('\n  ')}`);
        });

        it('full structural validation — every block at every depth passes assertBlock', () => {
            if (loadError) return;
            assertBlocks(blocks);
        });
    });
}
