/**
 * TheGamer (thegamer.com) adapter — site-specific selectors and metadata.
 *
 * TheGamer articles are Valnet CMS pages. The article body lives at:
 *   article
 *     └── .article-body                 ← content region (id="article-body")
 *           ├── nav.article-directory-sidenav   ← the guide "directory" dropdown (nav chrome)
 *           ├── .w-directory-warning            ← chrome
 *           └── .content-block-regular          ← the actual prose (may repeat around ads)
 *                 ├── dialog#valnet-login-container-limiter  ← sign-up modal (chrome, mid-prose)
 *                 └── #article-hidden-content                ← real prose, despite the name
 *
 * Images are wrapped as <picture><img></picture> (sometimes inside <figure>).
 * <picture> is an inline element, so the generic content parser would buffer it
 * as inline HTML and cleanInlineHtml would strip the <img>. preprocessRawHtml
 * promotes each <picture>/image wrapper to a block-level <figure> so the parser's
 * figure handler picks it up.
 *
 * There is no numeric guide ID — the guide identifier is the article slug
 * (e.g. "persona-5-royal-april-walkthrough-guide").
 */

import * as cheerio from 'cheerio';

// ── Content selectors (first match wins) ───────────────────────────────────────

const CONTENT_SELECTORS = [
    '.article-body',
    '#article-body',
    'article .content-block-regular',
    'article',
];

// Site chrome inside the content region that is not guide prose.
const JUNK_SELECTORS = [
    // The in-article guide "directory" dropdown / sidenav (kept for nav-tree extraction
    // from _index.html, but stripped from per-page prose).
    'nav.article-directory-sidenav',
    '.article-directory-sidenav',
    '.w-directory-warning',
    // Valnet login / "article limiter" modal. Valnet injects it *inside*
    // .content-block-regular, mid-prose, as a <dialog> holding a background <picture>,
    // the "Unlock Personalized Content" feature list, and the sign-up fields. It escapes
    // html-cleaner's ALWAYS_REMOVE because the fields sit in <div id="login-form-…">
    // rather than a real <form>, and <dialog> isn't in that list either.
    // Every page in a fetched guide carries exactly one; it never wraps prose.
    'dialog',
    '.w-login', '.w-valnet-login', '.w-article-limiter', '[id^="valnet-login"]',
    // Ads / promos / affiliate widgets
    '.w-ad', '.ad-container', '.ad-unit', '[id^="ad-"]', '[id^="google_ads"]',
    // Mediavine ad rails (the class names Valnet actually emits)
    '.mv-ad-box', '.adunit', '.adunitwrapper', 'mv-ad-reporter',
    '.affiliate-widget', '.w-affiliate',
    // Newsletter / social / related / comments chrome
    '.article-body-newsletter', '.newsletter-form', '.w-newsletter',
    '.social-share', '.w-social', '.share-buttons',
    '.related', '.w-related', '.article-related', '.related-posts',
    '.w-comments', '.comments',
    // Trending / "read more" recirculation blocks
    '.w-trending', '.recirculation', '.read-more',
    // Header/footer chrome (belt + suspenders)
    'header', 'footer', '.header', '.footer',
];

// ── Public API ──────────────────────────────────────────────────────────────

export function resolveContentSelector($) {
    for (const sel of CONTENT_SELECTORS) {
        try {
            if ($(sel).length > 0) {
                console.log(`    [adapter:thegamer] content selector: "${sel}"`);
                return sel;
            }
        } catch { /* invalid selector, skip */ }
    }
    throw new Error(
        `TheGamer adapter: no content region found. Tried: ${CONTENT_SELECTORS.join(', ')}. ` +
        `The page structure may have changed or the URL may be wrong.`
    );
}

// TheGamer's "Jump Links" TOC is one <ul class="table-content-list"> per link, so a
// six-entry TOC parses as six single-item lists. Opt in to the jump-links pass.
export const jumpLinks = true;

/**
 * The article's own tags, from the byline tag strip — NOT every /tag/ link on the page.
 * Trending widgets and inline prose link to tags too; scoping to `.article-tags` is what
 * separates "this article is about Persona 5 Royal" from "this page mentions Skyrim".
 *
 * The strip also carries category links (/category/lists/, /aaa-games/) which are not
 * tags and are skipped. Some articles carry no game tag at all — TheGamer just never
 * tagged them — so an empty result means "unknown", not "off-topic".
 */
export function extractArticleTags(html) {
    const $ = typeof html === 'string' ? cheerio.load(html) : html;
    const tags = new Set();
    $('.article-tags a.tags-link').each((_, el) => {
        const match = ($(el).attr('href') ?? '').match(/^\/tag\/([a-z0-9-]+)\/?$/i);
        if (match) tags.add(match[1].toLowerCase());
    });
    return tags;
}

/**
 * Article slugs listed on a `/tag/{tag}/{n}/` listing page.
 *
 * Scoped to each card's own image link. `section.w-listing` looks like the right
 * container but only wraps the featured block and the tag/platform chip header — most
 * cards render outside it, and on page 2 it holds none at all. Taking every anchor
 * inside a card would also pull in the `/aaa-games/` category chip.
 */
export function extractTagListingSlugs(html) {
    const $ = cheerio.load(html);
    const slugs = new Set();
    $('main .display-card a.dc-img-link').each((_, el) => {
        const slug = pageSlugFromHref($(el).attr('href'));
        // Every article slug is hyphenated; bare words are brand/section hubs.
        if (slug && slug.includes('-')) slugs.add(slug);
    });
    return slugs;
}

export function buildAdapter(contentSelector) {
    return {
        contentSelector,
        unwrapSelectors:   [],
        junkSelectors:     JUNK_SELECTORS,
        transformImageUrl: stripTheGamerCdnParams,
    };
}

/**
 * Strip thegamerimages.com CDN resize params so we download the full-res original.
 *   https://static0.thegamerimages.com/…/file.jpg?q=50&fit=crop&w=825&h=… → …/file.jpg
 */
function stripTheGamerCdnParams(src) {
    if (!src) return src;
    if (!/thegamerimages\.com|valnetcdn\.com/i.test(src)) return src;
    try {
        const u = new URL(src);
        u.search = '';
        return u.href;
    } catch {
        return src;
    }
}

/**
 * Extract the guide title from <h1> (falls back to <title>), stripping the
 * "TheGamer's " lead-in and the " | TheGamer" / " - TheGamer" site suffix.
 */
export function extractTitle($) {
    const h1  = $('h1').first().text().trim();
    const raw = h1 || $('title').text().trim();
    return raw
        .replace(/^TheGamer['’]s\s+/i, '')
        .replace(/\s*[-–|]\s*TheGamer\s*$/i, '')
        .trim() || 'Untitled';
}

/**
 * Author from meta / byline, if present.
 */
export function extractAuthor($) {
    const meta   = $('meta[name="author"]').attr('content')?.trim();
    const byline = meta || $('.w-author-name, a[rel="author"], .author-name, .article-author a').first().text();
    const clean  = (byline || '').replace(/\s+/g, ' ').replace(/^\s*By\s+/i, '').trim();
    return clean || null;
}

// ── Slug helpers ────────────────────────────────────────────────────────────

/**
 * Extract the article slug from a thegamer.com URL or path.
 *   https://www.thegamer.com/persona-5-royal-april-walkthrough-guide/ → persona-5-royal-april-walkthrough-guide
 * Returns null for section/tag/author pages.
 */
export function pageSlugFromHref(href) {
    if (!href) return null;
    try {
        const u = new URL(href, 'https://www.thegamer.com');
        if (!/(^|\.)thegamer\.com$/i.test(u.hostname)) return null;
        const m = u.pathname.match(/^\/([a-z0-9-]+)\/?$/i);
        if (!m) return null;
        const slug = m[1].toLowerCase();
        // Skip section / utility landing pages (no hyphen → likely a category, plus known ones)
        if (/^(tag|author|category|videos|reviews-previews|search)$/.test(slug)) return null;
        return slug;
    } catch {
        return null;
    }
}

export function slugToLabel(slug) {
    return slug
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Nav tree for the guide. TheGamer's directory is a flat, ordered list, so we
 * build flat link nodes straight from the manifest pages (which carry the clean
 * directory labels). Falls back to reading the directory sidenav from the doc.
 */
export function extractNavTree($, guideId, manifestPages) {
    const known        = new Set((manifestPages ?? []).map(p => p.slug));
    const labelBySlug  = new Map((manifestPages ?? []).map(p => [p.slug, p.label]));

    const nav = $('nav.article-directory-sidenav, .article-directory-sidenav').first();
    if (!nav.length) {
        // No directory dropdown (standalone article) — flat list from manifest.
        const flat = (manifestPages ?? []).map(p => ({ type: 'link', slug: p.slug, label: p.label ?? slugToLabel(p.slug) }));
        return flat.length ? flat : null;
    }

    // TheGamer's directory is nested divs: a `.sidenav-item` header is followed by a
    // sibling `.directory-subnav` container holding its children (links, and/or more
    // header+subnav pairs). Parse one container's direct children into ordered entries.
    function parseEntries($container) {
        const entries = [];
        const kids = $container.children().toArray();
        for (let i = 0; i < kids.length; i++) {
            const $el = $(kids[i]);
            if ($el.is('a.sidenav-item-link')) {
                const slug = pageSlugFromHref($el.attr('href'));
                if (slug) entries.push({ kind: 'link', slug, label: cleanLabel($el.text()) });
            } else if ($el.hasClass('sidenav-item')) {
                const label = cleanLabel($el.text());
                const $next = $(kids[i + 1]);
                if ($next.hasClass('directory-subnav')) { entries.push({ kind: 'group', label, $sub: $next }); i++; }
                else entries.push({ kind: 'label', label });
            } else if ($el.hasClass('directory-subnav')) {
                entries.push(...parseEntries($el)); // orphan container — inline
            }
        }
        return entries;
    }

    // All known-page links under a container, recursively flattened (for sub-sub-groups).
    function collectLinks($container) {
        const links = [];
        for (const e of parseEntries($container)) {
            if (e.kind === 'link' && known.has(e.slug)) links.push(mkLink(e));
            else if (e.kind === 'group') links.push(...collectLinks(e.$sub));
        }
        return links;
    }

    const mkLink = e => ({ type: 'link', slug: e.slug, label: e.label || labelBySlug.get(e.slug) || slugToLabel(e.slug) });

    const out  = [];
    const used = new Set();
    const pushLink = l => { if (!used.has(l.slug)) { used.add(l.slug); out.push(l); } };
    const dedupe   = links => { const r = []; for (const l of links) if (!used.has(l.slug)) { used.add(l.slug); r.push(l); } return r; };

    const root = nav.find('.sidenav-level').first();
    for (const e of parseEntries(root.length ? root : nav)) {
        if (e.kind === 'link') {
            if (known.has(e.slug)) pushLink(mkLink(e));
        } else if (e.kind === 'label') {
            out.push({ type: 'label', label: e.label });
        } else if (e.kind === 'group') {
            const sub = parseEntries(e.$sub);
            if (sub.some(x => x.kind === 'group')) {
                // 2-tier: the super-category becomes a non-navigable label, its
                // subsections become collapsible groups (the viewer only nests one level).
                out.push({ type: 'label', label: e.label });
                for (const x of sub) {
                    if (x.kind === 'link' && known.has(x.slug)) pushLink(mkLink(x));
                    else if (x.kind === 'group') {
                        const children = dedupe(collectLinks(x.$sub));
                        if (children.length) out.push({ type: 'group', label: x.label, children });
                    }
                }
            } else {
                const children = dedupe(sub.filter(x => x.kind === 'link' && known.has(x.slug)).map(mkLink));
                if (children.length) out.push({ type: 'group', label: e.label, children });
            }
        }
    }

    // The entry/index page (e.g. the complete-guide hub) isn't listed in its own
    // directory — surface it at the top so it stays reachable.
    const entrySlug = manifestPages?.[0]?.slug;
    if (entrySlug && known.has(entrySlug) && !used.has(entrySlug)) {
        out.unshift({ type: 'link', slug: entrySlug, label: labelBySlug.get(entrySlug) || slugToLabel(entrySlug) });
        used.add(entrySlug);
    }

    // Anything downloaded but not in the directory — keep it accessible. Pages pulled
    // in by the depth-1 related hop get their own heading: there can be more of them
    // than there are guide pages, and they aren't part of the author's structure.
    const leftovers = (manifestPages ?? []).filter(p => !used.has(p.slug));
    const unlisted  = leftovers.filter(p => !p.related);
    const related   = leftovers.filter(p =>  p.related);

    for (const [label, pages] of [['More Guides', unlisted], ['Related Articles', related]]) {
        if (!pages.length) continue;
        out.push({ type: 'label', label });
        for (const p of pages) pushLink({ type: 'link', slug: p.slug, label: p.label || slugToLabel(p.slug) });
    }

    return out.length ? out : null;
}

function cleanLabel(text) {
    return (text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Resolve every thegamer.com link left in a block's inline HTML.
 *
 * By the time this runs, preprocessRawHtml has turned absolute article URLs into
 * root-relative paths, so anything starting with "/" came from thegamer.com:
 *
 *   in-guide page   → bare slug, fragment preserved ("foo-guide#the-tower")
 *   anything else   → the <a> is unwrapped, leaving its text (and any inline markup)
 *                     in place
 *
 * The guide is not built to lead elsewhere. The related-article BFS pulls in every
 * on-topic article the prose points at, so what remains outbound is a dead article
 * TheGamer deleted, an off-topic listicle, or byline chrome (/author/…, /tag/…). None
 * of those are worth sending a reader off to, and left as hrefs the root-relative ones
 * would navigate the app to a route that doesn't exist.
 *
 * Fragment-only hrefs (#jump-links) are left alone.
 */
const ARTICLE_PATH = /^\/([a-z0-9-]+)\/?(#.*)?$/i;

export function rewriteInternalLinks(html, guideId, knownSlugs) {
    if (!html.includes('href="/')) return html;

    // Fragment mode (3rd arg false) — a document load would wrap each block's inline
    // HTML in <html><head><body>.
    const $ = cheerio.load(html, { decodeEntities: false }, false);

    $('a[href]').each((_, el) => {
        const a    = $(el);
        const href = a.attr('href') ?? '';
        if (!href.startsWith('/')) return;

        const match = href.match(ARTICLE_PATH);
        const slug  = match?.[1]?.toLowerCase();

        if (slug && knownSlugs?.has(slug)) {
            a.attr('href', slug + (match[2] ?? ''));
            return;
        }

        // Outbound — drop the anchor, keep what it said, and mark it. These read as
        // keywords in the prose rather than dead links: the renderer gives them a second
        // accent colour instead of link styling.
        a.replaceWith(`<span class="gv-keyword">${$.html(a.contents())}</span>`);
    });

    return $.html();
}

/**
 * Normalise DOM quirks before parsing:
 *  - Absolute thegamer.com hrefs → root-relative. html-cleaner strips any anchor
 *    carrying a URI scheme as "external", which happens before rewriteInternalLinks
 *    can tell an in-guide cross-reference from an outbound one — so every "RELATED:"
 *    link was being flattened to plain text. Same normalisation the IGN adapter does.
 *    Only href is touched; image srcs live on thegamerimages.com.
 *  - <picture><img></picture> and bare block <img> wrappers → block-level <figure>
 *    so the content parser's figure handler extracts them (inline <picture> would
 *    otherwise be buffered inline and the <img> stripped).
 */
export function preprocessRawHtml(html, guideId) {
    html = html.replace(
        /href="https?:\/\/(?:www\.)?thegamer\.com(\/[^"]*)"/gi,
        (_, path) => `href="${path}"`,
    );

    if (!html.includes('<picture')) return html;
    const $ = cheerio.load(html);
    $('picture').each((_, el) => {
        const $el = $(el);
        const $img = $el.find('img').first();
        const src = $img.attr('src') || $img.attr('data-src') || '';
        if (!src || src.startsWith('data:')) { $el.remove(); return; }
        const alt = $img.attr('alt') || '';
        $el.replaceWith(`<figure><img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"></figure>`);
    });
    return $.html();
}

function escapeAttr(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;');
}
