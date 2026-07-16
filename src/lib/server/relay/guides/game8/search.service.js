/**
 * Game8 wiki guide search service.
 *
 * Game8 game pages use a predictable Title-Case-Kebab slug pattern:
 *   game8.co/games/Octopath-Traveler-2
 *   game8.co/games/Monster-Hunter-Stories-3
 *
 * Strategy:
 *   1. Generate Title-Case-Kebab slug candidates from the game name
 *   2. HEAD-probe each slug — first 200 wins
 *   3. Fallback: DuckDuckGo `site:game8.co "{gameName}" walkthrough`
 */

import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin  from 'puppeteer-extra-plugin-stealth';
import * as cheerio   from 'cheerio';

puppeteerExtra.use(StealthPlugin());

// ── Helpers ───────────────────────────────────────────────────────────────────

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const ROMAN = {
    i:1, ii:2, iii:3, iv:4, v:5, vi:6, vii:7, viii:8, ix:9,
    x:10, xi:11, xii:12, xiii:13, xiv:14, xv:15, xvi:16, xvii:17,
    xviii:18, xix:19, xx:20, xxi:21, xxii:22, xxiii:23, xxiv:24, xxv:25,
};

export function normalize(name) {
    return name
        .toLowerCase()
        .replace(/[™®©]/g, '')
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b(x{0,3}(?:ix|iv|v?i{0,3}))\b/g, w => ROMAN[w] != null ? String(ROMAN[w]) : w);
}

export function nameSimilarity(a, b) {
    const na = normalize(a);
    const nb = normalize(b);
    if (na === nb) return 1.0;
    if (na.startsWith(nb) || nb.startsWith(na)) return 0.9;

    const keep = w => /^\d+$/.test(w) || w.length > 2;
    const wa = na.split(' ').filter(keep);
    const wb = new Set(nb.split(' ').filter(keep));
    if (wa.length === 0) return 0;
    const shared = wa.filter(w => wb.has(w)).length;
    return shared / Math.max(wa.length, wb.size);
}

/**
 * Convert a game name to candidate Game8 slug variants.
 * Game8 uses Title-Case-Kebab: "Monster Hunter Stories 3" → "Monster-Hunter-Stories-3"
 */
export function nameToCandidateSlugs(name) {
    const words = name
        .replace(/[™®©]/g, '')
        .replace(/[^a-zA-Z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ');

    // Title-Case-Kebab (Game8's primary format)
    const titleKebab = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('-');

    // Lowercase kebab fallback
    const lowerKebab = words.map(w => w.toLowerCase()).join('-');

    const variants = new Set([titleKebab]);
    if (lowerKebab !== titleKebab.toLowerCase()) variants.add(lowerKebab);

    // Without common noise words
    const STOP = new Set(['the', 'and', 'of', 'in', 'a', 'an', 'to', 'for']);
    const filteredTitle = words.filter(w => !STOP.has(w.toLowerCase())).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('-');
    if (filteredTitle && filteredTitle !== titleKebab) variants.add(filteredTitle);

    return [...variants].filter(s => s.length > 0);
}

// ── Browser setup ─────────────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export async function launchBrowser() {
    const browser = await puppeteerExtra.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    return browser;
}

async function setupPage(browser) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'DNT': '1',
    });
    await page.setRequestInterception(true);
    page.on('request', req => {
        if (['media', 'font', 'image'].includes(req.resourceType())) req.abort();
        else req.continue();
    });
    return page;
}

// ── Direct slug probe ─────────────────────────────────────────────────────────

async function probeSlug(browser, slug) {
    const url  = `https://game8.co/games/${slug}`;
    const page = await setupPage(browser);
    try {
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        const status = res?.status() ?? 0;
        if (status === 404 || status >= 400) return null;

        const finalUrl = page.url();
        if (!finalUrl.includes('/games/')) return null;

        // Extract game name from <h1> or page title
        const $ = cheerio.load(await page.content());
        const h1 = $('.p-archiveHeader__title, .p-gameHeader__game_title, h1').first().text().trim();
        const pageTitle = $('title').text().replace(/\s*\|.*$/, '').replace(/\s*Walkthrough.*$/i, '').trim();
        const name = h1 || pageTitle;

        // Game8 serves the page at the probed URL but uses correct casing in archive links.
        // Extract the real slug from the first archive link, fall back to URL slug.
        const archiveSlug = $('a[href*="/archives/"]').first().attr('href')
            ?.match(/\/games\/([^/]+)\/archives\//)?.[1];
        const canonicalSlug = archiveSlug ?? finalUrl.match(/\/games\/([^/?#]+)/)?.[1] ?? slug;

        return { slug: canonicalSlug, name, url: finalUrl };
    } catch {
        return null;
    } finally {
        await page.close();
    }
}

// ── DuckDuckGo fallback ───────────────────────────────────────────────────────

const GAME8_RE = /game8\.co\/games\/([A-Za-z0-9-]+)(?:\/|$)/i;

async function searchViaDuckDuckGo(browser, gameName, { debug = false } = {}) {
    const query = `site:game8.co/games "${gameName}" walkthrough wiki`;
    const url   = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9', 'DNT': '1' });
    await page.setRequestInterception(true);
    page.on('request', req => {
        if (['media', 'font', 'image'].includes(req.resourceType())) req.abort();
        else req.continue();
    });

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await sleep(600 + Math.random() * 400);
        const html = await page.content();

        const $ = cheerio.load(html);
        const seen = new Set();
        const candidates = [];

        $('a.result__a, a.result__url, .result a[href]').each((_, el) => {
            const href = $(el).attr('href') ?? '';
            let resolved = href;
            try {
                const u = new URL(href, 'https://html.duckduckgo.com');
                resolved = u.searchParams.get('uddg') ?? u.searchParams.get('u') ?? href;
            } catch { /* use href as-is */ }

            const m = resolved.match(GAME8_RE);
            if (!m) return;

            const gameSlug = m[1];
            if (seen.has(gameSlug)) return;
            seen.add(gameSlug);

            const linkText = $(el).text().trim()
                .replace(/\s*Walkthrough.*$/i, '')
                .replace(/\s*Wiki.*$/i, '')
                .replace(/\s*[-–|].*$/, '')
                .trim();
            const score = nameSimilarity(gameName, linkText || gameSlug.replace(/-/g, ' '));

            if (debug) console.log(`  [debug:game8] ddg candidate: "${linkText}" slug=${gameSlug} score=${score.toFixed(2)}`);
            if (score < 0.25) return;

            candidates.push({
                gameSlug,
                gameName: linkText || gameSlug.replace(/-/g, ' '),
                gameUrl:  `https://game8.co/games/${gameSlug}`,
                score,
            });
        });

        return candidates.sort((a, b) => b.score - a.score);
    } finally {
        await page.close();
    }
}

// ── Public: searchGame ────────────────────────────────────────────────────────

/**
 * Search Game8 for a game's wiki page.
 *
 * @param {Browser} browser
 * @param {string}  gameName  - Steam game name
 * @param {object}  [opts]
 * @param {boolean} [opts.debug]
 * @param {number}  [opts.minScore=0.6]
 *
 * @returns {{ status: 'found'|'not_found'|'error', gameSlug?, gameName?, gameUrl?, score?, error? }}
 */
export async function searchGame(browser, gameName, { debug = false, minScore = 0.6 } = {}) {
    try {
        // ── Phase 1: direct slug probe ────────────────────────────────────────
        const candidateSlugs = nameToCandidateSlugs(gameName);
        if (debug) console.log(`  [debug:game8] probing slugs: ${candidateSlugs.join(', ')}`);

        for (const slug of candidateSlugs) {
            const result = await probeSlug(browser, slug);
            if (!result) continue;

            const score = nameSimilarity(gameName, result.name);
            if (debug) console.log(`  [debug:game8] probe hit: slug=${slug} name="${result.name}" score=${score.toFixed(2)}`);

            if (score >= minScore) {
                return { status: 'found', gameSlug: result.slug, gameName: result.name, gameUrl: result.url, score };
            }

            await sleep(800 + Math.random() * 500);
        }

        // ── Phase 2: DuckDuckGo fallback ─────────────────────────────────────
        if (debug) console.log(`  [debug:game8] slug probe missed, trying DuckDuckGo…`);
        const ddgResults = await searchViaDuckDuckGo(browser, gameName, { debug });

        if (ddgResults.length === 0 || ddgResults[0].score < minScore) {
            return { status: 'not_found' };
        }

        const top = ddgResults[0];
        await sleep(1000 + Math.random() * 500);
        const confirmed = await probeSlug(browser, top.gameSlug);
        if (!confirmed) return { status: 'not_found' };

        const titleScore = nameSimilarity(gameName, confirmed.name);
        if (titleScore < minScore) return { status: 'not_found' };

        return {
            status:   'found',
            gameSlug: confirmed.slug,
            gameName: confirmed.name,
            gameUrl:  confirmed.url,
            score:    titleScore,
        };

    } catch (err) {
        return { status: 'error', error: err.message };
    }
}
