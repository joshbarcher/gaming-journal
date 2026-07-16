/**
 * GameFAQs adapter — site-specific selectors and metadata extraction.
 *
 * GameFAQs HTML guides (not text/ASCII guides) have:
 *   - A left sidebar with a table of contents (.ftoc or similar)
 *   - A main content region (#faqtext / .faqtext)
 *   - A guide title in .faqhdr or the page <title>
 *   - Section headings that are sometimes <div class="faqsub"> rather than <h*>
 *
 * These selectors were derived from the guide HTML structure and may need
 * tuning if GameFAQs updates their markup. The parse tool logs which selector
 * matched so you can catch regressions quickly.
 *
 * NOTE: If a guide is a text/ASCII format, this adapter throws early with a
 * clear message — those guides need a separate plain-text parser.
 */

// ── Content selectors ─────────────────────────────────────────────────────────

// Tried in order — first match wins
const CONTENT_SELECTORS = [
    '#faqwrap',            // GameFAQs HTML guides — confirmed selector
    '#faqtext',
    '.faqtext',
    '.ffaqbody',
    '#faq',
    '.faq-body',
    '.guide-content',
];

// Elements inside the content region that are site chrome, not guide content
const JUNK_SELECTORS = [
    // Sidebar / TOC
    '.ftoc',
    '.faqtoc',
    '.guide-toc',
    '#ftoc',
    '#faq_toc',
    '#faq_toc_header',
    '.toc_menu',
    '.toc_header_head',
    '.toc_header_info',
    '.toc_header_top',
    '.toc_toggle',
    '.toc_close',
    '.toc_next',
    '.toc_text',
    // Site chrome inside #faqwrap
    '#faq_header',
    '#faq_header_wrap',
    '#faq_bookmark',
    '#faq_search',
    '#faq_search_module',
    '#faq_search_results',
    '.faq_bookmark_jumper',
    // Top navigation + breadcrumb
    '.guide-nav',
    '.faqnav',
    '#faqnav',
    '.breadcrumbs',
    // Ad placements
    '[class*="advert"]',
    '[class*="ad-"]',
    '[id*="ad-"]',
    '[class*="sponsor"]',
    // Bottom metadata / contributor bar
    '.faqfooter',
    '.guide-footer',
    // Ratings / social
    '.faq-rating',
    '.rate-this',
    // GameFAQs header/footer (captured by page chrome removal too, but belt+suspenders)
    '#masthead',
    '#header',
    '#footer',
    '.site-header',
    '.site-footer',
    // Jump-to-section links (inline TOC)
    '.faqsubnav',
    // GameFAQs "Was this guide helpful?" bar
    '.guide-helpful',
    '[class*="helpful"]',
];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detect whether the raw HTML looks like a text/ASCII guide.
 * Text guides have a large <pre> block that holds all the content.
 * We can't parse those with the HTML parser — they need a plain-text path.
 */
export function isTextGuide($) {
    const pre = $('pre, .faqtext pre, #faqtext pre').first();
    if (!pre.length) return false;
    // Text guides have very long pre blocks (> 5000 chars)
    return (pre.text()?.length ?? 0) > 5000;
}

/**
 * Resolve the best content selector from the list above.
 * Returns the selector string that matched, or throws if none did.
 */
export function resolveContentSelector($) {
    for (const sel of CONTENT_SELECTORS) {
        try {
            if ($(sel).length > 0) {
                console.log(`    [adapter:gamefaqs] content selector: "${sel}"`);
                return sel;
            }
        } catch { /* invalid selector, skip */ }
    }
    throw new Error(
        `GameFAQs adapter: no content region found. ` +
        `Tried: ${CONTENT_SELECTORS.join(', ')}. ` +
        `The page may require a login or the URL may be wrong.`
    );
}

/**
 * The adapter descriptor passed to html-cleaner and content-parser.
 * Resolved lazily so the caller can pass in the right contentSelector.
 */
export function buildAdapter(contentSelector) {
    return {
        contentSelector,
        junkSelectors: JUNK_SELECTORS,
    };
}

/**
 * Extract the guide title from the page.
 * Tries guide-specific elements first, falls back to <title>.
 */
export function extractTitle($) {
    const candidates = [
        $('.faqhdr h1').first().text().trim(),
        $('.guide-title').first().text().trim(),
        $('h1.page-title').first().text().trim(),
        $('h1').first().text().trim(),
        $('title').text().replace(/\s*[-|].*$/, '').trim(), // strip " - GameFAQs" suffix
    ];
    return candidates.find(t => t.length > 0) ?? 'Untitled Guide';
}

/**
 * Extract the guide author if present.
 */
export function extractAuthor($) {
    const candidates = [
        $('.faqhdr .faqauth').first().text().trim(),
        $('[class*="author"]').first().text().trim(),
        $('[class*="contributor"]').first().text().trim(),
    ];
    return candidates.find(t => t.length > 0) ?? null;
}

/**
 * Build a nav entry label from a section slug.
 * "chapter-1-tsf" → "Chapter 1 Tsf" (title-cased, hyphens replaced)
 */
export function slugToLabel(slug) {
    return slug
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Extract the hierarchical nav tree from the .ftoc table of contents.
 *
 * Returns an array of nav nodes:
 *   { type: 'link',  slug, label }           — a leaf section link
 *   { type: 'group', label, children: [...] } — collapsible group
 *   { type: 'label', label }                  — non-link section divider
 *
 * Returns null if no .ftoc is found.
 */
export function extractNavTree($) {
    const rootOl = $('.ftoc ol').first();
    if (!rootOl.length) return null;

    const items = [];
    let pendingLabel = null;

    rootOl.children().each((_, el) => {
        const tag = el.tagName?.toLowerCase();
        const $el = $(el);

        if (tag === 'li') {
            const $a = $el.children('a').first();
            const $b = $el.children('b').first();

            if ($a.length) {
                if (pendingLabel) {
                    items.push({ type: 'label', label: pendingLabel });
                    pendingLabel = null;
                }
                const slug  = $a.attr('href')?.trim() ?? '';
                const label = $a.text().trim();
                if (slug) items.push({ type: 'link', slug, label });
            } else if ($b.length) {
                if (pendingLabel) {
                    // Previous header had no <ol> following it → standalone label
                    items.push({ type: 'label', label: pendingLabel });
                }
                pendingLabel = $b.text().trim();
            }
        } else if (tag === 'ol') {
            const children = [];
            $el.children('li').each((_, li) => {
                const $a = $(li).children('a').first();
                if ($a.length) {
                    const slug  = $a.attr('href')?.trim() ?? '';
                    const label = $a.text().trim();
                    if (slug) children.push({ type: 'link', slug, label });
                }
            });

            if (!children.length) return;

            if (pendingLabel) {
                // <b> label followed by <ol> → label group (no navigable page)
                items.push({ type: 'group', label: pendingLabel, children });
                pendingLabel = null;
            } else if (items.length > 0 && items[items.length - 1].type === 'link') {
                // <li><a> link followed by <ol> → the link IS a page AND has children.
                // Promote it to a group that keeps its slug so the header is navigable.
                const prev = items.pop();
                items.push({ type: 'group', label: prev.label, slug: prev.slug, children });
            }
        }
    });

    if (pendingLabel) items.push({ type: 'label', label: pendingLabel });

    return items.length ? items : null;
}

/**
 * Rewrite internal guide links so they point to relative paths.
 *
 * GameFAQs internal links: /ps5/503564-game/faqs/82117/section
 * Rewritten to:            ../section/   (relative from current section's dir)
 *
 * @param {string} html        - HTML string to rewrite
 * @param {string} faqId       - The FAQ ID (e.g. "82117")
 * @returns {string}
 */
export function rewriteInternalLinks(html, faqId) {
    return html.replace(
        new RegExp(`href="[^"]*\/faqs\/${faqId}\/([^/"?#]+)[^"]*"`, 'g'),
        (_, section) => `href="${section}"`
    );
}
