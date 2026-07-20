// Ported verbatim from relay-server src/services/guides/parser/content-parser.js (docs/relay-fold-in.md §6 — byte-identical logic).
/**
 * Content parser — walks a cleaned Cheerio DOM and emits ContentBlock[].
 *
 * ContentBlock types:
 *   heading   { type, level, text }
 *   paragraph { type, html }          — inline-safe HTML only
 *   list      { type, ordered, items } — items are plain text strings
 *   image     { type, src, alt, caption? }
 *   table     { type, caption?, headers, rows }
 *
 * Floating text (text nodes not inside a <p>) is treated as paragraphs.
 * Consecutive inline elements are buffered and flushed as a single paragraph.
 * Layout tables (no <th>, only one column, or cells containing block elements)
 * are flattened — their cell contents are recursed into instead.
 */

import { cleanInlineHtml } from './html-cleaner.js';

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const LIST_TAGS    = new Set(['ul', 'ol']);
const BLOCK_TAGS   = new Set([
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'table', 'figure', 'figcaption',
    'blockquote', 'pre', 'hr', 'div', 'section', 'article',
]);

// ── Table heuristics ──────────────────────────────────────────────────────────

function isDataTable($, el) {
    const $el = $(el);

    // Explicit <thead> is the clearest signal — data table regardless of th/td usage
    if ($el.find('thead').length > 0) return true;

    // Has <th> anywhere → data table
    if ($el.find('th').length > 0) return true;

    // Single-column tables are layout tables
    const firstRow = $el.find('tr').first();
    const colCount  = firstRow.find('td, th').length;
    if (colCount <= 1) return false;

    // Cells containing nested tables or divs → layout table
    let hasComplexCell = false;
    $el.find('td').each((_, td) => {
        if ($(td).find('div, table').length > 0) {
            hasComplexCell = true;
            return false;
        }
    });

    return !hasComplexCell;
}

// Images this small are inline glyphs — item/button icons sitting next to a cell's
// text, not cell content. Neoseeker's are 12-24px; real screenshots are 300px+.
const GLYPH_MAX_PX = 48;

// Build an ImageBlock-shaped object from the first <img> in a cell, or null.
// Deliberately the same shape as a top-level image block ({type,src,alt}) so the
// download pass can mutate it in place through the same code path — see
// collectImageBlocks below.
function cellImage($, el, cfg) {
    // Take the first NON-glyph image, not the first image. Cells routinely pair one
    // screenshot with several icons (Neoseeker has cells holding 7 images, 6 of them
    // glyphs), and the icons do not reliably come last — testing only the first image
    // would return null and lose the screenshot sitting behind it.
    //
    // Glyphs are judged only when the markup states a size; with no width/height we
    // assume real content, which still beats the old behaviour of dropping everything.
    const $img = $(el).find('img').filter((_, i) => {
        const w = parseInt($(i).attr('width') ?? '', 10);
        const h = parseInt($(i).attr('height') ?? '', 10);
        return !((w > 0 && w <= GLYPH_MAX_PX) || (h > 0 && h <= GLYPH_MAX_PX));
    }).first();
    if (!$img.length) return null;

    const rawSrc = $img.attr('data-src') || $img.attr('src') || '';
    const src    = cfg.imageUrlTransform ? cfg.imageUrlTransform(rawSrc) : rawSrc;
    if (!src || src.startsWith('data:')) return null;

    return { type: 'image', src, alt: $img.attr('alt') || '' };
}

// Extract content from a single table cell.
// Returns { text, html?, image? } — html is set when the cell contains links, so
// the caller can render rich content instead of falling back to plain text.
// For cells with multiple <p> children, joins them with " / ".
// For image-only cells, text falls back to alt text.
//
// `image` is attached whenever the cell holds an <img>. Table cells are modelled as
// text, so before this the image was dropped and only its alt text survived — on
// image-heavy wiki guides that silently lost a third of the page's images.
// It is purely additive: `text`/`html` are byte-identical to what they were.
function cellContent($, el, cfg) {
    const $el   = $(el);
    const text  = $el.text().trim();
    const image = cellImage($, el, cfg);
    const withImage = (cell) => (image ? { ...cell, image } : cell);

    if (!text && $el.find('img').length > 0) {
        return withImage({ text: $el.find('img').first().attr('alt') ?? '' });
    }

    const directParas = $el.find('> p');
    if (directParas.length > 1) {
        const parts = directParas.map((_, p) => {
            const inner = $(p).html() ?? '';
            return cleanInlineHtml(inner, cfg).trim();
        }).get().filter(Boolean);
        const plainText = parts.map(h => h.replace(/<[^>]+>/g, '')).join(' / ');
        return withImage({ text: plainText, html: parts.join('<br>') });
    }

    // Preserve HTML when the cell contains inline elements worth rendering
    if ($el.find('a[href], br').length > 0) {
        const html = cleanInlineHtml($el.html() ?? '', cfg).trim();
        if (html) return withImage({ text, html });
    }

    return withImage({ text });
}

/**
 * Build a rectangular grid from an array of <tr> DOM elements.
 *
 * Tracks colspan and rowspan so every row ends up the same width.
 * Returns an array of rows, where each cell is either:
 *   {text, colspan?, rowspan?}  — a real cell starting at this position
 *   null                        — position covered by a span from another cell
 *
 * Short rows are padded with {text:''} to reach maxCols.
 */
function buildGrid($, trElements, cfg) {
    const occupancy = {}; // "r,c" → true (position already claimed by a span)
    const grid = [];

    for (let r = 0; r < trElements.length; r++) {
        if (!grid[r]) grid[r] = [];
        let c = 0;

        $(trElements[r]).find('> th, > td').each((_, cell) => {
            // Advance past positions already claimed by rowspans from rows above
            while (occupancy[`${r},${c}`]) c++;

            const $cell   = $(cell);
            const colspan = Math.max(1, parseInt($cell.attr('colspan') ?? '1', 10));
            const rowspan = Math.max(1, parseInt($cell.attr('rowspan') ?? '1', 10));
            const { text, html, image } = cellContent($, cell, cfg);

            const obj = { text };
            if (html) obj.html = html;
            if (image) obj.image = image;
            if (colspan > 1) obj.colspan = colspan;
            if (rowspan > 1) obj.rowspan = rowspan;
            grid[r][c] = obj;

            // Mark all positions covered by this cell's span as occupied
            for (let dr = 0; dr < rowspan; dr++) {
                for (let dc = 0; dc < colspan; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    occupancy[`${r + dr},${c + dc}`] = true;
                    if (!grid[r + dr]) grid[r + dr] = [];
                    grid[r + dr][c + dc] = null; // null = covered, renderer skips it
                }
            }

            c += colspan;
        });
    }

    // Determine the maximum column count across all rows
    let maxCols = 0;
    for (const row of grid) {
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
            const cell = row[c];
            if (cell !== undefined && cell !== null) {
                maxCols = Math.max(maxCols, c + (cell.colspan ?? 1));
            } else if (cell === null) {
                maxCols = Math.max(maxCols, c + 1);
            }
        }
    }

    // Pad and fill any gaps so every row is exactly maxCols wide
    for (const row of grid) {
        if (!row) continue;
        for (let c = 0; c < maxCols; c++) {
            if (row[c] === undefined) row[c] = { text: '' };
        }
    }

    return grid;
}

// Determine whether a <tr>'s sole cell is a spanning title/section row.
// Returns the text if so, null otherwise.
function spanningSingleCell($, tr) {
    const cells = $(tr).find('> th, > td');
    if (cells.length !== 1) return null;
    const colspan = parseInt(cells.first().attr('colspan') ?? '1', 10);
    return colspan > 1 ? cells.first() : null;
}

// parseDataTable returns ContentBlock[] — the table block plus any rich-content
// blocks extracted from colspan body rows (e.g. quest descriptions, notes).
function parseDataTable($, el, cfg, ctx) {
    const $el = $(el);
    let caption = $el.find('> caption').first().text().trim() || undefined;
    let headers = [];
    const afterBlocks = [];

    // ── Headers from <thead> ─────────────────────────────────────────────────
    const theadRows   = $el.find('thead tr');
    const hasExplicitThead = theadRows.length > 0;

    if (hasExplicitThead) {
        const firstCells = theadRows.first().find('th, td');
        const colspan    = parseInt(firstCells.first().attr('colspan') ?? '1', 10);

        if (firstCells.length === 1 && colspan > 1) {
            caption = caption ?? firstCells.first().text().trim();
            if (theadRows.length > 1) {
                headers = buildGrid($, theadRows.slice(1).toArray(), cfg)[0] ?? [];
            }
        } else {
            headers = buildGrid($, [theadRows.first()[0]], cfg)[0] ?? [];
        }
    }

    // ── Collect body rows ────────────────────────────────────────────────────
    const allBodyRows = ($el.find('tbody tr').length > 0
        ? $el.find('tbody tr')
        : $el.find('tr').filter((_, tr) => $(tr).closest('thead').length === 0)
    ).toArray();

    // ── Fall back: row-header vs column-header detection ─────────────────────
    if (!hasExplicitThead && headers.length === 0 && allBodyRows.length > 0) {
        const rowsWithTh = allBodyRows.filter(tr => $(tr).find('> th').length > 0).length;
        const isRowHeaders = rowsWithTh > 1 && rowsWithTh >= allBodyRows.length / 2;

        if (!isRowHeaders) {
            const firstRow = allBodyRows[0];
            if ($(firstRow).find('th').length > 0) {
                headers = buildGrid($, [firstRow], cfg)[0] ?? [];
            }
        }
    }

    // ── Separate body rows: grid rows vs rich-content/title rows ─────────────
    const gridTrElements = [];

    for (let i = 0; i < allBodyRows.length; i++) {
        const tr         = allBodyRows[i];
        const wideCell   = spanningSingleCell($, tr);

        if (wideCell) {
            const hasRichContent = wideCell.find('ul, ol, table').length > 0 ||
                                   wideCell.find('p').length > 1;

            if (hasRichContent) {
                // Rich content cell — emit as blocks after the table
                afterBlocks.push(...parseContent($, wideCell[0], cfg, ctx));
            } else if (i === 0 && !caption) {
                // First body row is a title (e.g. "Pine Plant+") → caption
                caption = wideCell.text().trim();
            } else {
                // Section sub-header inside the table (e.g. "Notes") — keep in grid
                gridTrElements.push(tr);
            }
        } else {
            gridTrElements.push(tr);
        }
    }

    // ── Build the normalised rectangular grid ────────────────────────────────
    let rows = buildGrid($, gridTrElements, cfg);

    // Remove first data row if it duplicates column headers
    if (headers.length > 0 && rows.length > 0) {
        const firstTexts  = rows[0].map(c => c?.text ?? '');
        const headerTexts = headers.map(h => h?.text ?? '');
        if (JSON.stringify(firstTexts) === JSON.stringify(headerTexts)) {
            rows = rows.slice(1);
        }
    }

    // Skip rows that are entirely empty
    rows = rows.filter(row => row.some(c => c?.text));

    const result = [];
    if (rows.length > 0 || headers.length > 0) {
        result.push({ type: 'table', caption: caption || undefined, headers, rows });
    }
    result.push(...afterBlocks);
    return result;
}

// ── List parsing ─────────────────────────────────────────────────────────────

// Recursively parse a <ul>/<ol> into ListItem[].
// Each item: { text, children?: { ordered, items: ListItem[] } }
// "text" is only the direct text of the <li>, not its nested list children.
function parseListItems($, listEl, cfg = {}) {
    const items = [];
    $(listEl).find('> li').each((_, li) => {
        const $li = $(li);

        // Collect only direct text nodes + inline elements (skip nested ul/ol)
        // Preserve HTML so that <a> links and inline formatting are kept.
        let html = '';
        $li.contents().each((_, node) => {
            if (node.type === 'text') {
                html += node.data ?? '';
            } else if (node.type === 'tag') {
                const t = node.tagName?.toLowerCase();
                if (t && !LIST_TAGS.has(t)) {
                    html += $.html(node);
                }
            }
        });
        const text = cleanInlineHtml(html.trim(), cfg);

        // Recurse into nested lists
        const nested = $li.find('> ul, > ol');
        let children;
        if (nested.length) {
            const nestedEl  = nested.first()[0];
            const nestedTag = nestedEl.tagName?.toLowerCase();
            const nestedItems = parseListItems($, nestedEl, cfg);
            if (nestedItems.length) {
                children = { ordered: nestedTag === 'ol', items: nestedItems };
            }
        }

        if (text || children) {
            items.push(children ? { text, children } : { text });
        }
    });
    return items;
}

// ── Paragraph junk filter ─────────────────────────────────────────────────────

// Returns true if a paragraph's HTML should be discarded entirely.
function isParagraphJunk(html) {
    // Strip real HTML tags to get plain text
    const text = html.replace(/<[^>]+>/g, '').trim();
    // Nothing left after stripping tags
    if (!text) return true;
    // Only escaped HTML entities remain (e.g. &lt;div class="simg-pop-btn"&gt;)
    if (!text.replace(/&lt;[^&]*&gt;/g, '').trim()) return true;
    // GameFAQs nav separator: | LABEL | or | LABEL | LABEL |
    if (/^\s*(\|\s*[^|]+\s*)+\|\s*$/.test(text)) return true;
    return false;
}

// ── Inline buffer helpers ─────────────────────────────────────────────────────

function flushInlineBuffer(buffer, blocks, cfg) {
    const html = buffer.join('').trim();
    if (html) {
        const cleaned = cleanInlineHtml(html, cfg);
        if (!isParagraphJunk(cleaned)) {
            blocks.push({ type: 'paragraph', html: cleaned });
        }
    }
    buffer.length = 0;
}

// ── Main walker ───────────────────────────────────────────────────────────────

/**
 * Walk a Cheerio element's children and emit ContentBlocks.
 *
 * @param {CheerioAPI}      $
 * @param {CheerioElement}  el   - The container element to walk
 * @param {object}          cfg  - Config from guides/config.js
 * @param {object}          ctx  - { sectionSlug, guideId, source, imageIndex }
 * @returns {ContentBlock[]}
 */
export function parseContent($, el, cfg, ctx) {
    const blocks = [];
    const inlineBuffer = [];

    $(el).contents().each((_, node) => {
        if (node.type === 'text') {
            const text = node.data ?? '';
            if (text.trim()) {
                inlineBuffer.push(escapeTextForHtml(text));
            } else if (inlineBuffer.length > 0) {
                // Preserve a single space between inline items
                inlineBuffer.push(' ');
            }
            return;
        }

        if (node.type !== 'tag') return;

        const tag = node.tagName?.toLowerCase();
        if (!tag) return;

        // ── Heading ──────────────────────────────────────────────────────────
        if (HEADING_TAGS.has(tag)) {
            flushInlineBuffer(inlineBuffer, blocks, cfg);
            const text = $(node).text().trim();
            if (text) {
                blocks.push({ type: 'heading', level: parseInt(tag[1], 10), text });
            }
            return;
        }

        // ── Paragraph ────────────────────────────────────────────────────────
        if (tag === 'p') {
            flushInlineBuffer(inlineBuffer, blocks, cfg);

            // If the <p> contains only image(s) with no text, emit image blocks
            const $p = $(node);
            const pText = $p.text().trim();
            const pImgs = $p.find('img');
            if (pImgs.length > 0 && !pText) {
                pImgs.each((_, img) => {
                    const rawSrc = $(img).attr('data-src') || $(img).attr('src') || '';
                    const src    = cfg.imageUrlTransform ? cfg.imageUrlTransform(rawSrc) : rawSrc;
                    const alt    = $(img).attr('alt') || '';
                    if (src && !src.startsWith('data:')) {
                        blocks.push({ type: 'image', src, alt });
                    }
                });
                return;
            }

            const inner = $p.html() ?? '';
            if (inner.trim()) {
                const cleaned = cleanInlineHtml(inner, cfg);
                if (!isParagraphJunk(cleaned)) {
                    blocks.push({ type: 'paragraph', html: cleaned });
                }
            }
            return;
        }

        // ── List ─────────────────────────────────────────────────────────────
        if (LIST_TAGS.has(tag)) {
            flushInlineBuffer(inlineBuffer, blocks, cfg);
            const items = parseListItems($, node, cfg);
            if (items.length > 0) {
                blocks.push({ type: 'list', ordered: tag === 'ol', items });
            }
            return;
        }

        // ── Image ────────────────────────────────────────────────────────────
        if (tag === 'img') {
            flushInlineBuffer(inlineBuffer, blocks, cfg);
            const rawSrc = $(node).attr('data-src') || $(node).attr('src') || '';
            const src    = cfg.imageUrlTransform ? cfg.imageUrlTransform(rawSrc) : rawSrc;
            const alt    = $(node).attr('alt') || '';
            if (src && !src.startsWith('data:')) {
                blocks.push({ type: 'image', src, alt });
            }
            return;
        }

        // ── Figure (image + caption) ─────────────────────────────────────────
        if (tag === 'figure') {
            flushInlineBuffer(inlineBuffer, blocks, cfg);
            const img     = $(node).find('img').first();
            const caption = $(node).find('figcaption').first().text().trim() || undefined;
            const rawSrc  = img.attr('data-src') || img.attr('src') || '';
            const src     = cfg.imageUrlTransform ? cfg.imageUrlTransform(rawSrc) : rawSrc;
            const alt     = img.attr('alt') || '';
            if (src && !src.startsWith('data:')) {
                blocks.push({ type: 'image', src, alt, caption });
            }
            return;
        }

        // ── Table ────────────────────────────────────────────────────────────
        if (tag === 'table') {
            flushInlineBuffer(inlineBuffer, blocks, cfg);
            if (isDataTable($, node)) {
                blocks.push(...parseDataTable($, node, cfg, ctx));
            } else {
                // Layout table — recurse into each cell
                $(node).find('td').each((_, td) => {
                    blocks.push(...parseContent($, td, cfg, ctx));
                });
            }
            return;
        }

        // ── Horizontal rule ──────────────────────────────────────────────────
        if (tag === 'hr') {
            flushInlineBuffer(inlineBuffer, blocks, cfg);
            // Skip — hr is typically decorative in guides
            return;
        }

        // ── Preformatted / code ──────────────────────────────────────────────
        if (tag === 'pre' || tag === 'code') {
            flushInlineBuffer(inlineBuffer, blocks, cfg);
            const text = $(node).text();
            if (text.trim()) {
                // Treat large pre blocks as paragraphs (ASCII art / text guides)
                blocks.push({ type: 'paragraph', html: `<code>${escapeTextForHtml(text)}</code>` });
            }
            return;
        }

        // ── Blockquote ───────────────────────────────────────────────────────
        if (tag === 'blockquote') {
            flushInlineBuffer(inlineBuffer, blocks, cfg);
            blocks.push(...parseContent($, node, cfg, ctx));
            return;
        }

        // ── Inline elements (buffer for paragraph) ───────────────────────────
        if (!BLOCK_TAGS.has(tag)) {
            inlineBuffer.push($.html(node));
            return;
        }

        // ── Generic block wrappers (div, section, article, etc.) ─────────────
        // Recurse into them — they're structural, not semantic
        flushInlineBuffer(inlineBuffer, blocks, cfg);
        blocks.push(...parseContent($, node, cfg, ctx));
    });

    flushInlineBuffer(inlineBuffer, blocks, cfg);
    return blocks;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Collect every image object in a block tree, including those nested in table cells.
 *
 * Returns live references, not copies, so the download pass can set `localSrc` on
 * each one in place — cell images ride the exact same path as top-level image blocks.
 * Callers previously used `blocks.filter(b => b.type === 'image')`, which saw only
 * top-level images and silently skipped anything inside a table.
 *
 * @param {ContentBlock[]} blocks
 * @returns {object[]} image objects ({type:'image', src, alt}), in document order
 */
export function collectImageBlocks(blocks) {
    const out = [];

    const walk = (bs) => {
        for (const b of bs ?? []) {
            if (!b) continue;
            if (b.type === 'image') out.push(b);
            if (b.type === 'table') {
                const rows = [...(b.headers ? [b.headers] : []), ...(b.rows ?? [])];
                for (const row of rows) {
                    for (const cell of row ?? []) {
                        if (cell?.image) out.push(cell.image);
                    }
                }
            }
            if (Array.isArray(b.children)) walk(b.children);
        }
    };

    walk(blocks);
    return out;
}

function escapeTextForHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
