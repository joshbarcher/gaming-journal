/**
 * Steam community guide search service.
 *
 * Fetches the top-rated guides from specific categories on the Steam community
 * guides listing page. Categories are fetched in parallel and merged in priority
 * order: Walkthroughs → Achievements → Secrets → Loot → Story Or Lore.
 *
 * URL scraped: https://steamcommunity.com/app/{appid}/guides/?browsefilter=trend&requiredtags[]={tag}&p=1
 *
 * No authentication needed — the page is publicly accessible.
 */

import * as cheerio from 'cheerio';

const MAX_PER_CATEGORY = 10;  // guides shown per tab
const MAX_CANDIDATES   = 30;  // candidates fetched per category before dedup

// Categories fetched in priority order.
// Tag values must match Steam's internal tag names exactly (case-sensitive).
const CATEGORIES = [
    'Walkthroughs',
    'Achievements',
    'Secrets',
    'Loot',
    'Story or Lore',
];

const FETCH_HEADERS = {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    // Bypass Steam's content gates without a real login session.
    // birthtime/lastagecheckage: store-page age gate (born 1979).
    // wants_mature_content + content_descriptors_accepted: community-page content gate.
    // Anonymous sessions default to excluding descriptors 1,3,4 (nudity/sexual/adult content).
    'Cookie':          'birthtime=283996801; lastagecheckage=1-0-1979; mature_content=1; wants_mature_content=1; content_descriptors_accepted=1,3,4',
};

// Require at least one Unicode letter or digit — filters braille blank spam (U+2800).
const MEANINGFUL = new RegExp('\\p{L}|\\p{N}', 'u');
const LETTER     = new RegExp('\\p{L}', 'u');
const LATIN      = new RegExp('\\p{Script=Latin}', 'u');

// High-confidence non-English whole-words that don't appear in English.
const NON_ENGLISH_WORDS = /\b(todos|todas|toutes|tous|tutti|tutte|como|pour|avec|dans|guia|alle)\b/i;

// Returns false if the title contains any non-Latin letters (Cyrillic, Arabic,
// CJK, etc.), any non-ASCII letters (catches Polish ą/ę/ł, French é/ç, etc.),
// or known non-English words. English guide titles use only ASCII letters.
function isEnglishTitle(title) {
    const letters = [...title].filter(c => LETTER.test(c));
    if (letters.length === 0) return true;
    if (letters.some(c => !LATIN.test(c))) return false;        // any non-Latin = reject
    if (letters.some(c => c.charCodeAt(0) > 127)) return false; // any non-ASCII letter = reject
    if (NON_ENGLISH_WORDS.test(title)) return false;
    return true;
}

const MAX_PAGES = 5;

async function fetchCategory(appid, category) {
    const results = [];
    const seenIds = new Set();

    for (let page = 1; page <= MAX_PAGES && results.length < MAX_CANDIDATES; page++) {
        // Build URL manually — URLSearchParams encodes [] as %5B%5D which Steam
        // doesn't recognise, so the tag filter would be silently ignored.
        const url = `https://steamcommunity.com/app/${appid}/guides/?browsefilter=trend&requiredtags[]=${encodeURIComponent(category)}&requiredtags[]=english&p=${page}`;
        const resp = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(15_000) });
        if (!resp.ok) break;

        const $ = cheerio.load(await resp.text());
        let found = 0;

        $('a.workshopItemCollection').each((_, el) => {
            const href  = $(el).attr('href') ?? '';
            const title = $(el).find('.workshopItemTitle').text().trim();

            if (!title || !MEANINGFUL.test(title) || !isEnglishTitle(title)) return;

            let guideId;
            try { guideId = new URL(href).searchParams.get('id'); } catch { return; }
            if (!guideId || seenIds.has(guideId)) return;

            seenIds.add(guideId);
            found++;
            results.push({
                title,
                url:      `https://steamcommunity.com/sharedfiles/filedetails/?id=${guideId}`,
                type:     'html',
                category,
                guideId,
            });
        });

        if (found === 0) break; // page was empty — no more results
    }

    return results;
}

/**
 * Search for Steam community guides for a given appid.
 *
 * @param {string|number} appid    - Steam appid
 * @param {string}        gameName - Human-readable game name (used for matchedGame label)
 * @returns {{ status, guides?, matchedGame?, error? }}
 */
export async function searchGame(appid, gameName) {
    try {
        // Fetch all categories in parallel
        const settled = await Promise.allSettled(
            CATEGORIES.map(cat => fetchCategory(appid, cat))
        );

        // Assign each guide to its highest-priority category (Walkthroughs first).
        // A guide claimed by an earlier category is skipped in later ones.
        // Each category fills up to MAX_PER_CATEGORY from what remains unclaimed.
        const claimed    = new Set();
        const categories = {};
        const allGuides  = [];

        for (let i = 0; i < CATEGORIES.length; i++) {
            const cat    = CATEGORIES[i];
            const result = settled[i];
            if (result.status !== 'fulfilled') { categories[cat] = []; continue; }

            const catList = [];
            for (const guide of result.value) {
                if (claimed.has(guide.guideId)) continue;
                claimed.add(guide.guideId);
                const { guideId, ...rest } = guide;
                catList.push(rest);
                allGuides.push(rest);
                if (catList.length >= MAX_PER_CATEGORY) break;
            }
            categories[cat] = catList;
        }

        if (allGuides.length === 0) {
            return { status: 'not_found' };
        }

        return {
            status:      'found',
            guides:      allGuides,
            categories,
            matchedGame: {
                name:    gameName,
                gameUrl: `https://store.steampowered.com/app/${appid}`,
                score:   1.0,
            },
        };

    } catch (err) {
        return { status: 'error', error: err.message };
    }
}
