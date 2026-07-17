/**
 * IGN wiki adapter — site-specific selectors and metadata extraction.
 *
 * IGN wiki pages are Next.js SSR'd. The article lives at:
 *   .wiki-page-container
 *     └── div.desktop-wiki-group (first)
 *           └── div.wiki-html.content   ← content region
 *
 * Navigation is in the left sidebar:
 *   aside.sidebar > nav > div.scrollbar  ← contains all /wikis/{slug}/… links
 *
 * There is no numeric guide ID — the guide identifier is the wiki slug
 * (e.g. "pragmata", "persona-3-reload").
 */

import * as cheerio from 'cheerio';

// ── Content selectors ─────────────────────────────────────────────────────────

// Tried in order — first match wins
const CONTENT_SELECTORS = [
    '.wiki-html.content',
    '.wiki-html',
    '.wiki-page-container .content',
    '.wiki-page-container',
];

// Elements to unwrap (replace with children) — run BEFORE ALWAYS_REMOVE so
// content inside normally-stripped tags (like <button>) is preserved.
const UNWRAP_SELECTORS = [
    // IGN wraps each image in <output class="wiki-image"><button>…<img>…</button></output>
    // The button is removed by ALWAYS_REMOVE, taking the img with it.
    // Unwrapping the button first promotes the <img> into the output element
    // where the parser can find it normally.
    'output.wiki-image button',
];

// Elements inside the content region that are site chrome, not guide content
const JUNK_SELECTORS = [
    // Right-rail ad/promo column
    '.right-rail',
    // IGN embedded video players
    '.wiki-video',
    '[data-cy="wiki-auto-embed"]',
    // output.wiki-image wrapper itself is kept (it holds the img after unwrap above)
    // Inline ad units
    '[class*="adunit"]',
    '[class*="advertisement"]',
    '[class*="bobble"]',
    '[class*="pogogenieup"]',
    '#pogogenieup',
    // Bottom prev/next navigation row
    '.desktop-wiki-group:last-of-type .content',
    // "See Also" / wiki-section link blocks (site chrome at page bottom)
    '.wiki-section',
    // Rating / helpful bars
    '[class*="helpful"]',
    '[class*="rating"]',
    // Site header/footer chrome (belt+suspenders)
    'header',
    'footer',
    '.header',
    '.footer',
];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resolve the best content selector from the list above.
 * Returns the selector string that matched, or throws if none did.
 */
export function resolveContentSelector($) {
    for (const sel of CONTENT_SELECTORS) {
        try {
            if ($(sel).length > 0) {
                console.log(`    [adapter:ign] content selector: "${sel}"`);
                return sel;
            }
        } catch { /* invalid selector, skip */ }
    }
    throw new Error(
        `IGN adapter: no content region found. ` +
        `Tried: ${CONTENT_SELECTORS.join(', ')}. ` +
        `The page may require a login or the URL may be wrong.`
    );
}

/**
 * The adapter descriptor passed to html-cleaner and content-parser.
 */
export function buildAdapter(contentSelector) {
    return {
        contentSelector,
        unwrapSelectors:   UNWRAP_SELECTORS,
        junkSelectors:     JUNK_SELECTORS,
        transformImageUrl: stripIgnCdnParams,
    };
}

/**
 * Strip IGN CDN resize parameters so we download the full-resolution original.
 *
 * IGN thumb URL:  https://oyster.ignimgs.com/…/file.png?width=670&format=jpg&auto=webp&quality=80
 * Full-res URL:   https://oyster.ignimgs.com/…/file.png
 */
function stripIgnCdnParams(src) {
    if (!src) return src;
    if (!src.includes('oyster.ignimgs.com') && !src.includes('assets-prd.ignimgs.com')) return src;
    try {
        const u = new URL(src);
        u.search = '';
        return u.href;
    } catch {
        return src;
    }
}

/**
 * Extract the guide title — the GAME name, not the current page heading.
 *
 * IGN <title> format: "{Page} - {Game Name} Guide - IGN"
 *                  or "{Game Name} Guide - IGN"
 * We want "{Game Name}" for the _meta.json guide title.
 */
export function extractTitle($) {
    const raw = $('title').text();
    // "{Page} - {Game Name} Guide - IGN"  →  Game Name
    const twoPartMatch = raw.match(/^.+?[-–]\s*(.+?)\s+Guide\s*[-–]/i);
    if (twoPartMatch) return twoPartMatch[1].trim();
    // "{Game Name} Guide - IGN"
    const onePartMatch = raw.match(/^(.+?)\s+Guide\s*[-–]/i);
    if (onePartMatch) return onePartMatch[1].trim();
    // Last resort: strip "- IGN" suffix
    return raw.replace(/\s*[-–]\s*IGN\s*$/i, '').trim() || 'Untitled';
}

/**
 * Extract the game name (not the page title).
 * Used for _meta.json and display purposes.
 */
export function extractGameName($) {
    // <title> format: "Page Title - Game Name Guide - IGN"
    const title = $('title').text();
    const m = title.match(/^(.+?)\s*[-–]\s*(.+?)\s+Guide\s*[-–]/i);
    if (m) return m[2].trim();
    // Fallback: first h3 in sidebar is usually the game name
    const h3 = $('aside h3, nav h3').first().text().trim();
    return h3 || null;
}

/**
 * IGN serves editorial drafts under a "slate/" path segment
 * (…/wikis/{slug}/slate/{Page}) that mirrors an already-published page. A reader
 * link to one resolves to a draft stub the parser can't render — a blank page.
 * Drop the namespace so it points at the published page instead.
 * "slate/Tziah_(Floors_119_-_144)_Tartarus_Walkthrough" → "Tziah_(Floors_119_-_144)_Tartarus_Walkthrough"
 */
function stripWikiNamespace(pagePath) {
    return pagePath.replace(/^slate\//i, '');
}

/**
 * Extract the page slug from a full IGN wiki URL or path.
 * "/wikis/pragmata/Walkthrough" → "Walkthrough"
 * "/wikis/pragmata"             → null (homepage)
 */
export function pageSlugFromHref(href, wikiSlug) {
    const prefix = `/wikis/${wikiSlug}/`;
    if (!href.startsWith(prefix)) return null;
    const rest = href.slice(prefix.length);
    if (!rest || rest.startsWith('#')) return null;
    // Strip any trailing anchor, then any editorial namespace segment.
    return stripWikiNamespace(decodeURIComponent(rest.split('#')[0]));
}

/**
 * Build a safe filesystem slug from an IGN page title.
 * "Prologue Walkthrough" → "prologue-walkthrough"
 * "Sector 01: Solar Power Plant Walkthrough and Completion Guide" → "sector-01-solar-power-plant-walkthrough-and-completion-guide"
 */
export function titleToSlug(title) {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Convert a filesystem slug back to a display label.
 * "prologue-walkthrough" → "Prologue Walkthrough"
 */
export function slugToLabel(slug) {
    return slug
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Extract all navigable wiki page links from a loaded document.
 *
 * Scans both the sidebar (.scrollbar) and the wiki article body (.wiki-html)
 * so index pages that use their body as a TOC are fully discovered.
 *
 * Returns ordered array of { pageTitle, fsSlug, label, url } — deduped.
 *
 * @param {CheerioStatic} $ - loaded document
 * @param {string} wikiSlug
 * @param {string} baseUrl  - used to resolve relative hrefs to absolute
 */
/**
 * @param {boolean} [opts.sidebarOnly=false]
 *   When true, only scan the sidebar (.scrollbar) — not article body (.wiki-html).
 *   Use for non-index pages: sidebar links are genuine nav, body links are cross-refs.
 *   When false (default), scan both — needed for index pages whose TOC is in the body.
 */
export function extractNavLinksFromDoc($, wikiSlug, baseUrl, { sidebarOnly = false } = {}) {
    const seen  = new Set();
    const pages = [];

    function addLink(el) {
        const href = $(el).attr('href') ?? '';
        const pageTitle = pageSlugFromHref(href, wikiSlug);
        if (!pageTitle) return;
        if (/^(topcontributors|contributors|editors)/i.test(pageTitle)) return;
        const fsSlug = titleToSlug(pageTitle);
        if (!fsSlug || seen.has(fsSlug)) return;
        seen.add(fsSlug);
        const label = $(el).text().trim();
        const url   = new URL(href, baseUrl).href;
        pages.push({ pageTitle, fsSlug, label, url });
    }

    $('.scrollbar a[href*="/wikis/"]').each((_, el) => addLink(el));
    if (!sidebarOnly) {
        $('.wiki-html a[href*="/wikis/"]').each((_, el) => addLink(el));
    }
    return pages;
}

// Sentinel key for the guide root (the wiki index page, which has no page slug).
const ROOT = ' root';

/**
 * Extract one branch of IGN's sidebar TOC from a single loaded page.
 *
 * IGN renders the sidebar as `.sidebar-section.toc-N` containing, in order:
 *   [0]  <a>       the page whose branch is currently expanded ("head")
 *   [1…] <a>       leaf child pages
 *        <button>  child pages that are themselves collapsible groups
 *
 * Only the branch containing the current page is server-rendered — collapsed
 * groups render as <button> with no href, their children injected client-side.
 * So no single page reveals the whole tree, but every page reveals its own
 * branch. Union the branches across all fetched pages and the tree is exact.
 *
 * A <button>'s target slug is recovered by slugifying its label; the caller
 * drops any that don't correspond to a fetched page.
 *
 * On the index page the head is the wiki root (`/wikis/{slug}`, no page
 * segment), which yields `head: null` — that branch is the top-level nav order.
 *
 * @param {CheerioStatic} $ - loaded document
 * @param {string} wikiSlug
 * @returns {{ head: string|null, children: Array<{slug, label, isGroup}> }|null}
 */
export function extractSidebarBranch($, wikiSlug) {
    const section = $('.sidebar-section[class*="toc-"]').first();
    if (!section.length) return null;

    const entries = [];
    section.children('a, button').each((_, el) => {
        const $el   = $(el);
        const label = ($el.find('.interface').first().text() || $el.text()).trim();
        if (!label) return;

        if (el.tagName === 'button') {
            entries.push({ slug: titleToSlug(label), label, isGroup: true });
            return;
        }
        const href = $el.attr('href') ?? '';
        // Skip sidebar chrome linking off-wiki (e.g. "Game Info" → /games/…)
        if (!href.startsWith(`/wikis/${wikiSlug}`)) return;
        const pageTitle = pageSlugFromHref(href, wikiSlug);
        entries.push({ slug: pageTitle ? titleToSlug(pageTitle) : null, label, isGroup: false });
    });

    // Need a head plus at least one child, and the head must be a real link.
    if (entries.length < 2 || entries[0].isGroup) return null;
    const [head, ...children] = entries;
    return { head: head.slug, children };
}

/**
 * Assemble the nav tree from sidebar branches collected across every raw page.
 *
 * Branches are keyed by their head slug; the branch whose head is `null` is the
 * guide root and supplies the top-level order. Children naming a page we never
 * fetched (a group IGN lists but the crawl didn't reach) are dropped.
 *
 * @param {Array<{head: string|null, children: Array}>} branches
 * @param {Array<{slug, label}>} manifestPages
 * @returns {{ navTree: Array|null, orphans: string[], unfetched: string[] }}
 */
export function buildNavTreeFromBranches(branches, manifestPages) {
    const known       = new Set(manifestPages.map(p => p.slug));
    const labelBySlug = new Map(manifestPages.map(p => [p.slug, p.label]));

    // head → ordered children. Every page in a branch reports that same branch,
    // so the first one seen wins.
    const childrenOf = new Map();
    for (const branch of branches) {
        const key = branch.head ?? ROOT;
        if (!childrenOf.has(key)) childrenOf.set(key, branch.children);
    }

    const rootChildren = childrenOf.get(ROOT);
    if (!rootChildren?.length) return { navTree: null, orphans: [], unfetched: [] };

    const placed    = new Set();
    const unfetched = new Set();

    function build(entries, ancestors) {
        const out = [];
        for (const entry of entries) {
            if (!entry.slug) continue;
            if (!known.has(entry.slug)) {
                if (entry.isGroup) unfetched.add(entry.slug);
                continue;
            }
            // A page listed under two parents keeps its first placement; a branch
            // that names one of its own ancestors would otherwise loop forever.
            if (placed.has(entry.slug) || ancestors.has(entry.slug)) continue;
            placed.add(entry.slug);

            const label    = entry.label || labelBySlug.get(entry.slug) || slugToLabel(entry.slug);
            const children = childrenOf.has(entry.slug)
                ? build(childrenOf.get(entry.slug), new Set([...ancestors, entry.slug]))
                : [];

            out.push(children.length
                ? { type: 'group', slug: entry.slug, label, children }
                : { type: 'link',  slug: entry.slug, label });
        }
        return out;
    }

    const navTree = build(rootChildren, new Set([ROOT]));
    if (!navTree.length) return { navTree: null, orphans: [], unfetched: [] };

    // Pages IGN's own TOC never lists — typically stale title redirects
    // (e.g. "Arqa Part 1" → "Arqa (Floors 23 - 43)"). Still reachable by URL,
    // and absent from the nav exactly as they are on ign.com.
    const orphans = manifestPages.map(p => p.slug).filter(s => !placed.has(s));
    return { navTree, orphans, unfetched: [...unfetched] };
}

/**
 * Legacy nav tree: flat sidebar+body link scrape, grouped by the crawler's
 * `discoveredFrom`. Retained only as a fallback for cached HTML that predates
 * the `.toc-N` sidebar markup — `discoveredFrom` records which page the crawl
 * happened to reach a page from first, which is not IGN's hierarchy.
 *
 * @param {CheerioStatic} $ - loaded document
 * @param {string} wikiSlug - the wiki slug (e.g. "pragmata")
 * @returns {Array|null}
 */
export function extractNavTree($, wikiSlug, manifestPages) {
    const items = [];
    const seen  = new Set();

    function addLink(el) {
        const href = $(el).attr('href') ?? '';
        const slug = pageSlugFromHref(href, wikiSlug);
        if (!slug) return;
        if (slug === 'topcontributors' || slug.startsWith('contributors')) return;
        const fsSlug = titleToSlug(slug);
        if (!fsSlug || seen.has(fsSlug)) return;
        seen.add(fsSlug);
        const label = $(el).text().trim();
        if (label.length < 2) return;
        items.push({ type: 'link', slug: fsSlug, label });
    }

    // Primary: sidebar scrollbar div
    $('.scrollbar a[href]').each((_, el) => addLink(el));

    // Secondary: wiki article body (index pages use article content as their TOC)
    $('.wiki-html a[href]').each((_, el) => addLink(el));

    if (!items.length) return null;

    // If manifest has discoveredFrom info, group child pages under their parent
    if (manifestPages?.some(p => p.discoveredFrom)) {
        const topSlugs = new Set(items.map(i => i.slug));
        const childrenOf = new Map();

        for (const page of manifestPages) {
            if (!page.discoveredFrom) continue;
            const parent = page.discoveredFrom;
            if (!topSlugs.has(parent)) continue;
            if (!childrenOf.has(parent)) childrenOf.set(parent, []);
            childrenOf.get(parent).push({ type: 'link', slug: page.slug, label: page.label });
        }

        if (childrenOf.size > 0) {
            return items.map(item => {
                const children = childrenOf.get(item.slug);
                return children?.length ? { ...item, type: 'group', children } : item;
            });
        }
    }

    return items;
}

/**
 * Resolve an IGN link's slug to a page that actually exists in this guide.
 *
 * A wiki cross-reference often names a page by a title that no longer matches its
 * current filesystem slug — IGN renames and re-splits pages, and the link text
 * lags. We try, in order of confidence:
 *   1. exact match
 *   2. token-subset either direction, so long as the page explains most of the
 *      link's own words and the match is unambiguous. This rescues:
 *        "final-mission-january-31"            → "final-mission-the-promised-day-january-31"  (link ⊆ page)
 *        "slate-tziah-floors-119-144-…-walkthrough" → "tziah-floors-119-144-…-walkthrough"    (page ⊆ link)
 *      while refusing to fold a specific link ("arqa-part-2-tartarus-walkthrough")
 *      into a generic hub page ("tartarus-walkthrough") on a shared suffix alone.
 *
 * Returns the resolved known slug, or null if the target isn't in this guide
 * (a dead cross-reference — IGN removed or never surfaced the page). With no
 * knownSlugs set (defensive), the slug is trusted as-is.
 *
 * @param {string} fsSlug
 * @param {Set<string>} [knownSlugs]
 * @returns {string|null}
 */
function resolveKnownSlug(fsSlug, knownSlugs) {
    if (!knownSlugs) return fsSlug;
    if (knownSlugs.has(fsSlug)) return fsSlug;

    const target = fsSlug.split('-').filter(Boolean);
    if (target.length < 2) return null;            // too generic to match safely
    const targetSet = new Set(target);

    let best = null, bestDelta = Infinity, tie = false;
    for (const s of knownSlugs) {
        const toks   = s.split('-').filter(Boolean);
        const tokSet = new Set(toks);
        const linkInPage = target.every(t => tokSet.has(t));   // link title ⊆ page title
        const pageInLink = toks.every(t => targetSet.has(t));  // page title ⊆ link title
        if (!linkInPage && !pageInLink) continue;
        // The matched page must cover most of the LINK's own words, so a short,
        // generic page can't swallow a specific link that merely shares its suffix.
        const shared = Math.min(target.length, toks.length);
        if (shared / target.length < 0.6) continue;
        const delta = Math.abs(toks.length - target.length);
        if (delta < bestDelta) { best = s; bestDelta = delta; tie = false; }
        else if (delta === bestDelta && s !== best) tie = true;
    }
    return tie || !best ? null : best;
}

/**
 * Rewrite internal IGN wiki links in a block's inline HTML.
 *
 *   in-guide page   → bare slug, fragment preserved ("prologue-walkthrough#gear")
 *   wiki root        → "#" (the guide landing)
 *   dead / off-wiki  → the <a> is unwrapped into <span class="gv-keyword">, keeping
 *                      its text (and any inline markup) as an emphasised keyword
 *                      rather than a link that navigates the app to a page with no
 *                      content. IGN renames and removes pages, so cross-references
 *                      to them go stale; left as live links they render blank pages.
 *
 * Runs after preprocessRawHtml has relativised absolute ign.com URLs, so every
 * remaining "/wikis/…" href is an IGN wiki link we can classify.
 *
 * @param {string} html            - inline HTML fragment
 * @param {string} wikiSlug        - this guide's wiki slug, e.g. "persona-3-reload"
 * @param {Set<string>} [knownSlugs] - fs slugs of every page fetched for this guide
 * @returns {string}
 */
export function rewriteInternalLinks(html, wikiSlug, knownSlugs) {
    // Belt-and-suspenders: relativise any absolute ign.com wiki URL that slipped
    // through (preprocessRawHtml normally does this on the raw HTML first).
    const normalized = html.replace(
        /href="https?:\/\/(?:www\.)?ign\.com(\/wikis\/[^"]*)"/gi,
        (_, path) => `href="${path}"`
    );
    if (!normalized.includes('/wikis/')) return normalized;

    const wikiPrefix = `/wikis/${wikiSlug}`;

    // Fragment mode (3rd arg false) so a block's inline HTML isn't wrapped in
    // <html><head><body> on serialisation.
    const $ = cheerio.load(normalized, { decodeEntities: false }, false);

    $('a[href]').each((_, el) => {
        const a    = $(el);
        const href = a.attr('href') ?? '';
        if (!href.startsWith('/wikis/')) return;   // not a wiki link (external handled upstream)

        // Only THIS guide's wiki. Cross-wiki links (/wikis/other-game/…) point off
        // this guide and would route the SPA to a page it doesn't have — drop them.
        const thisWiki = href === wikiPrefix
            || href.startsWith(`${wikiPrefix}/`)
            || href.startsWith(`${wikiPrefix}#`);
        if (!thisWiki) {
            a.replaceWith(`<span class="gv-keyword">${$.html(a.contents())}</span>`);
            return;
        }

        let rest = href.slice(wikiPrefix.length);
        if (rest.startsWith('/')) rest = rest.slice(1);
        const hashIdx = rest.indexOf('#');
        const rawPage = hashIdx === -1 ? rest : rest.slice(0, hashIdx);
        const rawFrag = hashIdx === -1 ? ''   : rest.slice(hashIdx + 1);

        if (!rawPage) { a.attr('href', '#'); return; }   // wiki root → guide landing

        const pagePath = stripWikiNamespace(decodeURIComponent(rawPage));
        const resolved = resolveKnownSlug(titleToSlug(pagePath), knownSlugs);
        if (resolved) {
            const frag = rawFrag ? '#' + titleToSlug(decodeURIComponent(rawFrag)) : '';
            a.attr('href', resolved + frag);
            return;
        }

        // Dead in-guide cross-reference — keep the words, lose the broken link.
        a.replaceWith(`<span class="gv-keyword">${$.html(a.contents())}</span>`);
    });

    return $.html();
}

/**
 * Normalize absolute ign.com wiki URLs to root-relative paths in raw HTML,
 * so the content parser sees them as internal links rather than external.
 * Must run before loadAndClean so cleanInlineHtml doesn't strip them.
 *
 * e.g. https://www.ign.com/wikis/slug/Page → /wikis/slug/Page
 *
 * Also rewrites IGN task-card checkbox spans into <p> elements so that
 * consecutive task items stack as separate blocks rather than running together
 * as inline text.
 */
export function preprocessRawHtml(html, wikiSlug) {
    let result = html.replace(
        /https?:\/\/(?:www\.)?ign\.com(\/wikis\/[^"'\s]+)/gi,
        (_, path) => path
    );
    const hasTaskCards = result.includes('data-cy="checkbox-view-trigger"');
    const hasWikiImage = result.includes('wiki-image');
    if (hasTaskCards || hasWikiImage) {
        result = rewriteDomQuirks(result, { hasTaskCards, hasWikiImage });
    }
    return result;
}

/**
 * Single cheerio pass that normalises IGN-specific DOM quirks into shapes the
 * generic content parser recognises:
 *
 *  1. Task cards ([data-cy="checkbox-view-trigger"]) → one <p> per task, so
 *     consecutive tasks stack as separate blocks instead of running together.
 *
 *  2. Image wrappers (<output class="wiki-image"><button><img></button></output>)
 *     → block-level <figure><img></figure>. IGN frequently places these <output>
 *     wrappers as BARE children of the content div (not inside an image-only <p>).
 *     Because <output> is an inline element, the content parser buffers it as
 *     inline HTML and cleanInlineHtml then strips the <img> — silently dropping
 *     the image. Promoting each wrapper to a real <figure> makes the parser's
 *     figure handler pick it up every time, regardless of surrounding context.
 */
function rewriteDomQuirks(html, { hasTaskCards, hasWikiImage }) {
    const $ = cheerio.load(html);

    if (hasTaskCards) {
        $('[data-cy="checkbox-view-trigger"]').each((_, el) => {
            const $el  = $(el);
            const name = $el.find('input[type="checkbox"]').first().attr('name')?.trim()
                      || $el.find('.task-name').first().text().trim();
            if (name) {
                $el.replaceWith(`<p class="ign-task">${escapeText(name)}</p>`);
            } else {
                $el.remove();
            }
        });
    }

    if (hasWikiImage) {
        $('output.wiki-image').each((_, el) => {
            const $el  = $(el);
            const figs = [];
            $el.find('img').each((_, img) => {
                const src = $(img).attr('src') || $(img).attr('data-src') || '';
                if (!src || src.startsWith('data:')) return;   // skip lazy placeholders
                const alt = $(img).attr('alt') || '';
                figs.push(`<figure><img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"></figure>`);
            });
            if (figs.length) $el.replaceWith(figs.join(''));
            else             $el.remove();
        });
    }

    return $.html();
}

function escapeText(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeAttr(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;');
}

/**
 * IGN image URLs use `oyster.ignimgs.com` and respond to plain HTTP without
 * session cookies, so we can skip the Puppeteer image-capture step.
 * Returns false to signal that captureGuideImages is not needed.
 */
export const needsBrowserImageCapture = false;

/**
 * The CSS selector used to gather image URLs during the Puppeteer fetch phase.
 * Not used by IGN (needsBrowserImageCapture = false), but exported for symmetry.
 */
export const imageRootSelector = '.wiki-html.content';
