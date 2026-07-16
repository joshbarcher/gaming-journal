/**
 * Game8 wiki adapter — site-specific selectors and metadata extraction.
 *
 * Game8 article pages (game8.co/games/{gameSlug}/archives/{id}):
 *
 *   .p-archiveContent__main          ← article body content
 *   .p-archiveHeader                 ← title, author, date — strip as chrome
 *   .p-archiveBody__side             ← right sidebar — strip
 *   .l-breadcrumb                    ← breadcrumb nav — strip
 *
 * Images are lazy-loaded: src is a placeholder GIF, real URL is in data-src.
 * preprocessRawHtml() swaps data-src → src before the content parser runs.
 *
 * Guide ID = game slug (e.g. "Octopath-Traveler-2").
 * Page slugs = numeric archive IDs (e.g. "404331").
 */

import * as cheerio from 'cheerio';

// ── Content selectors ─────────────────────────────────────────────────────────

const CONTENT_SELECTORS = [
    '.p-archiveContent__main',
    '.p-archiveBody__main',
    'article',
    'main',
];

const JUNK_SELECTORS = [
    // Sidebar
    '.p-archiveBody__side',
    '.p-archiveBody__side-inner',
    '.p-archiveContent__side',
    '.p-archiveBody__overlay',
    '.p-archiveBody__sidebar-toggle',
    // Article header chrome (title, author, buttons — extracted separately)
    '.p-archiveHeader',
    // Breadcrumbs
    '.l-breadcrumb',
    '.p-archiveBreadcrumb',
    '.p-archiveBreadcrumbItem',
    // Footer
    '.l-footer',
    '.l-footerGame',
    '.l-footerCorp',
    '.l-footerCopyright',
    // Feedback / ratings
    '.p-archiveFeedback',
    // Author block at bottom of article
    '.p-article__author',
    // Membership modal
    '[class*="p-membershipModal"]',
    '[class*="c-micromodal"]',
    // Comment section
    '[class*="c-comment"]',
    '[class*="c-commentItem"]',
    // Ads
    '[class*="l-advert"]',
    '[class*="p-advert"]',
    '[id*="google_ads"]',
    // Social share buttons
    '[class*="c-share"]',
    // Sidebar article / game lists
    '.c-sideContainer',
    '.c-sideGameList',
    '.c-sideArticleList',
    // Game header and nav
    '.p-gameHeader',
    '.p-gameEyecatch',
    '.p-gameNavText',
    '.p-game-menu',
    // Tooltip content
    '.js-tooltip-content',
    '.c-tooltip__btn',
    // Inline table-of-contents (we build nav from manifest)
    '.l-toc',
    '[class*="p-tableOfContents"]',
];

// ── Public API ────────────────────────────────────────────────────────────────

export function resolveContentSelector($) {
    for (const sel of CONTENT_SELECTORS) {
        try {
            if ($(sel).length > 0) {
                console.log(`    [adapter:game8] content selector: "${sel}"`);
                return sel;
            }
        } catch { /* invalid selector, skip */ }
    }
    throw new Error(
        `Game8 adapter: no content region found. ` +
        `Tried: ${CONTENT_SELECTORS.join(', ')}. ` +
        `The page may require login or the URL may be wrong.`
    );
}

export function buildAdapter(contentSelector) {
    return {
        contentSelector,
        junkSelectors: JUNK_SELECTORS,
    };
}

/**
 * Swap lazy-loaded image placeholders for real URLs before the parser runs.
 * Game8 renders <img src="placeholder.gif" data-src="real-url.jpg" class="lazy …">
 *
 * Also rewrites Game8's internal `#hl_N` fragment links to use the slugified
 * heading text that our content parser will generate as section IDs, so that
 * intra-page anchor links resolve correctly in the guide viewer.
 */
export function preprocessRawHtml(html) {
    html = html
        .replace(/\ssrc="data:image\/gif[^"]*"/g, '')   // remove placeholder src
        .replace(/\sdata-src=/g, ' src=');               // promote data-src → src

    // Build hl_N → slug map from headings that carry id="hl_N"
    const hlMap = new Map();
    const $ = cheerio.load(html);
    $('[id^="hl_"]').each((_, el) => {
        const id   = $(el).attr('id');
        const text = $(el).text().trim();
        if (id && text) {
            const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            hlMap.set(id, slug);
        }
    });

    if (hlMap.size > 0) {
        html = html.replace(/href="#(hl_\d+)"/g, (_, id) => {
            const slug = hlMap.get(id);
            return slug ? `href="#${slug}"` : 'href=""';
        });
    }

    return html;
}

/**
 * Extract the article title.
 * Must run before junk selectors strip .p-archiveHeader.
 */
export function extractTitle($) {
    return (
        $('.p-archiveHeader__title').first().text().trim() ||
        $('h1').first().text().trim() ||
        $('title').text().replace(/\s*\|.*$/, '').replace(/\s*[-–].*$/, '').trim() ||
        'Untitled'
    );
}

/**
 * Build a flat nav tree from the manifest page list.
 * Section grouping (from the index h2 headings) is stored in page.group.
 */
export function extractNavTree(_$, _guideId, manifestPages) {
    if (!manifestPages?.length) return null;

    // If pages carry group labels, build a grouped nav tree.
    const hasGroups = manifestPages.some(p => p.group);
    if (hasGroups) {
        const groups = new Map();
        for (const p of manifestPages) {
            const key = p.group ?? '—';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push({ type: 'link', slug: p.slug, label: p.label ?? slugToLabel(p.slug) });
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
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Rewrite internal Game8 article links to relative slugs.
 * https://game8.co/games/Octopath-Traveler-2/archives/404331 → 404331
 */
export function rewriteInternalLinks(html, gameSlug, knownSlugs) {
    const escaped = gameSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Rewrite archive links → relative slug (or # if not downloaded)
    const archiveRe = new RegExp(
        `(?:https?://game8\\.co)?/games/${escaped}/archives/(\\d+)([^"'\\s]*)`, 'gi'
    );
    html = html.replace(archiveRe, (_, id, rest) => {
        if (knownSlugs && !knownSlugs.has(id)) return '#';
        const anchor = rest.startsWith('#') ? rest : '';
        return `${id}${anchor}`;
    });

    // Rewrite bare game index links (no /archives/) → # (guide landing page)
    const indexRe = new RegExp(
        `(?:https?://game8\\.co)?/games/${escaped}/?(?=[^/a-zA-Z0-9])`, 'gi'
    );
    html = html.replace(indexRe, '#');

    return html;
}

/**
 * Game8 images load from assets.game8.co — direct HTTP fetch works fine,
 * no Puppeteer image capture needed (data-src is handled by preprocessRawHtml).
 */
export const needsBrowserImageCapture = false;
export const imageRootSelector = '.p-archiveContent__main';
