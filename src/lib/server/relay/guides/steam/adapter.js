/**
 * Steam community guide adapter.
 *
 * Each page file saved by the fetcher contains exactly one guide section:
 *
 *   <div class="workshopItemTitle">…</div>   ← guide-level title (for extractTitle)
 *   <div class="friendBlockContent">…</div>  ← author name, already cleaned (for extractAuthor)
 *   <div class="subSectionDesc">…</div>      ← BBCode-rendered section content
 *
 * BBCode headings are rendered by Steam as custom divs, not <h*> tags:
 *   [h1] → <div class="bb_h1">…</div>
 *   [h2] → <div class="bb_h2">…</div>
 *   [h3] → <div class="bb_h3">…</div>
 * preprocessRawHtml() converts these before the content parser sees them.
 *
 * Images are wrapped in <a class="modalContentLink"> for Steam's popup viewer.
 * buildAdapter() returns unwrapSelectors: ['a.modalContentLink'] so html-cleaner
 * strips those wrappers, leaving the <img> in place. The img.src already points
 * to the full-size Steam CDN URL — no transformImageUrl needed.
 *
 * extractNavTree() builds a flat link list from manifestPages (the fetcher stores
 * the original Steam section labels there). No DOM reading needed.
 */

// ── Content selectors ─────────────────────────────────────────────────────────

const CONTENT_SELECTORS = [
    '.subSectionDesc',  // per-section files written by steam fetcher
    '.guide',           // fallback: full raw guide container
];

// Minimal junk in per-section files — they contain only the section body.
// subSectionTitle is the outer section heading (not in subSectionDesc) so no need to strip it.
const JUNK_SELECTORS = [];

// ── Public API ────────────────────────────────────────────────────────────────

export function resolveContentSelector($) {
    for (const sel of CONTENT_SELECTORS) {
        try {
            if ($(sel).length > 0) {
                console.log(`    [adapter:steam] content selector: "${sel}"`);
                return sel;
            }
        } catch { /* invalid selector */ }
    }
    throw new Error(
        `Steam adapter: no guide content region found. ` +
        `Tried: ${CONTENT_SELECTORS.join(', ')}. ` +
        `The guide may require login or be deleted.`
    );
}

export function buildAdapter(contentSelector) {
    return {
        contentSelector,
        junkSelectors:   JUNK_SELECTORS,
        // Strip the <a class="modalContentLink"> image popup wrapper; keep the inner <img>.
        // html-cleaner unwraps these before ALWAYS_REMOVE runs, so the <img> survives.
        unwrapSelectors: ['a.modalContentLink'],
    };
}

/**
 * Preprocess raw Steam HTML before content parsing.
 *
 * Converts BBCode-rendered heading divs to standard <h*> elements.
 * bb_h* divs contain only inline content (text/bold) — never nested divs —
 * so a non-greedy match up to the first </div> is safe.
 */
// eslint-disable-next-line no-unused-vars
export function preprocessRawHtml(html, _guideId) {
    return html
        .replace(/<div class="bb_h1">([\s\S]*?)<\/div>/gi, '<h1>$1</h1>')
        .replace(/<div class="bb_h2">([\s\S]*?)<\/div>/gi, '<h2>$1</h2>')
        .replace(/<div class="bb_h3">([\s\S]*?)<\/div>/gi, '<h3>$1</h3>')
        .replace(/<div class="bb_hr"\s*\/?\s*><\/div>/gi,  '<hr>')
        .replace(/<div class="bb_hr"\s*\/>/gi,             '<hr>');
}

/**
 * Extract the guide-level title.
 * The fetcher embeds <div class="workshopItemTitle"> in every section file.
 */
export function extractTitle($) {
    return (
        $('div.workshopItemTitle').first().text().trim() ||
        $('title').text().replace(/\s*—.*$/, '').trim() ||
        'Steam Guide'
    );
}

/**
 * Extract the guide author.
 * The fetcher cleans the author text (strips the Steam "Offline"/"Online" status)
 * before embedding it as <div class="friendBlockContent">.
 */
export function extractAuthor($) {
    return $('div.friendBlockContent').first().text().trim() || null;
}

/**
 * Build a flat nav tree from the manifest page list.
 * The fetcher stores the original Steam section labels in page.label.
 */
// eslint-disable-next-line no-unused-vars
export function extractNavTree(_$, _guideId, manifestPages) {
    if (!manifestPages?.length) return null;
    return manifestPages.map(p => ({
        type:  'link',
        slug:  p.slug,
        label: p.label ?? slugToLabel(p.slug),
    }));
}

/**
 * Convert a section slug back to a readable label.
 * Used by parse-guide.js for flat nav and _meta.json page list.
 */
export function slugToLabel(slug) {
    return slug
        .replace(/-/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Steam guides have no internal cross-section links — nothing to rewrite.
 */
// eslint-disable-next-line no-unused-vars
export function rewriteInternalLinks(html, _guideId, _knownSlugs) {
    return html;
}
