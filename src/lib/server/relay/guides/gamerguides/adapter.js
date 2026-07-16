/**
 * Gamer Guides adapter — site-specific selectors and metadata extraction.
 *
 * Guide pages: https://www.gamerguides.com/{slug}/guide/{section}/{subsection}/{page}
 *
 *   .guide-page-content     ← article body
 *   .guide-helper-menu      ← top nav bar (prev/next/TOC) — strip
 *   .guide-sidebar          ← left TOC sidebar — strip
 *   .guide-section-menu     ← section nav menu — strip
 *   .navbar, .secondary-navbar-wrapper — site header — strip
 *
 * Image format: <div class="image-block"><picture>...<img data-orig-src="...">...</picture>
 *   <p class="image-block-caption">...</p></div>
 *   → preprocessRawHtml rewrites these to <figure> so the content parser handles them normally.
 *
 * Guide ID = game slug (e.g. "elden-ring").
 * Page slugs = relative path with / replaced by -- (e.g. "gameplay--tips-and-tricks--best-class").
 */

import * as cheerio from 'cheerio';

// ── Content selectors ─────────────────────────────────────────────────────────

const CONTENT_SELECTORS = [
    '.guide-page-content',
    'article',
    'main',
];

const JUNK_SELECTORS = [
    // Navigation & sidebars
    '.guide-helper-menu',
    '.guide-sidebar',
    '.guide-section-menu',
    '.toc-buttons',
    '.toc-logo',
    '.guide-search-form',
    '.guide-buttons',
    // Site header / footer
    '.navbar',
    '.secondary-navbar-wrapper',
    '.navbar-container-btn',
    '.global-footer',
    'footer',
    // Ads & inline "Subscribe to remove ads" blocks
    '.spons',
    '.gg-ad',
    '.remove-this-ad',
    '[class*="mv-ad"]',
    '[class*="ad-box"]',
    '[data-slotid]',
    '[class*="mediavine"]',
    '.subscribe-banner',
    '.premium-upsell',
    // Heading permalink anchors (contain the ¶ character)
    '.heading-permalink',
    // "View Full-size" overlay on images — handled by preprocessRawHtml
    '.image-vfs-wrapper',
    // Feedback widget
    '.feedback-form',
    '.guide-feedback',
    // Comments
    '.comments-section',
    '#comments',
    // "Leave feedback" toolbar
    '.guide-bottom-bar',
    '.post-footer',
];

// ── Public API ────────────────────────────────────────────────────────────────

export function resolveContentSelector($) {
    for (const sel of CONTENT_SELECTORS) {
        try {
            if ($(sel).length > 0) {
                console.log(`    [adapter:gamerguides] content selector: "${sel}"`);
                return sel;
            }
        } catch { /* invalid selector, skip */ }
    }
    throw new Error(
        `Gamer Guides adapter: no content region found. Tried: ${CONTENT_SELECTORS.join(', ')}`
    );
}

export function buildAdapter(contentSelector) {
    return { contentSelector, junkSelectors: JUNK_SELECTORS };
}

/**
 * Preprocess raw HTML before parsing:
 *
 * 1. Rewrite .image-block divs → <figure><img><figcaption> so the content
 *    parser's figure handler captures them as image blocks.
 *    Uses data-orig-src (full-res original) as the canonical image URL.
 *
 * 2. Strip database/item links (/slug/database/...) to plain text — they
 *    point to the GG item database, not guide pages, and break in our app.
 */
export function preprocessRawHtml(html, gameSlug) {
    const $ = cheerio.load(html);

    // ── 1. Rewrite .image-block → <figure> ───────────────────────────────────
    $('.image-block').each((_, el) => {
        const $el      = $(el);
        const $img     = $el.find('img').first();
        const src      = $img.attr('data-orig-src') || $img.attr('src') || '';
        const alt      = $img.attr('alt') || '';
        const caption  = $el.find('.image-block-caption').text().trim();

        if (!src) { $el.remove(); return; }

        const cap = caption ? `<figcaption>${caption}</figcaption>` : '';
        $el.replaceWith(`<figure><img src="${src}" alt="${alt}">${cap}</figure>`);
    });

    // ── 2. Strip /slug/database/... links to plain text ───────────────────────
    if (gameSlug) {
        const escaped = gameSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const dbRe = new RegExp(`^(?:https?://www\\.gamerguides\\.com)?/${escaped}/(?!guide)`, 'i');
        $(`a[href]`).each((_, el) => {
            const href = $(el).attr('href') ?? '';
            if (dbRe.test(href) || href.startsWith('/premium/')) {
                $(el).replaceWith($(el).text());
            }
        });
    }

    return $.html();
}

export function extractTitle($) {
    const h1 = $('h1').first().clone();
    h1.find('.heading-permalink').remove();
    return (
        h1.text().trim() ||
        $('title').text().replace(/\s*\|.*$/, '').replace(/\s*[-–].*$/, '').trim() ||
        'Untitled'
    );
}

/**
 * Build nav tree from the manifest page list.
 * Pages carry a group label (the section name).
 */
export function extractNavTree(_$, _guideId, manifestPages) {
    if (!manifestPages?.length) return null;

    const hasGroups = manifestPages.some(p => p.group);
    if (hasGroups) {
        const groups = new Map();
        for (const p of manifestPages) {
            const key = p.group ?? '—';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push({
                type:  'link',
                slug:  p.slug,
                label: p.label ?? slugToLabel(p.slug),
            });
        }
        return [...groups.entries()].map(([label, children]) => ({
            type: 'group', label, children,
        }));
    }

    return manifestPages.map(p => ({
        type:  'link',
        slug:  p.slug,
        label: p.label ?? slugToLabel(p.slug),
    }));
}

export function slugToLabel(slug) {
    return slug
        .replace(/--/g, ' › ')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Rewrite internal Gamer Guides links to relative slugs.
 * /elden-ring/guide/gameplay/tips-and-tricks/what-are-the-best-starting-classes
 *   → gameplay--tips-and-tricks--what-are-the-best-starting-classes
 */
export function rewriteInternalLinks(html, gameSlug, knownSlugs) {
    const escaped = gameSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
        `(?:https?://www\\.gamerguides\\.com)?/${escaped}/guide/([^"'\\s#?]+)`,
        'gi'
    );

    return html.replace(re, (_, path) => {
        const slug = path.replace(/\//g, '--').replace(/\/+$/, '');
        if (knownSlugs && !knownSlugs.has(slug)) return '#';
        return slug;
    });
}

export const needsBrowserImageCapture = false;
export const imageRootSelector = '.guide-page-content';
