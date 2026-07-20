/**
 * Neoseeker guide adapter — site-specific selectors and metadata extraction.
 *
 * Neoseeker guides are MediaWiki-based. Content lives in:
 *   #wiki-content > .section-spaced > .mw-parser-output
 *
 * Guide ID = game slug  (e.g. "resident-evil-requiem")
 * Page slugs = Title_Case page names with underscores
 *   e.g. "walkthrough", "Wrenwood_Hotel_(Grace)"
 *
 * Image URLs: thumbnail form has /ew/thumb/{hash}/{filename}/{size}-{filename}
 *   Full-size URL from data-full_image attribute (preferred) or by stripping /thumb/ segment.
 */

import * as cheerio from 'cheerio';

// ── Content selectors ─────────────────────────────────────────────────────────

const CONTENT_SELECTORS = [
    '#wiki-content',
    '.mw-parser-output',
    '#mw-content-text',
    'article',
];

const JUNK_SELECTORS = [
    '.noprint',
    '.mw-editsection',
    '#nav_prev_next',
    '#wiki-navigation',
    '.wiki-toc',
    '#page-title',
    '#page-action-buttons',
    '.catlinks',
    '.printfooter',
    '#toc',
    // Ads
    '[class*="ad-"]',
    '[id*="google_ad"]',
    '[style*="background:#efefef"]',
    '[class*="lockr"]',
    // Share / social — exclude #wiki-content itself which carries class="social_share"
    '.social_share:not(#wiki-content)',
    '.social_share_buttons',
    // Header / footer
    '#header',
    '#footer',
    '#neo_bar',
    '#right_content_span',
    // Comments
    '#commenttabs_container',
    '#comment_form',
    '#no_comment',
    // Inline edit notices
    '.mw-content-notice',
    // Navigation panels
    '.navbox',
    '.navigation-box',
];

// ── Public API ────────────────────────────────────────────────────────────────

export function resolveContentSelector($) {
    for (const sel of CONTENT_SELECTORS) {
        try {
            if ($(sel).length > 0) {
                console.log(`    [adapter:neoseeker] content selector: "${sel}"`);
                return sel;
            }
        } catch { /* invalid selector — skip */ }
    }
    throw new Error(
        `Neoseeker adapter: no content region found. Tried: ${CONTENT_SELECTORS.join(', ')}`
    );
}

export function buildAdapter(contentSelector) {
    return { contentSelector, junkSelectors: JUNK_SELECTORS };
}

/**
 * Promote lightbox-wrapped images to <figure> so the content parser can see them.
 *
 * Neoseeker wraps every content image in an <a class="image …"> lightbox link:
 *
 *   <div class="center-div-container">
 *     <a class="image photoswipe" data-full_image="…/ew/a/a8/Ae_557.jpg">
 *       <img src="…/ew/thumb/a/a8/Ae_557.jpg/600px-Ae_557.jpg">
 *     </a>
 *   </div>
 *
 * <a> is not a block tag, so the walker buffers the whole anchor as inline HTML and
 * cleanInlineHtml then deletes the <img> (not in its KEEP_INLINE set, and a void
 * element's innerHTML is ""). Every image on every Neoseeker guide was lost this way.
 *
 * Rewriting the anchor to <figure><img></figure> puts it on the parser's figure branch.
 */
function promoteLightboxImages(html) {
    const $ = cheerio.load(html, { decodeEntities: false });

    $('a.image').each((_, el) => {
        const $a   = $(el);
        const $img = $a.find('img').first();
        if (!$img.length) return;

        // a.image.no-cursor wraps img.img-icon — mid-sentence glyphs (chest markers,
        // button prompts, ~12-24px). Promoting those to standalone figures would
        // litter the page, so leave them on the inline path.
        if ($a.hasClass('no-cursor') || $img.hasClass('img-icon')) return;

        // Neoseeker carries data-full_image on the <a>, never on the <img>.
        const full = $a.attr('data-full_image');
        if (full) $img.attr('src', full);

        // These describe the thumbnail, not the full-size src we just swapped in.
        for (const attr of ['srcset', 'width', 'height', 'class', 'loading', 'decoding', 'fetchpriority']) {
            $img.removeAttr(attr);
        }

        $a.replaceWith($('<figure></figure>').append($img));
    });

    // <figure> inside <p> is invalid nesting, and when the paragraph also carries text
    // the parser takes its inline path and drops the image again. Re-tag those as <div>
    // — a generic block wrapper the walker recurses into — so text and images both
    // survive, in document order.
    $('p:has(figure)').each((_, el) => {
        const $p = $(el);
        $p.replaceWith($('<div></div>').append($p.contents()));
    });

    // Serialize the whole document, not just <body> — extractTitle/extractAuthor read
    // the JSON-LD block out of <head> further down the parse.
    return $.html();
}

/**
 * Transform raw HTML before parsing:
 *   - Promote lightbox-wrapped images to <figure> (see promoteLightboxImages)
 *   - Convert absolute guide-page links to bare slugs
 *   - Regex-fallback: strip /thumb/ and the NNNpx-{filename} resize suffix
 */
export function preprocessRawHtml(html, guideId) {
    // Pass 0: promote images first — this consumes the lightbox anchors, whose
    // href="…/File:Ae_557.jpg" would otherwise survive pass 1 as a bare "File:…"
    // slug and end up flagged gv-link-unavailable by rewriteInternalLinks.
    let out = promoteLightboxImages(html);

    // Pass 1: convert absolute Neoseeker guide page links to bare slug hrefs
    // so cleanInlineHtml doesn't treat them as external URLs and strip them.
    // https://www.neoseeker.com/{guideId}/{PageSlug} → {PageSlug}
    if (guideId) {
        const esc = guideId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out.replace(
            new RegExp(`https?://www\\.neoseeker\\.com/${esc}/(?:[a-z][a-z0-9-]*/)?([^"'\\s#?/]+)(#[^"'\\s]*)?`, 'g'),
            (_, page, frag = '') => `${decodeURIComponent(page)}${frag}`
        );
    }

    // Pass 2: strip any thumbnail URLs pass 0 didn't already resolve — images with no
    // lightbox anchor, and the inline icons we deliberately leave unpromoted.
    //   /ew/thumb/a/a8/Ae_557.jpg/600px-Ae_557.jpg → /ew/a/a8/Ae_557.jpg
    out = out.replace(
        /https?:\/\/cdn\.staticneo\.com\/ew\/thumb\/([a-f0-9]\/[a-f0-9]{2}\/[^/]+)\/[^\s"']+/g,
        'https://cdn.staticneo.com/ew/$1'
    );

    return out;
}

export function extractTitle($) {
    const h1 = $('#page-title h1, .page-title h1').first().text().trim();
    if (h1) return h1;

    // JSON-LD fallback
    try {
        const ld = JSON.parse($('script[type="application/ld+json"]').first().text());
        if (ld?.headline) return String(ld.headline).replace(/\s+Walkthrough.*$/i, '').trim();
    } catch { /* not available */ }

    return $('h1').first().text().trim();
}

export function extractAuthor($) {
    try {
        const ld = JSON.parse($('script[type="application/ld+json"]').first().text());
        return ld?.author?.name ?? null;
    } catch {
        return null;
    }
}

export function slugToLabel(slug) {
    if (slug === 'walkthrough') return 'Introduction';
    return slug.replace(/_/g, ' ');
}

/**
 * Build a hierarchical nav tree from the .wiki-toc on the index page.
 *
 * TOC structure:
 *   <ul>
 *     <li class="heading">Section Name</li>
 *     <li><a href="/{slug}/{PageTitle}">Page Title</a></li>
 *     ...
 *   </ul>
 */
export function extractNavTree($, guideId, manifestPages) {
    if (!manifestPages?.length) return null;

    const pageSlugSet = new Set(manifestPages.map(p => p.slug));
    const gameSlug    = guideId;
    const seen        = new Set();
    const tree        = [];

    // Introduction always first
    if (pageSlugSet.has('walkthrough')) {
        tree.push({ type: 'link', slug: 'walkthrough', label: 'Introduction' });
        seen.add('walkthrough');
    }

    function parsePageHref(href) {
        if (!href || href.startsWith('#')) return null;
        try {
            const u     = new URL(href, 'https://www.neoseeker.com');
            const parts = u.pathname.split('/').filter(Boolean);
            if (parts[0] !== gameSlug) return null;
            if (parts.length === 2 && parts[1] !== 'walkthrough') return decodeURIComponent(parts[1]);
            if (parts.length === 3) return decodeURIComponent(parts[2]);
            return null;
        } catch {
            return null;
        }
    }

    function linkLabel(a) {
        const title = $(a).attr('title') ?? '';
        const text  = $(a).text().trim();
        // Title attrs on section sub-pages contain a path prefix (e.g. "daydream/Page Name") — use text instead
        return (title.includes('/') ? text : title) || text;
    }

    // Parse flat page links from a <ul> of sub-items (accordion body)
    function parseSubItems(ul) {
        const items = [];
        $(ul).children('li').each((_, li) => {
            $(li).find('a[href]').each((_, a) => {
                const slug = parsePageHref($(a).attr('href') ?? '');
                if (!slug || !pageSlugSet.has(slug) || seen.has(slug)) return;
                const label = linkLabel(a);
                if (label) { seen.add(slug); items.push({ type: 'link', slug, label }); }
            });
        });
        return items;
    }

    // Neoseeker TOC uses multiple <ul> within .wiki-toc; section headings
    // and accordion groups span these boundaries.  We flatten the structure:
    //   li.heading          → { type: 'label' } divider
    //   li > a (page href)  → { type: 'link' }
    //   li > ul (accordion) → { type: 'group', children: flat page links }
    //     If the accordion trigger is also a page link → group gets a slug too

    $('.wiki-toc > ul').each((_, ul) => {
        $(ul).children('li').each((_, li) => {
            const $li = $(li);

            // Section divider (e.g. "Main Story", "Database")
            if ($li.hasClass('heading')) {
                const label = $li.text().trim();
                if (label) tree.push({ type: 'label', label });
                return;
            }

            // Accordion group: <li> has a direct-child <ul>
            const $subUl = $li.children('ul').first();
            if ($subUl.length) {
                let groupLabel    = null;
                let groupPageSlug = null;

                $li.children('a[href]').each((_, a) => {
                    const href = $(a).attr('href') ?? '';
                    const slug = parsePageHref(href);
                    if (slug && pageSlugSet.has(slug) && !seen.has(slug)) {
                        // The accordion header is itself a navigable page
                        groupPageSlug = slug;
                        if (!groupLabel) groupLabel = linkLabel(a);
                    } else {
                        // Fragment link — use its text as the group label
                        const text = $(a).text().trim();
                        if (text && !groupLabel) groupLabel = text;
                    }
                });

                const subItems = parseSubItems($subUl);

                if (groupPageSlug) seen.add(groupPageSlug);

                if (subItems.length > 0 && groupLabel) {
                    // slug makes the group header a navigable button in the sidebar
                    const node = { type: 'group', label: groupLabel, children: subItems };
                    if (groupPageSlug) node.slug = groupPageSlug;
                    tree.push(node);
                } else if (groupPageSlug && groupLabel) {
                    tree.push({ type: 'link', slug: groupPageSlug, label: groupLabel });
                }
                return;
            }

            // Plain page links (direct children with no sub-list)
            $li.find('a[href]').each((_, a) => {
                const href = $(a).attr('href') ?? '';
                const slug = parsePageHref(href);
                if (!slug || !pageSlugSet.has(slug) || seen.has(slug)) return;
                seen.add(slug);
                const label = linkLabel(a);
                if (label) tree.push({ type: 'link', slug, label });
            });
        });
    });

    return tree.length > 1 ? tree : null;
}

/**
 * Rewrite internal Neoseeker links to relative slug hrefs.
 *   https://www.neoseeker.com/{gameSlug}/{PageTitle}   → {PageTitle}
 *   https://www.neoseeker.com/{gameSlug}/walkthrough   → walkthrough
 *   ...#fragment                                        → #fragment preserved
 */
export function rewriteInternalLinks(html, guideId, knownSlugs) {
    const gameSlug = guideId;
    const base     = 'https://www.neoseeker.com';
    const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedSlug = gameSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const $ = cheerio.load(html, { decodeEntities: false });

    $('a[href]').each((_, el) => {
        const a    = $(el);
        const href = a.attr('href') ?? '';

        let slug, fragment;

        // Full absolute URL: /{gameSlug}/{page} or /{gameSlug}/walkthrough/{page}
        const mAbs = href.match(
            new RegExp(`^${escapedBase}/${escapedSlug}/([^#?]+)?(#.*)?$`, 'i')
        );
        if (mAbs) {
            let raw = mAbs[1] ? decodeURIComponent(mAbs[1]) : 'walkthrough';
            raw = raw.replace(/^[a-z][a-z0-9-]*\//, '');
            slug     = raw || 'walkthrough';
            fragment = mAbs[2] ?? '';
        } else {
            // Bare slug pre-converted by preprocessRawHtml: e.g. "August_2nd" or "August_2nd#anchor"
            const mBare = href.match(/^([A-Za-z0-9_()!+\-. ]+)(#.*)?$/);
            if (mBare && !href.startsWith('/') && !href.startsWith('#')) {
                slug     = decodeURIComponent(mBare[1]);
                fragment = mBare[2] ?? '';
            }
        }

        if (!slug) return;

        if (knownSlugs.has(slug)) {
            a.attr('href', fragment ? `${slug}${fragment}` : slug);
        } else {
            a.removeAttr('href');
            a.addClass('gv-link-unavailable');
            a.attr('title', 'Page not in guide');
        }
    });

    return $('body').html() ?? html;
}
