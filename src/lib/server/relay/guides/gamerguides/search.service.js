/**
 * Gamer Guides search service.
 *
 * Finds a game's guide on gamerguides.com by inferring the game slug from the
 * game name and verifying it resolves to a real guide page.
 *
 * URL pattern: https://www.gamerguides.com/{game-slug}/guide
 *
 * No browser needed — the guide landing page is server-rendered and we verify
 * via a plain HTTP HEAD/GET request. If the slug guess fails we try a short list
 * of common transformations before giving up.
 */

import * as cheerio from 'cheerio';

const BASE = 'https://www.gamerguides.com';

const FETCH_HEADERS = {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

/** Convert a game name to a Gamer Guides URL slug. */
function toSlug(name) {
    return name
        .toLowerCase()
        .replace(/['']/g, '')            // remove apostrophes
        .replace(/[^a-z0-9]+/g, '-')     // non-alnum → hyphen
        .replace(/^-+|-+$/g, '');        // trim edge hyphens
}

/**
 * Generate slug candidates from a game name.
 * Returns them in priority order.
 */
function slugCandidates(name) {
    const base = toSlug(name);
    const candidates = [base];

    // Without leading "the "
    if (base.startsWith('the-')) candidates.push(base.slice(4));

    // Remove subtitle after colon/dash (e.g. "resident-evil-2-remake" → "resident-evil-2")
    const dashIdx = base.lastIndexOf('-');
    if (dashIdx > 5) candidates.push(base.slice(0, dashIdx));

    // Numbered titles with/without dash: "persona-5" might work even if "persona-5-royal" does not
    const numberMatch = base.match(/^(.*?-\d+)/);
    if (numberMatch) candidates.push(numberMatch[1]);

    return [...new Set(candidates)];
}

/**
 * Check if a guide URL exists and return the canonical guide URL.
 * Gamer Guides redirects /{slug}/guide to the first chapter, so we follow
 * the redirect and capture the final URL from the canonical link.
 *
 * Returns { guideUrl, canonicalUrl, title } or null.
 */
async function verifyGuide(slug) {
    const url = `${BASE}/${slug}/guide`;
    try {
        const resp = await fetch(url, {
            headers: FETCH_HEADERS,
            signal: AbortSignal.timeout(10_000),
            redirect: 'follow',
        });
        if (!resp.ok) return null;

        const html = await resp.text();
        // Verify this is an actual guide page (not 404 page)
        if (!html.includes('guide-page-content') && !html.includes('guide-section-menu')) return null;

        const $ = cheerio.load(html);
        const title = $('h1').first().text().trim()
            || $('title').text().replace(/\s*\|.*$/, '').trim()
            || slug;
        const canonical = $('link[rel="canonical"]').attr('href') ?? resp.url;

        return { guideUrl: `${BASE}/${slug}/guide`, canonicalUrl: canonical, title };
    } catch {
        return null;
    }
}

/**
 * Search for a Gamer Guides guide for a given game name.
 *
 * @param {string} gameName
 * @returns {{ status, guideUrl?, gameSlug?, gameName?, score?, error? }}
 */
export async function searchGame(gameName) {
    const candidates = slugCandidates(gameName);

    for (const slug of candidates) {
        const result = await verifyGuide(slug);
        if (result) {
            return {
                status:   'found',
                guideUrl: result.guideUrl,
                gameSlug: slug,
                gameName: result.title || gameName,
                score:    slug === candidates[0] ? 1.0 : 0.8,
            };
        }
    }

    return { status: 'not_found' };
}
