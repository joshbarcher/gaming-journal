/**
 * jump-links — collapse in-page "jump link" navigation lists into a single block.
 *
 * Some sources render a page's table of contents as a bullet list of pure
 * fragment anchors. TheGamer emits one <ul> per link, so a six-entry "Jump Links"
 * TOC arrives here as six consecutive single-item lists.
 *
 * This pass merges consecutive jump-link lists into one and tags it
 * `variant: 'jumplinks'` so renderers can lay it out horizontally instead of as
 * a tall bullet column. The block stays `type: 'list'` with the same item shape,
 * so consumers that don't know about the variant (fulltext, in-page search,
 * preview) keep working unchanged.
 *
 * Opt-in per source: an adapter enables it by exporting `jumpLinks = true`. Opt-in
 * rather than automatic because the shape false-positives easily — fandom's "References"
 * lists are all `href="#"`, and gamerguides/neoseeker use bare anchor lists for
 * cross-page links. Enabled for thegamer only.
 *
 * TODO: game8 is the obvious next candidate (~2,500 such lists, 93% of anchors already
 * resolve). It needs no merging — it emits one <ul> with every entry — so enabling it is
 * a one-line adapter change plus a reparse. Check the anchor-resolution rate first.
 *
 * A run of one link stays an ordinary list — a lone anchor is prose, not a TOC.
 *
 * Must run on the flat block array, before sectionize().
 */

import { headingId } from './sectionize.js';

// An item is a jump link when its entire HTML is one <a> pointing at a non-empty
// fragment. `href="#"` (a dead link, common on fandom) does not qualify.
const ANCHOR_ONLY = /^<a\s+href="#([^"]+)"[^>]*>([\s\S]*)<\/a>$/i;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// The label carries the target heading's text, so it has to be decoded the same way
// Cheerio's .text() decodes the heading itself — otherwise headingId() would slugify
// `&#39;` into `-39-` and never match.
function plainText(html) {
    return html
        .replace(/<[^>]+>/g, '')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&([a-z]+);/gi, (full, name) => ENTITIES[name.toLowerCase()] ?? full)
        .trim();
}

// Parse `<a href="#frag">Label</a>`. Nested anchors are rejected — the outer match
// would otherwise span two links.
function parseAnchor(text) {
    const match = (text ?? '').trim().match(ANCHOR_ONLY);
    if (!match || /<a[\s>]/i.test(match[2])) return null;
    return { fragment: match[1], label: plainText(match[2]) };
}

// A TOC entry may carry a sub-level <ul> of anchors (TheGamer nests sub-headings
// under their parent). Those children are jump links too.
function isJumpLinkItem(item) {
    if (!item || !parseAnchor(item.text)) return false;
    const children = item.children?.items;
    return !children || children.every(isJumpLinkItem);
}

function isJumpLinkList(block) {
    if (block?.type !== 'list' || block.ordered) return false;
    const items = block.items ?? [];
    return items.length > 0 && items.every(isJumpLinkItem);
}

// Flatten a nested TOC entry into a parent-then-children sequence. Pills are a flat
// row, so the hierarchy has nowhere to render — but every anchor stays reachable.
function flattenItem(item, out) {
    out.push({ text: item.text });
    for (const child of item.children?.items ?? []) flattenItem(child, out);
}

/**
 * TheGamer's anchors are slugified from the raw heading HTML, so `Ryuji Sakamoto -
 * Chariot` becomes `#ryuji-sakamoto---chariot` and `Ann&#39;s …` becomes
 * `#ann-39-s-…`. sectionize() derives section ids from the decoded heading text
 * instead, collapsing runs — `ryuji-sakamoto-chariot`, `ann-s-…`. The source's own
 * fragments therefore point at nothing.
 *
 * The link's label *is* the heading text, so re-derive the fragment from it. Only
 * rewrite when the original misses and the re-derived one hits, so a link that
 * already resolves is never touched.
 */
function repairFragment(item, headingIds) {
    const { fragment, label } = parseAnchor(item.text);
    if (headingIds.has(fragment)) return item;

    const derived = headingId(label);
    if (!derived || !headingIds.has(derived)) return item;

    return { text: item.text.replace(`href="#${fragment}"`, `href="#${derived}"`) };
}

export function mergeJumpLinks(blocks) {
    const headingIds = new Set(
        blocks.filter(b => b.type === 'heading').map(b => headingId(b.text)),
    );

    const out = [];
    let run = null; // { items: ListItem[], blocks: Block[] }

    function flush() {
        if (!run) return;
        if (run.items.length > 1) {
            out.push({
                type: 'list', ordered: false, variant: 'jumplinks',
                items: run.items.map(item => repairFragment(item, headingIds)),
            });
        } else {
            out.push(...run.blocks);
        }
        run = null;
    }

    for (const block of blocks) {
        if (isJumpLinkList(block)) {
            run ??= { items: [], blocks: [] };
            for (const item of block.items) flattenItem(item, run.items);
            run.blocks.push(block);
        } else {
            flush();
            out.push(block);
        }
    }
    flush();

    return out;
}
