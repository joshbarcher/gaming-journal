/**
 * parse-guide.js — Parse cached raw HTML into structured content + preview HTML.
 *
 * Reads from: $DATA_DIR/relay/guides/{steamId}/{source}/{guideId}/_raw/
 * Writes to:  $DATA_DIR/relay/guides/{steamId}/{source}/{guideId}/
 *
 * Usage (from relay-server root):
 *   node --env-file .env src/tools/parse-guide.js \
 *     --steam-id 251150 \
 *     --source gamefaqs \
 *     --guide-id 12345 \
 *     [--keep-external-links]
 *     [--keep-br]
 *     [--no-images]        (skip downloading NEW images; existing ones still resolve)
 *     [--force]            (re-download images already on disk)
 *
 * Output per section:
 *   {section}/content.json   — ContentBlock[] (for app integration)
 *   {section}/preview.html   — standalone HTML for visual testing
 *   {section}/img/           — downloaded images
 *
 * Output guide-level:
 *   _meta.json               — title, author, nav tree, page list
 *   _fulltext.json           — [{ slug, label, text, blockPath }] for in-guide search
 */

import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join }                                       from 'node:path';
import sharp                           from 'sharp';
import * as cheerio                    from 'cheerio';

import { defaults, applyCliOverrides }  from '../config.js';
import { loadAndClean }                 from '../parser/html-cleaner.js';
import { parseContent, collectImageBlocks } from '../parser/content-parser.js';
import { downloadImages }               from '../parser/image-downloader.js';
import { convertImgDir }                from '../images.js';
import { sectionize, extractOutline }  from '../parser/sectionize.js';
import { mergeJumpLinks }              from '../parser/jump-links.js';
import { featureDir }                  from '../../shared/data-root.js';

// ── Load source adapter ───────────────────────────────────────────────────────
// Resolved after we know --source, but we need argv first.

const DATA_DIR = process.env.DATA_DIR;
const argv     = process.argv.slice(2);

function arg(name) {
    const i = argv.indexOf(name);
    return i !== -1 ? argv[i + 1] : null;
}
function flag(name) { return argv.includes(name); }

// ── Validate args ─────────────────────────────────────────────────────────────

if (!DATA_DIR) {
    console.error('DATA_DIR not set — run with: node --env-file .env src/tools/parse-guide.js');
    process.exit(1);
}

const steamId   = arg('--steam-id');
const source    = arg('--source') ?? 'gamefaqs';
const guideId   = arg('--guide-id');
const noImages  = flag('--no-images');
const force     = flag('--force');

if (!steamId) {
    console.error('Usage: parse-guide.js --steam-id <steamId> --source gamefaqs|ign --guide-id <id> [--keep-external-links] [--keep-br] [--no-images] [--force]');
    process.exit(1);
}

if (!guideId) {
    console.error('--guide-id is required. Run fetch-guide.js first — it prints the next-step command.');
    process.exit(1);
}

// ── Dynamic adapter import ────────────────────────────────────────────────────

const adapterModule = source === 'ign'
    ? await import('../ign/adapter.js')
    : source === 'steam'
        ? await import('../steam/adapter.js')
        : source === 'game8'
            ? await import('../game8/adapter.js')
            : source === 'gamerguides'
                ? await import('../gamerguides/adapter.js')
                : source === 'fandom'
                    ? await import('../fandom/adapter.js')
                    : source === 'neoseeker'
                        ? await import('../neoseeker/adapter.js')
                        : source === 'thegamer'
                            ? await import('../thegamer/adapter.js')
                            : await import('../gamefaqs/adapter.js');

const {
    resolveContentSelector,
    buildAdapter,
    extractTitle,
    extractNavTree,
    slugToLabel,
    rewriteInternalLinks,
} = adapterModule;

// isTextGuide and extractAuthor only exist on the GameFAQs adapter
const isTextGuide            = adapterModule.isTextGuide            ?? (() => false);
const extractAuthor          = adapterModule.extractAuthor          ?? (() => null);
// preprocessRawHtml only exists on adapters that need it (e.g. IGN normalizes absolute URLs)
const preprocessRawHtml      = adapterModule.preprocessRawHtml      ?? ((html) => html);
// extractNavLinksFromDoc: used to infer parent-child relationships from local HTML files
const extractNavLinksFromDoc = adapterModule.extractNavLinksFromDoc ?? null;
// extractSidebarBranch/buildNavTreeFromBranches: IGN only — recover the real TOC
// hierarchy by unioning the server-rendered sidebar branch of every raw page.
const extractSidebarBranch     = adapterModule.extractSidebarBranch     ?? null;
const buildNavTreeFromBranches = adapterModule.buildNavTreeFromBranches ?? null;
// jumpLinks: opt-in per source — collapse runs of pure-fragment anchor lists into a
// single `variant: 'jumplinks'` block. Only sources whose TOC markup fits the shape.
const jumpLinks              = adapterModule.jumpLinks              ?? false;

const cfg = applyCliOverrides(structuredClone(defaults), argv);

// ── Paths ─────────────────────────────────────────────────────────────────────

const guideDir = join(featureDir('guides'), steamId, source, guideId);
const rawDir   = join(guideDir, '_raw');

// ── Helpers ───────────────────────────────────────────────────────────────────

async function readManifest() {
    const p = join(rawDir, '_manifest.json');
    try {
        return JSON.parse(await readFile(p, 'utf8'));
    } catch {
        throw new Error(`_manifest.json not found at ${p}. Run fetch-guide.js first.`);
    }
}

// Rewrite slug-relative hrefs in preview HTML to proper ../slug/preview.html paths.
// Only applied inside preview.html — content.json keeps the canonical slug hrefs.
function previewifyLinks(html, currentSlug) {
    return html.replace(/href="([^"#]*)(#[^"]*)?"/g, (match, slug, anchor = '') => {
        if (!slug) return match;                                     // pure anchor (#foo)
        if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(slug)) return match; // external URL
        if (slug.startsWith('/')) return match;                      // absolute path
        if (slug === currentSlug) return `href="${anchor}"`;         // same section → just anchor
        return `href="../${slug}/preview.html${anchor}"`;
    });
}

// Build a standalone preview HTML page from ContentBlock[]
function renderPreviewHtml(blocks, { title, nav, navTree, outline, currentSlug, source }) {
    const navHtml = navTree
        ? renderNavTree(navTree, currentSlug)
        : nav.map(n => {
            const active = n.slug === currentSlug ? ' class="active"' : '';
            return `<a href="../${n.slug}/preview.html"${active}>${escHtml(n.label)}</a>`;
          }).join('\n      ');

    const outlineHtml = outline.map(entry => {
        const indent = (entry.level - 1) * 10;
        return `<a href="#${entry.id}" class="ol-h${entry.level}" style="padding-left:${indent}px">${escHtml(entry.heading)}</a>`;
    }).join('\n');

    const rawContent = blocks.map(block => renderBlock(block)).join('\n');
    const content    = previewifyLinks(rawContent, currentSlug);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escHtml(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, sans-serif; font-size: 16px; line-height: 1.6; color: #e0e0e0; background: #1a1a2e; display: flex; min-height: 100vh; }

    /* ── Left outline column ── */
    .col-outline { width: 200px; min-width: 200px; position: sticky; top: 0; height: 100vh; overflow-y: auto; background: #13122a; border-right: 1px solid #1e1e38; padding: 1.25rem 0.5rem; }
    .col-outline strong { display: block; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: #445; margin-bottom: 0.5rem; padding: 0 0.4rem; }
    .col-outline a { display: block; color: #607; text-decoration: none; font-size: 0.78rem; padding: 0.18rem 0.4rem; border-radius: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .col-outline a:hover { background: #1e1e38; color: #9af; }
    .col-outline a.ol-h1 { color: #8ab; font-weight: 600; }
    .col-outline a.ol-h2 { color: #79a; }
    .col-outline a.ol-h3 { color: #568; }
    .col-outline a.ol-h4, .col-outline a.ol-h5, .col-outline a.ol-h6 { color: #446; }

    /* ── Center content column ── */
    .col-content { flex: 1; padding: 2rem 2.5rem; max-width: 860px; overflow-x: hidden; }
    .guide-meta { font-size: 0.78rem; color: #445; margin-bottom: 1.5rem; }

    /* ── Sections ── */
    section { margin-bottom: 0.25rem; }
    section.s1 { margin-top: 2rem; padding-top: 1rem; border-top: 2px solid #2a2a4a; }
    section.s1:first-of-type { border-top: none; margin-top: 0; }
    section.s2 { margin-top: 1.25rem; padding-top: 0.75rem; border-top: 1px solid #222240; }
    section.s3 { margin-top: 0.75rem; }

    /* ── Headings ── */
    h1 { font-size: 1.5rem; color: #e2b96f; margin: 0 0 0.75rem; }
    h2 { font-size: 1.2rem; color: #c9a84c; margin: 0 0 0.5rem; }
    h3 { font-size: 1rem; color: #a89050; margin: 0 0 0.4rem; border-bottom: 1px solid #2a2a3a; padding-bottom: 0.2rem; }
    h4, h5, h6 { font-size: 0.9rem; color: #887840; margin: 0 0 0.3rem; }

    p { margin: 0.5rem 0; }
    ul, ol { padding-left: 1.4rem; margin: 0.4rem 0; }
    li { margin: 0.15rem 0; }
    img { max-width: 100%; border-radius: 4px; margin: 0.5rem 0; display: block; }
    figure { margin: 0.75rem 0; }
    table { border-collapse: collapse; width: 100%; margin: 0.75rem 0; font-size: 0.88rem; }
    th { background: #0f3460; color: #e0e0e0; text-align: left; padding: 5px 9px; }
    td { border: 1px solid #2a2a4a; padding: 4px 9px; }
    tr:nth-child(even) td { background: #1c1c34; }
    code { background: #111; padding: 2px 5px; border-radius: 3px; font-size: 0.87em; white-space: pre-wrap; word-break: break-word; }
    strong { color: #e8c87a; }
    a { color: #7ab0d4; }
    .caption { font-size: 0.78rem; color: #777; margin-top: 0.2rem; }

    /* ── Emphasis: <em>, and text an outbound anchor was stripped from ── */
    em, i, .gv-keyword, .gv-keyword em, .gv-keyword i { color: #e0a996; }

    /* ── Jump-link TOC (variant: 'jumplinks') ── */
    .jumplinks { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 14px; }
    .jumplinks a { display: inline-block; padding: 5px 11px; border-radius: 999px; font-size: 0.8rem; text-decoration: none; color: #e2b96f; background: rgba(226, 185, 111, 0.09); border: 1px solid rgba(226, 185, 111, 0.28); }
    .jumplinks a:hover { background: rgba(226, 185, 111, 0.18); }

    /* ── Right guide-nav column ── */
    .col-nav { width: 220px; min-width: 220px; position: sticky; top: 0; height: 100vh; overflow-y: auto; background: #16213e; border-left: 1px solid #0f3460; padding: 1.25rem 0.75rem; }
    .col-nav strong { display: block; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: #556; margin-bottom: 0.5rem; padding: 0 0.4rem; }
    .col-nav a { display: block; color: #a0b4c8; text-decoration: none; padding: 0.22rem 0.5rem; border-radius: 4px; margin: 1px 0; font-size: 0.8rem; }
    .col-nav a:hover { background: #0f3460; color: #fff; }
    .col-nav a.active { color: #e2b96f; font-weight: bold; }
    .nav-label { font-size: 0.68rem; font-weight: bold; color: #445; text-transform: uppercase; letter-spacing: 0.06em; padding: 0.5rem 0.5rem 0.15rem; }
    details { margin: 1px 0; }
    details > summary { list-style: none; cursor: pointer; font-size: 0.8rem; font-weight: 600; color: #8ab; padding: 0.22rem 0.5rem; border-radius: 4px; user-select: none; }
    details > summary::-webkit-details-marker { display: none; }
    details > summary::before { content: '▶ '; font-size: 0.6em; opacity: 0.6; vertical-align: middle; }
    details[open] > summary::before { content: '▼ '; }
    details > summary:hover { background: #0f3460; color: #fff; }
    details > div { padding-left: 0.6rem; border-left: 1px solid #1e3050; margin-left: 0.5rem; }
  </style>
</head>
<body>
  <aside class="col-outline">
    <strong>On this page</strong>
    ${outlineHtml}
  </aside>
  <main class="col-content">
    <p class="guide-meta">Source: ${escHtml(source)}</p>
    ${content}
  </main>
  <nav class="col-nav">
    <strong>Contents</strong>
    ${navHtml}
  </nav>
</body>
</html>`;
}

// Render a single table cell. cell is {text, colspan?, rowspan?} or null (span-covered).
function renderCell(cell, tag) {
    if (cell === null || cell === undefined) return ''; // covered by a span — skip
    const attrs = [];
    if (cell.colspan > 1) attrs.push(`colspan="${cell.colspan}"`);
    if (cell.rowspan > 1) attrs.push(`rowspan="${cell.rowspan}"`);
    const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';

    // Image-bearing cell: render the image and keep the text (usually alt) as a label.
    if (cell.image?.localSrc) {
        const alt   = escHtml(cell.image.alt ?? '');
        const label = cell.text ? `<span class="cell-label">${escHtml(cell.text)}</span>` : '';
        return `<${tag}${attrStr}><img src="${escHtml(cell.image.localSrc)}" alt="${alt}" loading="lazy">${label}</${tag}>`;
    }

    return `<${tag}${attrStr}>${escHtml(cell.text ?? '')}</${tag}>`;
}

function renderBlock(block) {
    switch (block.type) {
        case 'section': {
            const cls   = `s${block.level}`;
            const hTag  = `h${block.level}`;
            const inner = block.children.map(renderBlock).join('\n');
            return `<section class="${cls}"><${hTag} id="${block.id}">${escHtml(block.heading)}</${hTag}>\n${inner}\n</section>`;
        }
        case 'paragraph':
            return `<p>${block.html}</p>`;
        case 'list':
            return block.variant === 'jumplinks'
                ? `<nav class="jumplinks">${block.items.map(i => i.text ?? '').join('')}</nav>`
                : renderList(block.ordered, block.items);
        case 'image': {
            const src = block.localSrc ?? '';
            const alt = escHtml(block.alt ?? '');
            const cap = block.caption ? `<p class="caption">${escHtml(block.caption)}</p>` : '';
            return src ? `<figure><img src="${escHtml(src)}" alt="${alt}" loading="lazy">${cap}</figure>` : '';
        }
        case 'table': {
            const cap  = block.caption ? `<caption>${escHtml(block.caption)}</caption>` : '';
            const head = block.headers.length
                ? `<thead><tr>${block.headers.map(h => renderCell(h, 'th')).join('')}</tr></thead>`
                : '';
            const body = block.rows.map(r =>
                `<tr>${r.map(c => renderCell(c, 'td')).join('')}</tr>`
            ).join('');
            return `<table>${cap}${head}<tbody>${body}</tbody></table>`;
        }
        default:
            return '';
    }
}

function renderList(ordered, items) {
    const tag  = ordered ? 'ol' : 'ul';
    const lis  = items.map(item => {
        const nested = item.children
            ? '\n' + renderList(item.children.ordered, item.children.items)
            : '';
        return `<li>${item.text ?? ''}${nested}</li>`;
    }).join('');
    return `<${tag}>${lis}</${tag}>`;
}

// Render a nav tree node (or array) into HTML for the sidebar.
// Recursively handles link, group (collapsible), and label nodes.
function renderNavTree(nodes, currentSlug) {
    return nodes.map(node => {
        if (node.type === 'link') {
            const active = node.slug === currentSlug ? ' class="active"' : '';
            return `<a href="../${node.slug}/preview.html"${active}>${escHtml(node.label)}</a>`;
        }
        if (node.type === 'label') {
            return `<div class="nav-label">${escHtml(node.label)}</div>`;
        }
        if (node.type === 'group') {
            // Groups nest, so look all the way down for the current page.
            const contains = (ns) => ns.some(c => c.slug === currentSlug || (c.children && contains(c.children)));
            const open = contains(node.children) ? ' open' : '';
            const children = renderNavTree(node.children, currentSlug);
            return `<details${open}><summary>${escHtml(node.label)}</summary><div>${children}</div></details>`;
        }
        return '';
    }).join('\n');
}

function escHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── Orphan-reference de-linker ──────────────────────────────────────────────────

// Walk a section's block tree and unwrap any in-guide <a> whose target produced no
// content.json (a page listed in the manifest that failed to parse). The link keeps
// its text — and any inline markup — as an emphasised keyword, rather than a live
// link that navigates the app to a blank page. Returns true if anything changed.
//
// Runs on already-rewritten content, where every in-guide href is a bare relative
// slug; external (scheme://), absolute (/…), and pure-fragment (#…) hrefs are left be.
function delinkUnparsedRefs(blocks, parsedSlugs) {
    let changed = false;
    const ANCHOR = /<a\b[^>]*\bhref="([^"]*)"[^>]*>(.*?)<\/a>/gis;

    const fixHtml = (s) => s.replace(ANCHOR, (whole, href, inner) => {
        if (!href || href.startsWith('#')) return whole;               // in-page anchor
        if (/^[a-z][a-z0-9+.\-]*:\/\//i.test(href)) return whole;      // external URL
        if (href.startsWith('/')) return whole;                         // absolute path
        if (parsedSlugs.has(href.split('#')[0])) return whole;          // resolves to real page
        changed = true;
        return `<span class="gv-keyword">${inner}</span>`;
    });

    const walk = (node) => {
        if (typeof node === 'string') return node.includes('<a') ? fixHtml(node) : node;
        if (Array.isArray(node)) return node.map(walk);
        if (node && typeof node === 'object') {
            for (const k of Object.keys(node)) node[k] = walk(node[k]);
        }
        return node;
    };
    walk(blocks);
    return changed;
}

// ── Anchor slicer ─────────────────────────────────────────────────────────────

// When a section slug contains '#' (e.g. "introduction#mechanics"), the page HTML
// holds ALL sections for that base page and we need to trim to just the anchor's content.
//
// GameFAQs embeds anchors inside headings: <h3>Mechanics<a id="mechanics"></a></h3>
// We find that element, remove all sibling content before it, and remove all siblings
// starting at the next heading of the same or higher level.
function sliceToAnchor($, contentSelector, anchor) {
    const $root = $(contentSelector);
    const $anchorEl = $root.find(`[id="${anchor}"]`).first();
    if (!$anchorEl.length) return false;

    const $heading = $anchorEl.closest('h1,h2,h3,h4,h5,h6');
    if (!$heading.length) return false;

    const level = parseInt($heading[0].tagName[1], 10);

    // Remove everything before the anchor heading (same parent level)
    $heading.prevAll().remove();

    // Remove everything from the next same-or-higher heading onwards
    let $cur = $heading.next();
    while ($cur.length) {
        const tag = ($cur[0].tagName ?? '').toLowerCase();
        if (/^h[1-6]$/.test(tag) && parseInt(tag[1], 10) <= level) {
            while ($cur.length) {
                const $tmp = $cur.next();
                $cur.remove();
                $cur = $tmp;
            }
            break;
        }
        $cur = $cur.next();
    }

    return true;
}

// ── Parse one section ─────────────────────────────────────────────────────────

// Emits a structured progress marker that the controller converts to an SSE { phase:'progress', bar, pct, msg }
function emitProgress(bar, pct, msg) {
    process.stdout.write(`[PROGRESS] ${JSON.stringify({ bar, pct: Math.round(pct), msg })}\n`);
}

async function parseSection(page, manifest, nav, navTree, { pageIndex, totalPages }) {
    const { slug, url, file } = page;
    const safeSlug = slug.replace(/[\\/:*?"<>|]/g, '_');
    const rawPath  = join(rawDir, file);
    const sectDir  = join(guideDir, safeSlug);
    const imgDir   = join(sectDir, 'img');

    console.log(`\n  ── ${slug} ──`);

    let html;
    try {
        html = await readFile(rawPath, 'utf8');
    } catch {
        console.warn(`  [skip] Raw file not found: ${rawPath}`);
        return null;
    }

    // Pre-process raw HTML before any parsing (e.g. IGN normalizes absolute wiki URLs
    // to root-relative so cleanInlineHtml doesn't treat them as external links).
    html = preprocessRawHtml(html, guideId);

    // Load into Cheerio to check for text-guide format
    const $raw = cheerio.load(html);
    if (isTextGuide($raw)) {
        console.warn(`  [skip] "${slug}" appears to be a text/ASCII guide — needs plain-text parser`);
        return null;
    }

    // Resolve content selector (logs which one matched)
    let contentSelector;
    try {
        contentSelector = resolveContentSelector($raw);
    } catch (err) {
        console.warn(`  [skip] ${err.message}`);
        return null;
    }

    const adapter = buildAdapter(contentSelector);

    // Inject adapter's image URL transform into cfg so content-parser applies it
    if (adapter.transformImageUrl) cfg.imageUrlTransform = adapter.transformImageUrl;

    // Clean HTML + isolate content
    const { $, content } = loadAndClean(html, adapter);

    // If the slug has an anchor (e.g. "wrenwood#wrenwood-hotel-grace"), the raw HTML
    // contains the entire parent page. Trim to just that anchor's section.
    const anchorIdx = slug.indexOf('#');
    if (anchorIdx !== -1) {
        const anchor = slug.slice(anchorIdx + 1);
        const sliced = sliceToAnchor($, contentSelector, anchor);
        if (!sliced) console.warn(`    [warn] anchor "#${anchor}" not found in content — parsing full page`);
    }

    // Extract title from first page (slug === first slug in manifest)
    const isFirstPage = slug === manifest.pages[0]?.slug;
    const title = isFirstPage ? extractTitle($raw) : null;

    // Derive source-specific guide ID used for internal link rewriting.
    // GameFAQs: numeric faqId from URL. IGN: wikiSlug. Steam: publishedfileid. Game8: gameSlug.
    let sourceGuideId;
    if (source === 'ign') {
        sourceGuideId = manifest.wikiSlug ?? guideId;
    } else if (source === 'steam') {
        try { sourceGuideId = new URL(manifest.sourceUrl).searchParams.get('id') ?? guideId; } catch { sourceGuideId = guideId; }
    } else if (source === 'game8') {
        sourceGuideId = manifest.gameSlug ?? guideId;
    } else if (source === 'gamerguides') {
        sourceGuideId = manifest.gameSlug ?? guideId;
    } else if (source === 'fandom') {
        sourceGuideId = manifest.guideId ?? guideId;
    } else if (source === 'neoseeker') {
        sourceGuideId = manifest.gameSlug ?? guideId;
    } else if (source === 'thegamer') {
        sourceGuideId = manifest.baseSlug ?? guideId;
    } else {
        sourceGuideId = manifest.sourceUrl?.match(/\/faqs\/(\d+)/)?.[1] ?? null;
    }

    // Signal start of subtask bar for this page
    emitProgress('subtask', 0, `Page ${pageIndex + 1} — parsing…`);

    // Walk DOM → flat ContentBlock[], then nest into section tree.
    // mergeJumpLinks must run before sectionize: it rewrites the flat array, and
    // sectionize's tree holds references into it that later passes mutate in place.
    const parsed     = parseContent($, content[0], cfg, { sectionSlug: slug, guideId: sourceGuideId, source });
    const flatBlocks = jumpLinks ? mergeJumpLinks(parsed) : parsed;
    const blocks     = sectionize(flatBlocks);
    const outline    = extractOutline(blocks);

    // Includes images nested in table cells, which a plain type filter would miss.
    // These are live references, so the download pass sets localSrc on them in place.
    const imageBlocks  = collectImageBlocks(flatBlocks);
    const imgCount     = imageBlocks.length;
    const headingCount = flatBlocks.filter(b => b.type === 'heading').length;
    console.log(`    ${flatBlocks.length} blocks (${headingCount} headings → ${blocks.length} top-level sections, ${imgCount} images)`);

    // subtaskTotal: 1 (parse) + imgCount (download) + imgCount (webp)
    const subtaskTotal = 1 + (noImages ? 0 : imgCount * 2);
    let subtaskDone = 1;
    emitProgress('subtask', Math.round(subtaskDone / Math.max(subtaskTotal, 1) * 100), `Content parsed`);

    // Download images (operate on flat blocks — images are always leaves)
    if (imgCount > 0) {
        await mkdir(imgDir, { recursive: true });
        const fetched = await downloadImages(imageBlocks, url, imgDir, {
            force, rawDir,
            onlyExisting: noImages,
            onProgress: !noImages ? (idx) => {
                subtaskDone++;
                emitProgress('subtask', Math.round(subtaskDone / subtaskTotal * 100), `Image ${idx}/${imgCount}`);
            } : undefined,
        });
        if (!noImages) {
            if (fetched > 0) console.log(`    Images: ${fetched}/${imgCount} fetched`);
            else             console.log(`    Images: ${imgCount} already on disk`);

            const { converted } = await convertImgDir(imgDir, {
                force,
                onProgress: (idx) => {
                    subtaskDone++;
                    emitProgress('subtask', Math.round(subtaskDone / subtaskTotal * 100), `WebP ${idx}/${imgCount}`);
                },
            });
            if (converted > 0) console.log(`    WebP:   ${converted} converted`);
        }
    }

    // Primary bar: this page is fully done
    emitProgress('pages', Math.round((pageIndex + 1) / totalPages * 100), `Page ${pageIndex + 1}/${totalPages}`);

    // Rewrite internal guide links in paragraph + list item HTML.
    // Both adapters accept (html, guideIdentifier) — GameFAQs uses faqId,
    // IGN uses wikiSlug — both stored in sourceGuideId.
    if (sourceGuideId) {
        const knownSlugs = new Set(manifest.pages.map(p => p.slug));
        function rewriteInBlock(block) {
            if (block.type === 'paragraph') {
                block.html = rewriteInternalLinks(block.html, sourceGuideId, knownSlugs);
            } else if (block.type === 'list') {
                for (const item of block.items ?? []) rewriteInItem(item);
            } else if (block.type === 'table') {
                for (const row of [...(block.headers ? [block.headers] : []), ...(block.rows ?? [])]) {
                    for (const cell of row ?? []) {
                        if (cell?.html) cell.html = rewriteInternalLinks(cell.html, sourceGuideId, knownSlugs);
                    }
                }
            }
        }
        function rewriteInItem(item) {
            if (item.text) item.text = rewriteInternalLinks(item.text, sourceGuideId, knownSlugs);
            for (const child of item.children?.items ?? []) rewriteInItem(child);
        }
        for (const block of flatBlocks) rewriteInBlock(block);
    }

    // Auto-link list items whose plain text matches a known section slug.
    // Handles guides where the author wrote "click the links below" with a plain text
    // list — we infer the target from the text matching a section label or slug.
    // Normalization strips all non-alphanumeric chars so "Rhodes Hill - The Care Center"
    // matches "rhodes-hill-the-care-center" and "Racoon City (East)" matches "racoon-city-east".
    {
        const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const normToSlug = new Map();
        for (const page of manifest.pages) {
            const baseSlug = page.slug.split('#')[0];
            normToSlug.set(normalize(baseSlug), baseSlug);
            normToSlug.set(normalize(slugToLabel(baseSlug)), baseSlug);
        }

        function autoLinkItem(item) {
            // Only process plain text items (no existing HTML tags)
            if (item.text && !/</.test(item.text)) {
                const target = normToSlug.get(normalize(item.text));
                if (target && target !== slug) {
                    item.text = `<a href="${target}">${item.text}</a>`;
                }
            }
            for (const child of item.children?.items ?? []) autoLinkItem(child);
        }
        for (const block of flatBlocks) {
            if (block.type === 'list') {
                for (const item of block.items ?? []) autoLinkItem(item);
            }
        }
    }

    // Write content.json
    await mkdir(sectDir, { recursive: true });
    await writeFile(join(sectDir, 'content.json'), JSON.stringify(blocks, null, 2));

    // Write preview.html
    const previewHtml = renderPreviewHtml(blocks, {
        title: title ?? slugToLabel(slug),
        nav,
        navTree,
        outline,
        currentSlug: slug,
        source,
    });
    await writeFile(join(sectDir, 'preview.html'), previewHtml);

    console.log(`    ✓ content.json + preview.html`);

    return { slug, blockCount: blocks.length, title };
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('Guide Parser');
console.log('══════════════════════════════════════');
console.log(`  Source:   ${source}`);
console.log(`  Steam ID: ${steamId}`);
console.log(`  Guide ID: ${guideId}`);
console.log(`  Raw dir:  ${rawDir}`);
console.log(`  Config:   links.keepExternal=${cfg.links.keepExternal}, br=${cfg.br.behavior}, images=${!noImages}`);
console.log();

async function dirSize(dir) {
    let total = 0;
    try {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) total += await dirSize(full);
            else total += (await stat(full)).size;
        }
    } catch { /* ignore missing dirs */ }
    return total;
}

try {
    const manifest = await readManifest();
    console.log(`  Manifest: ${manifest.pages.length} pages from ${manifest.fetchedAt}`);
    console.log(`  Sections: ${manifest.pages.map(p => p.slug).join(', ')}`);

    // Last good record, if any. Used to (a) guard against a transient run — a NAS blip
    // reading _raw, a sharp/cheerio crash — overwriting the authoritative _meta.json /
    // _fulltext.json with a degraded one, and (b) preserve coverImages/navTree when this
    // run derives none.
    let priorMeta = null;
    try { priorMeta = JSON.parse(await readFile(join(guideDir, '_meta.json'), 'utf8')); }
    catch { /* no prior meta (first parse) or unreadable — nothing to preserve */ }

    // Build flat nav fallback + extract hierarchical nav tree from first page
    // Use manifest labels (link text from the index page) so sources like Game8
    // (numeric archive IDs as slugs) get human-readable labels instead of raw numbers.
    const manifestLabelBySlug = new Map(manifest.pages.map(p => [p.slug, p.label]));
    const nav = manifest.pages.map(p => ({ slug: p.slug, label: p.label ?? slugToLabel(p.slug) }));

    // For manifests fetched before discoveredFrom was written by the fetcher,
    // infer it from sidebar links only — sidebar = genuine nav hierarchy on IGN.
    // No article-body fallback: body links are content cross-references, not nav structure.
    if (extractNavLinksFromDoc && !manifest.pages.some(p => p.discoveredFrom)) {
        const knownSlugs = new Set(manifest.pages.map(p => p.slug));
        const globalSeen = new Set();

        for (const page of manifest.pages) {
            const filePath = join(rawDir, page.file ?? (page.slug + '.html'));
            try {
                const html = await readFile(filePath, 'utf8');
                const $p  = cheerio.load(html);
                const links = extractNavLinksFromDoc($p, guideId, page.url ?? '', { sidebarOnly: true });
                for (const link of links) {
                    if (!knownSlugs.has(link.fsSlug) || globalSeen.has(link.fsSlug)) continue;
                    globalSeen.add(link.fsSlug);
                    const target = manifest.pages.find(p => p.slug === link.fsSlug);
                    if (target && !target.discoveredFrom) target.discoveredFrom = page.slug;
                }
            } catch { /* page file missing — skip */ }
        }
    }

    let navTree = null;

    // Preferred (IGN): the real TOC. No single page carries the whole tree —
    // collapsed sidebar groups render children only on the client — but each page
    // server-renders its own branch, so unioning all of them reconstructs it.
    if (extractSidebarBranch && buildNavTreeFromBranches) {
        const branches = [];
        for (const file of ['_index.html', ...manifest.pages.map(p => p.file ?? (p.slug + '.html'))]) {
            try {
                const $page  = cheerio.load(await readFile(join(rawDir, file), 'utf8'));
                const branch = extractSidebarBranch($page, guideId);
                if (branch) branches.push(branch);
            } catch { /* page file missing — skip */ }
        }

        const built = buildNavTreeFromBranches(branches, manifest.pages);
        if (built.navTree) {
            navTree = built.navTree;
            console.log(`  Nav tree: ${navTree.length} top-level nodes (from ${branches.length} sidebar branches)`);
            if (built.unfetched.length)
                console.log(`  Nav tree: ${built.unfetched.length} group(s) listed by IGN but not fetched: ${built.unfetched.join(', ')}`);
            if (built.orphans.length)
                console.log(`  Nav tree: ${built.orphans.length} page(s) absent from IGN's TOC, omitted from nav: ${built.orphans.join(', ')}`);
        } else {
            console.log('  Nav tree: no sidebar branches recovered — falling back to flat scrape');
        }
    }

    if (!navTree) try {
        // IGN/Game8/GamerGuides/Fandom: use _index.html (saved during fetch).
        // GameFAQs: use the first raw page which has .ftoc.
        // Steam: single page — same file as first (only) page.
        const navFile = (source === 'ign' || source === 'game8' || source === 'gamerguides' || source === 'fandom' || source === 'neoseeker' || source === 'thegamer')
            ? join(rawDir, '_index.html')
            : join(rawDir, manifest.pages[0].file);
        const firstRaw = await readFile(navFile, 'utf8');
        const $first   = cheerio.load(firstRaw);
        // extractNavTree($ [, wikiSlug, manifestPages]) — IGN adapter uses manifestPages
        // to group child pages under their parent in the sidebar nav tree.
        navTree = extractNavTree($first, guideId, manifest.pages);
        if (navTree) console.log(`  Nav tree: ${navTree.length} top-level nodes`);
    } catch { /* fall back to flat nav */ }

    let guideTitle  = null;
    let guideAuthor = null;
    const results   = [];

    const totalPages = manifest.pages.length;

    for (const [pageIndex, page] of manifest.pages.entries()) {
        const result = await parseSection(page, manifest, nav, navTree, { pageIndex, totalPages });
        if (result) {
            results.push(result);
            if (!guideTitle && result.title) {
                guideTitle  = result.title;
                // Extract author from first page HTML (GameFAQs only; IGN returns null)
                const firstHtml = await readFile(join(rawDir, page.file), 'utf8');
                const $raw = cheerio.load(firstHtml);
                guideAuthor = extractAuthor($raw);
            }
        }
    }

    // Data-integrity guard: a run that yielded no sections — or materially fewer than a
    // prior successful parse held — is a transient failure, not a real shrink. Persisting
    // it would overwrite the authoritative _meta.json/_fulltext.json with a degraded record
    // and drop pages/search entries for sections that merely failed to parse this run.
    // Abort (leaving the good files untouched); the next run retries.
    const priorPageCount = priorMeta?.pages?.length ?? 0;
    if (results.length === 0 || (priorPageCount > 0 && results.length < priorPageCount * 0.5)) {
        throw new Error(
            `Refusing to overwrite guide record: parsed ${results.length} section(s)` +
            (priorPageCount ? `, prior meta had ${priorPageCount}` : '') +
            ' — likely a transient failure, not a real change. Re-run to retry.'
        );
    }

    // De-link cross-references to pages that were listed but produced no content this
    // run (a bad capture, a redirect stub, a login wall). rewriteInternalLinks resolved
    // them to a "known" manifest slug, but with no content.json the app would render a
    // blank page — so downgrade them to plain keywords, exactly as genuinely-dead links
    // are handled. Only runs when a page failed to parse (the common all-parsed case is
    // untouched). Applies to every source: post-rewrite, all in-guide hrefs are bare slugs.
    if (results.length < manifest.pages.length) {
        const parsedSlugs = new Set(results.map(r => r.slug.split('#')[0]));
        let delinkedSections = 0;
        for (const r of results) {
            const cpath = join(guideDir, r.slug.replace(/[\\/:*?"<>|]/g, '_'), 'content.json');
            try {
                const blocks = JSON.parse(await readFile(cpath, 'utf8'));
                if (delinkUnparsedRefs(blocks, parsedSlugs)) {
                    await writeFile(cpath, JSON.stringify(blocks, null, 2));
                    delinkedSections++;
                }
            } catch { /* section content missing — skip */ }
        }
        if (delinkedSections) console.log(`  De-linked references to unparsed pages in ${delinkedSections} section(s)`);
    }

    // Collect up to 12 landscape images from across all sections for the landing page mosaic.
    // Square/portrait images (icons, thumbnails) are excluded — landscape only.
    const shuffled = [...results].sort(() => Math.random() - 0.5);
    const coverImages = [];
    for (const r of shuffled) {
        if (coverImages.length >= 12) break;
        const contentPath = join(guideDir, r.slug.replace(/[\\/:*?"<>|]/g, '_'), 'content.json');
        try {
            const blocks = JSON.parse(await readFile(contentPath, 'utf8'));
            // collectImageBlocks also reaches images nested in table cells, which a
            // plain type walk would miss — those are eligible cover art too.
            const findImages = (bs) =>
                collectImageBlocks(bs).map(img => img.localSrc).filter(Boolean);
            for (const src of findImages(blocks)) {
                if (coverImages.length >= 12) break;
                const imgPath = join(guideDir, r.slug.replace(/[\\/:*?"<>|]/g, '_'), src);
                try {
                    const { width, height } = await sharp(imgPath).metadata();
                    if (width && height && width > height * 1.2) {
                        coverImages.push({ section: r.slug, src });
                        break; // one per section
                    }
                } catch { /* image unreadable */ }
            }
        } catch { /* section missing or no images */ }
    }

    // Build _fulltext.json — one entry per text block, for in-browser Fuse.js search.
    // We strip HTML to plain text so matches are clean and context extraction works.
    {
        const stripHtml  = s => (s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const fulltextEntries = [];

        function extractText(block, path) {
            switch (block.type) {
                case 'section':
                    if (block.heading) {
                        fulltextEntries.push({ slug: currentSlug, label: currentLabel, text: block.heading, blockPath: path });
                    }
                    // j+1 because the <h2/h3/h4> heading is always DOM child[0] inside .gv-section
                    (block.children ?? []).forEach((child, j) => extractText(child, [...path, j + 1]));
                    break;
                case 'paragraph': {
                    const text = stripHtml(block.html);
                    if (text.length > 10) fulltextEntries.push({ slug: currentSlug, label: currentLabel, text, blockPath: path });
                    break;
                }
                case 'list':
                    for (const item of block.items ?? []) extractListItem(item, path);
                    break;
                case 'table': {
                    const cells = [
                        ...(block.headers ?? []),
                        ...(block.rows ?? []).flat(),
                    ].map(c => stripHtml(c?.text ?? c?.html ?? '')).filter(Boolean);
                    if (cells.length) fulltextEntries.push({ slug: currentSlug, label: currentLabel, text: cells.join(' · '), blockPath: path });
                    break;
                }
            }
        }

        function extractListItem(item, listPath) {
            const text = stripHtml(item.text ?? '');
            if (text.length > 3) fulltextEntries.push({ slug: currentSlug, label: currentLabel, text, blockPath: listPath });
            for (const child of item.children?.items ?? []) extractListItem(child, listPath);
        }

        let currentSlug  = '';
        let currentLabel = '';

        for (const r of results) {
            currentSlug  = r.slug;
            currentLabel = manifestLabelBySlug.get(r.slug) ?? slugToLabel(r.slug);
            try {
                const blocks = JSON.parse(await readFile(join(guideDir, r.slug.replace(/[\\/:*?"<>|]/g, '_'), 'content.json'), 'utf8'));
                blocks.forEach((block, i) => extractText(block, [i]));
            } catch { /* section missing */ }
        }

        await writeFile(join(guideDir, '_fulltext.json'), JSON.stringify(fulltextEntries));
        console.log(`  Fulltext: ${fulltextEntries.length} entries`);
    }

    // Write _meta.json
    const sizeBytes = await dirSize(guideDir);

    const meta = {
        steamId,
        source,
        guideId,
        title:       guideTitle ?? source,
        author:      guideAuthor,
        sourceUrl:   manifest.sourceUrl,
        parsedAt:    new Date().toISOString(),
        sizeBytes,
        // Preserve prior coverImages/navTree when this run derived none (a transient
        // sharp/nav failure) — an empty set here would blank a good landing mosaic / TOC.
        coverImages: coverImages.length >= 6 ? coverImages : (priorMeta?.coverImages?.length ? priorMeta.coverImages : []),
        nav,
        navTree: navTree ?? priorMeta?.navTree ?? null,
        pages: results.map(r => ({ slug: r.slug, label: manifestLabelBySlug.get(r.slug) ?? slugToLabel(r.slug) })),
        version: 1,
    };
    await writeFile(join(guideDir, '_meta.json'), JSON.stringify(meta, null, 2));

    console.log('\n══════════════════════════════════════');
    console.log(`  Parsed:  ${results.length}/${manifest.pages.length} sections`);
    console.log(`  Title:   ${meta.title}`);
    if (meta.author) console.log(`  Author:  ${meta.author}`);
    console.log(`\n  Preview: open ${join(guideDir, manifest.pages[0]?.slug ?? '', 'preview.html')} in a browser`);

} catch (err) {
    console.error('\n[parse-guide] Fatal error:', err.message);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
}

// All work is done and every file is written. Force a clean exit so the parent
// job-queue's child 'close' event fires immediately. Leftover keep-alive sockets
// from image downloads (undici) can otherwise keep the event loop referenced,
// leaving the download job stuck at 100% ("Index" bar full) but never completing.
// Flush stdout first so the final log lines aren't truncated on the pipe.
await new Promise(resolve => process.stdout.write('', resolve));
process.exit(0);
