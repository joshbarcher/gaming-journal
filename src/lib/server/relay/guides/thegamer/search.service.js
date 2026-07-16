/**
 * TheGamer (thegamer.com) guide search service.
 *
 * TheGamer has no predictable per-game guide URL, but it DOES have a per-game
 * "tag" page that lists every article for that game:
 *
 *   https://www.thegamer.com/tag/{game-slug}/     e.g. /tag/persona-5-royal/
 *
 * We derive tag-slug candidates from the game name, fetch the first tag page
 * that exists, and return its guide/walkthrough articles. This queries TheGamer
 * directly — no search engine — so it isn't subject to DuckDuckGo/Bing anti-bot
 * throttling (which returns empty 202/challenge pages for automated queries).
 *
 * Because the tag page is already game-specific, every article is relevant — no
 * fuzzy name matching is needed. Any walkthrough entry point is enough: the
 * download crawl expands it to the full guide set via the in-article directory.
 */

import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin  from 'puppeteer-extra-plugin-stealth';
import * as cheerio   from 'cheerio';

import { pageSlugFromHref, slugToLabel } from './adapter.js';

puppeteerExtra.use(StealthPlugin());

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const ROMAN = { i:1, ii:2, iii:3, iv:4, v:5, vi:6, vii:7, viii:8, ix:9, x:10, xi:11, xii:12, xiii:13, xiv:14, xv:15, xvi:16 };

// Single-segment slugs that are site sections / nav, not game articles.
const SECTION_DENYLIST = new Set([
    'trending-guides', 'aaa-games', 'live-service-games', 'indie-games', 'streaming',
    'movies-tv-anime', 'movies-and-tv', 'videos', 'reviews-previews', 'reviews', 'previews',
    'features', 'news', 'guides', 'lists', 'podcast', 'about-us', 'contact-us', 'newsletter',
]);

// Article slugs/titles that look like guide content (as opposed to news/opinion).
// Word-boundary anchored so "completely"/"competition" in a listicle slug don't match.
const GUIDE_RE = /\b(walkthrough|guides?|complete|how-to|locations?|trophies|achievements|boss|quests?|tips|best)\b/i;

// ── Slug candidates ─────────────────────────────────────────────────────────

function baseKebab(name) {
    return name
        .toLowerCase()
        .replace(/[™®©]/g, '')
        .replace(/['’]/g, '')            // Baldur's → baldurs
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Tag-slug candidates for a game name, in priority order.
 * "Persona 5 Royal"  → ["persona-5-royal"]
 * "Baldur's Gate 3"  → ["baldurs-gate-3"]
 * "Final Fantasy VII"→ ["final-fantasy-vii", "final-fantasy-7"]  (roman + arabic)
 */
export function tagSlugCandidates(gameName) {
    const base   = baseKebab(gameName);
    const words  = base.split(' ');
    const variants = new Set();

    variants.add(words.join('-'));

    // Roman ↔ arabic numeral variant
    const romanToArabic = words.map(w => (ROMAN[w] != null ? String(ROMAN[w]) : w)).join('-');
    variants.add(romanToArabic);

    // Drop trailing edition/qualifier noise words
    const STOP = new Set(['the', 'a', 'an', 'of', 'edition', 'remastered', 'remaster', 'definitive']);
    const trimmed = words.filter(w => !STOP.has(w)).join('-');
    if (trimmed) variants.add(trimmed);

    return [...variants].filter(Boolean);
}

// ── Browser ─────────────────────────────────────────────────────────────────

export async function launchBrowser() {
    return puppeteerExtra.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
}

async function setupPage(browser) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9', 'DNT': '1' });
    await page.setRequestInterception(true);
    page.on('request', req => (['media', 'font', 'image'].includes(req.resourceType()) ? req.abort() : req.continue()));
    return page;
}

// ── Tag page ────────────────────────────────────────────────────────────────

/**
 * Fetch one tag page and return its guide articles [{ slug, title }] (deduped,
 * page order preserved). Returns null if the tag page 404s or has no articles.
 */
async function fetchTagArticles(browser, tagSlug, { debug = false } = {}) {
    const url  = `https://www.thegamer.com/tag/${tagSlug}/`;
    const page = await setupPage(browser);
    try {
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        if (!res || res.status() >= 400) { if (debug) console.log(`  [debug:thegamer] tag ${tagSlug} → HTTP ${res?.status()}`); return null; }
        await sleep(700 + Math.random() * 400);

        const $ = cheerio.load(await page.content());
        const seen = new Set();
        const articles = [];

        // Scope to article-card regions when present, else fall back to the page.
        const scope = $('main').length ? $('main') : $.root();
        scope.find('a[href]').each((_, el) => {
            const slug = pageSlugFromHref($(el).attr('href'));
            if (!slug || seen.has(slug) || SECTION_DENYLIST.has(slug)) return;
            let title = $(el).text().trim();
            if (!GUIDE_RE.test(slug) && !GUIDE_RE.test(title)) return; // guides only
            // Some anchors are video thumbnails whose text is a duration ("1:58") — use the slug label.
            if (!title || /^\d+:\d+$/.test(title) || title.length < 4) title = slugToLabel(slug);
            seen.add(slug);
            articles.push({ slug, title });
        });

        if (debug) console.log(`  [debug:thegamer] tag ${tagSlug} → ${articles.length} guide articles`);
        return articles.length ? articles : null;
    } catch (err) {
        if (debug) console.log(`  [debug:thegamer] tag ${tagSlug} error: ${err.message}`);
        return null;
    } finally {
        await page.close();
    }
}

// Rank the best crawl entry points first: complete-guide hubs, then walkthroughs, then guides.
function guideScore(slug) {
    let s = 0;
    if (/\bcomplete\b/.test(slug))        s += 3;
    if (/\bwalkthrough\b/.test(slug))     s += 2;
    if (/-guides?\b/.test(slug))          s += 1;
    return s;
}

// ── Public: searchGame ──────────────────────────────────────────────────────

/**
 * @returns {{ status: 'found'|'not_found'|'error', guides?: Array<{title,url,slug,score}>, error? }}
 */
export async function searchGame(browser, gameName, { limit = 15, debug = false } = {}) {
    try {
        const candidates = tagSlugCandidates(gameName);
        if (debug) console.log(`  [debug:thegamer] tag candidates: ${candidates.join(', ')}`);

        for (const tagSlug of candidates) {
            const articles = await fetchTagArticles(browser, tagSlug, { debug });
            if (!articles) { await sleep(500 + Math.random() * 400); continue; }

            const guides = articles
                .map(a => ({
                    title: a.title,
                    url:   `https://www.thegamer.com/${a.slug}/`,
                    slug:  a.slug,
                    score: guideScore(a.slug),
                }))
                .sort((a, b) => b.score - a.score)
                .slice(0, limit);

            return { status: 'found', guides };
        }

        return { status: 'not_found' };
    } catch (err) {
        return { status: 'error', error: err.message };
    }
}
