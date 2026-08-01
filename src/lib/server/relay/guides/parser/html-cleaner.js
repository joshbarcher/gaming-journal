// Ported verbatim from relay-server src/services/guides/parser/html-cleaner.js (docs/relay-fold-in.md §6 — byte-identical logic).
/**
 * HTML cleaner — first pass over raw Puppeteer HTML.
 *
 * Responsibilities:
 *   1. Load the full page HTML into Cheerio
 *   2. Strip page chrome (nav, header, footer, ads, scripts, styles)
 *   3. Unwrap meaningless wrapper elements (span, div with no semantic role)
 *   4. Repeatedly collapse empty tags until the DOM stabilises
 *   5. Return the cleaned Cheerio root + the isolated content element
 *
 * The adapter (gamefaqs/adapter.js) tells us which selector to use for the
 * guide content region and which elements to strip as site-specific junk.
 */

import * as cheerio from 'cheerio';

// Tags that carry semantic meaning and must never be removed, only cleaned
const SEMANTIC_BLOCK = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'figure', 'figcaption', 'blockquote', 'pre', 'code']);

// Tags that are purely presentational wrappers — safe to unwrap if empty
const UNWRAP_IF_EMPTY = new Set(['div', 'section', 'article', 'aside', 'span', 'font', 'center', 'b', 'i', 'u', 'small', 'big']);

// Void elements have no inner HTML by design — never remove them as "empty"
const VOID_ELEMENTS = new Set(['img', 'br', 'hr', 'input', 'area', 'col', 'source', 'track', 'wbr']);

// Tags to always remove entirely (with their subtree)
const ALWAYS_REMOVE = ['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'svg', 'canvas', 'template', 'form', 'button', 'input', 'select', 'textarea', 'meta', 'link'];

// ── YouTube embeds ────────────────────────────────────────────────────────────
//
// Every route a video takes into a guide was destroyed before this:
//   <iframe src=".../embed/ID">      — in ALWAYS_REMOVE, deleted with its subtree
//   <div class="sharedFilePreviewYouTubeVideo" id="ID">  — Steam's embed is an EMPTY
//                                      div (the id is the video id), so collapseEmpties
//                                      pruned it as a spent wrapper
//   <a href="youtube.com/watch?v=ID"> — flattened to bare text by the external-link policy
//
// The first two are rewritten to a placeholder that survives cleaning and becomes a
// `video` ContentBlock; the third keeps its anchor (see cleanInlineHtml). Nothing here
// points at a player: content.json stores the canonical YouTube URL, and the viewer is
// what routes a reader to Tributary. See docs/features/guides/videos.md.

/** Attribute carrying the video id on a placeholder the content parser turns into a block. */
export const VIDEO_ATTR = 'data-yt-video';

const YT_HOSTS = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/i;

const isVideoId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id);

/**
 * The YouTube video id in a URL — watch, youtu.be, embed, shorts, v, live — or null.
 * Only absolute (or protocol-relative) URLs qualify: resolving a bare relative href
 * against youtube.com would make every internal wiki link look like a video.
 *
 * @param {string} rawUrl
 * @returns {string | null}
 */
export function youtubeId(rawUrl) {
    if (!rawUrl) return null;
    let u;
    try { u = new URL(rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl); }
    catch { return null; }
    if (!YT_HOSTS.test(u.hostname)) return null;

    const id = /(^|\.)youtu\.be$/i.test(u.hostname)
        ? u.pathname.slice(1).split('/')[0]
        : u.pathname === '/watch'
            ? u.searchParams.get('v')
            : u.pathname.match(/^\/(?:embed|shorts|v|live)\/([^/?#]+)/)?.[1];

    return isVideoId(id) ? id : null;
}

/** The canonical watch URL stored in content.json — one shape regardless of how it was embedded. */
export function youtubeWatchUrl(videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Rewrite YouTube embeds to `<div data-yt-video="ID">` placeholders. Must run before
 * ALWAYS_REMOVE and collapseEmpties, both of which delete the originals.
 */
function markVideoEmbeds($) {
    $('iframe[src]').each((_, el) => {
        const id = youtubeId($(el).attr('src'));
        if (id) $(el).replaceWith(`<div ${VIDEO_ATTR}="${id}"></div>`);
    });

    // Steam guides embed a video as an empty div whose id is the video id.
    $('div.sharedFilePreviewYouTubeVideo[id]').each((_, el) => {
        const id = $(el).attr('id');
        if (isVideoId(id)) $(el).replaceWith(`<div ${VIDEO_ATTR}="${id}"></div>`);
    });
}

// ── Core ──────────────────────────────────────────────────────────────────────

/**
 * Load raw HTML and return a Cheerio instance scoped to the guide content.
 *
 * @param {string}   html        - Raw HTML from Puppeteer
 * @param {object}   adapter     - { contentSelector, junkSelectors[] }
 * @returns {{ $: CheerioAPI, content: Cheerio<Element> }}
 */
export function loadAndClean(html, adapter) {
    const $ = cheerio.load(html, { decodeEntities: true });

    // 0. Unwrap selectors — replace element with its children (runs before ALWAYS_REMOVE
    //    so adapters can rescue content from inside tags like <button> that would
    //    otherwise be removed wholesale, e.g. IGN images inside <output><button><img>).
    for (const sel of (adapter.unwrapSelectors ?? [])) {
        try { $(sel).each((_, el) => $(el).replaceWith($(el).children())); } catch { /* ignore */ }
    }

    // 0.5. Rescue video embeds as placeholders — the next two steps would delete them.
    markVideoEmbeds($);

    // 1. Strip always-remove tags
    $(ALWAYS_REMOVE.join(', ')).remove();

    // 2. Strip site-specific junk selectors (ads, nav bars, TOC sidebar, etc.)
    for (const sel of (adapter.junkSelectors ?? [])) {
        try { $(sel).remove(); } catch { /* ignore bad selectors */ }
    }

    // 3. Isolate content region
    const content = $(adapter.contentSelector);
    if (!content.length) {
        throw new Error(
            `Content selector "${adapter.contentSelector}" matched nothing. ` +
            `The guide may be a text-format FAQ or the selectors need updating.`
        );
    }

    // 4. Within content: strip remaining navigation-like elements
    content.find('nav, [role="navigation"], .breadcrumb, .pagination').remove();

    // 5. Collapse empty tags (runs until stable)
    collapseEmpties($, content);

    return { $, content };
}

/**
 * Repeatedly remove tags that are empty or contain only whitespace,
 * until the DOM no longer changes. This unravels nested empty wrappers
 * left after junk removal.
 */
function collapseEmpties($, root) {
    let changed = true;
    let passes  = 0;

    while (changed && passes < 20) {
        changed = false;
        passes++;

        root.find('*').each((_, el) => {
            const $el  = $(el);
            const tag  = el.tagName?.toLowerCase();

            if (!tag || SEMANTIC_BLOCK.has(tag) || VOID_ELEMENTS.has(tag)) return;
            // Named anchors (<a id="..."> / <a name="...">) are navigation targets — never remove
            if (tag === 'a' && ($el.attr('id') || $el.attr('name'))) return;
            // Video placeholders are empty by design — the id attribute IS the content
            if ($el.attr(VIDEO_ATTR)) return;

            const inner = $el.html()?.trim() ?? '';
            if (inner === '') {
                $el.remove();
                changed = true;
            }
        });
    }

    if (passes >= 20) {
        console.warn('[html-cleaner] collapseEmpties hit pass limit — possible cycle');
    }
}

/**
 * Sanitise inline HTML within a paragraph or list item.
 * Keeps: strong, em, a (policy-dependent), code
 * Strips (unwraps): span, font, b→strong, i→em
 * Removes: br (policy-dependent), everything else
 *
 * Returns a cleaned HTML string.
 */
export function cleanInlineHtml(rawHtml, cfg) {
    const $ = cheerio.load(`<div id="__inline">${rawHtml}</div>`, { decodeEntities: true });
    const root = $('#__inline');

    // Normalise b→strong, i→em
    root.find('b').each((_, el) => {
        const $el = $(el);
        $el.replaceWith(`<strong>${$el.html()}</strong>`);
    });
    root.find('i').each((_, el) => {
        const $el = $(el);
        $el.replaceWith(`<em>${$el.html()}</em>`);
    });

    // Handle <br> — always strip when behavior is 'strip', otherwise keep.
    if (cfg.br.behavior === 'strip') {
        root.find('br').replaceWith(' ');
    }

    // Strip (unwrap) spans and font tags — keep their text/children
    root.find('span, font, small, big, u, s, strike, sup, sub').each((_, el) => {
        $(el).replaceWith($(el).html() ?? '');
    });

    // Remove anything else that isn't an allowed inline tag.
    // br is included so it survives when behavior !== 'strip'.
    const KEEP_INLINE = new Set(['strong', 'em', 'code', 'a', 'abbr', 'br']);
    root.find('*').each((_, el) => {
        const tag = el.tagName?.toLowerCase();
        if (tag && !KEEP_INLINE.has(tag)) {
            $(el).replaceWith($(el).html() ?? '');
        }
    });

    // Strip all attributes from semantic inline tags — they should carry no styling.
    // <a> is handled separately below (needs href).
    root.find('strong, em, code, abbr').each((_, el) => {
        Object.keys(el.attribs ?? {}).forEach(attr => $(el).removeAttr(attr));
    });

    // Handle <a> link policy.
    // A link is only "external" if it carries an absolute URI scheme (http://, https://, ...).
    // Bare relative hrefs like href="wrenwood-hotel" or href="../section/" are internal.
    root.find('a').each((_, el) => {
        const $a  = $(el);
        const href = $a.attr('href') ?? '';

        // YouTube links outlive the external-link policy. Stripping one deletes the only
        // pointer to the video — the text left behind ("this video") points nowhere. The
        // href stays canonical YouTube; `data-yt` is the viewer's hook for routing the
        // click to the Tributary player instead.
        const videoId = youtubeId(href);
        if (videoId) {
            Object.keys(el.attribs ?? {}).forEach(attr => $(el).removeAttr(attr));
            $a.attr('href', href.startsWith('//') ? `https:${href}` : href);
            $a.attr('data-yt', videoId);
            return;
        }

        const isExternal = /^[a-z][a-z0-9+\-.]*:\/\//i.test(href);
        if (isExternal && !cfg.links.keepExternal) {
            $a.replaceWith($a.text());
            return;
        }
        // Keep only href — strip class, style, target, rel, etc.
        Object.keys(el.attribs ?? {}).forEach(attr => {
            if (attr !== 'href') $(el).removeAttr(attr);
        });
    });

    // Final safety pass: strip any style/class that survived the above steps.
    // This catches cases where replaceWith didn't fully unwrap (e.g. Cheerio edge cases
    // with mixed text+element content inside spans).
    root.find('[style],[class]').each((_, el) => {
        $(el).removeAttr('style').removeAttr('class');
    });

    // Collapse consecutive <br> tags (with optional whitespace between) into one.
    return (root.html()?.trim() ?? '').replace(/(<br\s*\/?>(\s|&nbsp;)*)+/gi, '<br>');
}
