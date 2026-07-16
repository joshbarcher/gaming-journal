/**
 * Fandom wiki adapter — site-specific selectors and metadata extraction.
 *
 * Fandom wikis are MediaWiki-based. Article content lives in:
 *   .mw-parser-output   ← main article body
 *
 * Guide ID = {wikiSubdomain}--{articleSlug}
 *   e.g. "persona--Persona_3_Reload"
 *
 * Page slugs = underscored article titles
 *   e.g. "Persona_3_Reload", "List_of_Requests"
 *
 * Internal links: /wiki/{ArticleTitle} → rewrite to slug for cross-page navigation.
 */

import * as cheerio from 'cheerio';

// ── Content selectors ─────────────────────────────────────────────────────────

const CONTENT_SELECTORS = [
    '.mw-content-ltr.mw-parser-output',
    '.mw-parser-output',
    '#mw-content-text',
    'article',
];

const JUNK_SELECTORS = [
    // MediaWiki boilerplate
    '.toc',                        // table of contents (we generate our own)
    '.mw-editsection',             // [edit] links
    '.catlinks',                   // "Categories: ..." footer
    '.printfooter',
    '.noprint',
    '#toc',
    '#catlinks',
    // Fandom site chrome
    '.fandom-sticky-header',
    '.global-navigation',
    '.fandom-community-header',
    '.page-header',
    '.page-header__actions',
    '.sitedir-ltr .header',
    '.notifications-placeholder',
    '#siteNotice',
    '#contentSub',
    '.mw-indicators',
    // Sidebar / infobox chrome that's not content
    '.portable-infobox .pi-navigation',
    // Fandom ads
    '.fandom-rail',
    '[class*="ad-slot"]',
    '[data-fandom-name="ad"]',
    '.incontent-ad',
    '[class*="mediawiki-ad"]',
    // Discussion / comments
    '#WikiaArticleFooter',
    '.article-footer',
    '.article-comments',
    '.wds-community-footer',
    // Bottom nav
    '.page-footer',
    'footer',
];

// ── Public API ────────────────────────────────────────────────────────────────

export function resolveContentSelector($) {
    for (const sel of CONTENT_SELECTORS) {
        try {
            if ($(sel).length > 0) {
                console.log(`    [adapter:fandom] content selector: "${sel}"`);
                return sel;
            }
        } catch { /* invalid selector, skip */ }
    }
    throw new Error(
        `Fandom adapter: no content region found. Tried: ${CONTENT_SELECTORS.join(', ')}`
    );
}

export function buildAdapter(contentSelector) {
    return { contentSelector, junkSelectors: JUNK_SELECTORS };
}

/**
 * Fandom image URLs embed a transform segment between /revision/latest and the ?cb= query:
 *   https://static.wikia.nocookie.net/.../File.png/revision/latest/scale-to-width-down/1000?cb=...
 * Dropping that segment yields the full-size image:
 *   https://static.wikia.nocookie.net/.../File.png/revision/latest?cb=...
 */
export function preprocessRawHtml(html) {
    return html.replace(
        /(https?:\/\/[^"'\s]+\/revision\/latest)\/[^?"'\s]+(\?[^"'\s]*)/gi,
        '$1$2'
    );
}

export function extractTitle($) {
    return (
        $('h1.page-header__title').text().trim() ||
        $('h1#firstHeading').text().trim() ||
        $('h1').first().text().trim() ||
        $('title').text().replace(/\s*\|.*$/, '').replace(/\s*[-–].*$/, '').trim() ||
        'Untitled'
    );
}

export function isTextGuide() { return false; }
export function extractAuthor() { return null; }

/**
 * Build nav tree from the manifest pages.
 * Fandom pages are flat (no hierarchical sidebar) so we return a flat list.
 */
export function extractNavTree(_$, _guideId, manifestPages) {
    if (!manifestPages?.length) return null;
    return manifestPages.map(p => ({
        type:  'link',
        slug:  p.slug,
        label: p.label ?? slugToLabel(p.slug),
    }));
}

export function slugToLabel(slug) {
    return slug.replace(/_/g, ' ');
}

// Namespaces that are never article content — same list as the fetcher.
const SKIP_NS_RE = /^(Special|Talk|User(?:[ _]talk)?|File(?:[ _]talk)?|MediaWiki(?:[ _]talk)?|Template(?:[ _]talk)?|Help(?:[ _]talk)?|Category(?:[ _]talk)?|Forum|Blog|Message[ _]Wall|Board|Thread):/i;

/**
 * Rewrite internal Fandom wiki links to relative slugs using cheerio so we
 * have full control over each anchor element.
 *
 * Known pages  → href="Slug"  (fragment preserved: href="Slug#Section")
 * Unknown pages → href removed, class "gv-link-unavailable" added (non-navigable)
 * Namespace links (Category:, Template:, …) → href removed (non-navigable)
 */
export function rewriteInternalLinks(html, guideId, knownSlugs) {
    const sep = guideId.indexOf('--');
    const wikiSubdomain = sep !== -1 ? guideId.slice(0, sep) : '';

    const wikiRe = new RegExp(
        `^(?:https?://${wikiSubdomain ? wikiSubdomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.fandom\\.com' : '[a-z0-9-]+\\.fandom\\.com'})?/wiki/([^#?]+)(#[^#]*)?$`,
        'i'
    );

    const $ = cheerio.load(html, { decodeEntities: false });

    $('a[href]').each((_, el) => {
        const a    = $(el);
        const href = a.attr('href') ?? '';
        const m    = href.match(wikiRe);
        if (!m) return;

        const rawTitle = m[1];
        const fragment = m[2] ?? '';

        if (SKIP_NS_RE.test(rawTitle)) {
            a.removeAttr('href');
            return;
        }

        const slug = decodeURIComponent(rawTitle).replace(/ /g, '_').replace(/[/\\:*?"<>|]/g, '-');

        if (knownSlugs && !knownSlugs.has(slug)) {
            // Page not in the downloaded guide — link out to the live wiki
            const liveUrl = `https://${wikiSubdomain}.fandom.com/wiki/${encodeURIComponent(rawTitle)}${fragment}`;
            a.attr('href', liveUrl);
            a.attr('target', '_blank');
            a.attr('rel', 'noopener noreferrer');
            a.addClass('gv-link-external');
            return;
        }

        a.attr('href', slug + fragment);
    });

    return $.html();
}

export const needsBrowserImageCapture = false;
export const imageRootSelector = '.mw-parser-output';
