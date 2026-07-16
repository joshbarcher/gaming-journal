/**
 * GameFAQs guide search service.
 * Extracted from discover-guides.js so both the discover script and the
 * search-guides tool can share the same browser + matching logic.
 */

import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin  from 'puppeteer-extra-plugin-stealth';
import * as cheerio   from 'cheerio';

puppeteerExtra.use(StealthPlugin());

// ── Timing ────────────────────────────────────────────────────────────────────

const BETWEEN_PAGES_MIN = 1500;
const BETWEEN_PAGES_MAX = 3200;

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
export function jitter(min, max) { return min + Math.floor(Math.random() * (max - min)); }

// ── Name matching ─────────────────────────────────────────────────────────────

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

export function nameSimilarity(steamName, gfaqName) {
    const a = normalize(steamName);
    const b = normalize(gfaqName);
    if (a === b) return 1.0;
    if (a.startsWith(b) || b.startsWith(a)) return 0.9;

    const keep = w => /^\d+$/.test(w) || w.length > 2;
    const wa = a.split(' ').filter(keep);
    const wb = new Set(b.split(' ').filter(keep));
    if (wa.length === 0) return 0;
    const shared = wa.filter(w => wb.has(w)).length;
    return shared / Math.max(wa.length, wb.size);
}

const PLAT_SCORE = {
    ps5: 10, 'playstation-5': 10,
    ps4: 9,  'playstation-4': 9,
    switch: 8, ns: 8,
    pc: 7, windows: 7,
    xboxone: 7, 'xbox-one': 7,
    ps3: 5, 'playstation-3': 5,
    xbox360: 5,
    ps2: 3, 'playstation-2': 3,
    psp: 3,
    ps1: 2, playstation: 2,
    gba: 1, ds: 1, '3ds': 1,
};

export function platScore(platform) {
    return PLAT_SCORE[platform?.toLowerCase()] ?? 4;
}

// ── Browser ───────────────────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export async function setupPage(browser) {
    const page = await browser.newPage();

    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(window.screen, 'width',       { get: () => 1920 });
        Object.defineProperty(window.screen, 'height',      { get: () => 1080 });
        Object.defineProperty(window.screen, 'availWidth',  { get: () => 1920 });
        Object.defineProperty(window.screen, 'availHeight', { get: () => 1040 });
        Object.defineProperty(window.screen, 'colorDepth',  { get: () => 24 });
        Object.defineProperty(window.screen, 'pixelDepth',  { get: () => 24 });
    });

    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'DNT': '1',
    });
    await page.setRequestInterception(true);
    page.on('request', req => {
        if (['media', 'font', 'image'].includes(req.resourceType())) req.abort();
        else req.continue();
    });
    return page;
}

export async function launchBrowser() {
    const browser = await puppeteerExtra.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });

    const page = await setupPage(browser);
    try {
        await page.goto('https://gamefaqs.gamespot.com', { waitUntil: 'domcontentloaded', timeout: 20_000 });
        await sleep(1500 + Math.random() * 1000);
    } catch { /* non-fatal */ }
    await page.close();

    return browser;
}

// ── Parsing ───────────────────────────────────────────────────────────────────

const GAME_HREF_RE = /^\/([a-z0-9-]+)\/(\d+)-([a-z0-9-]+)(?:\/faqs)?(?:\/|$)/i;
const SKIP_PLATFORM = new Set([
    'boards', 'images', 'answers', 'reviews', 'cheats',
    'news', 'contribute', 'user', 'community', 'features',
]);

function hrefToPath(href) {
    try { return new URL(href, 'https://gamefaqs.gamespot.com').pathname; }
    catch { return href; }
}

export function parseSearchResults(html, steamName, { debug = false } = {}) {
    const $ = cheerio.load(html);
    const seen = new Set();
    const candidates = [];

    $('a[href]').each((_, el) => {
        const path = hrefToPath($(el).attr('href') ?? '');
        const m = path.match(GAME_HREF_RE);
        if (!m) return;

        const [, platform, gameId, slug] = m;
        if (SKIP_PLATFORM.has(platform.toLowerCase())) return;

        const key = `${platform}/${gameId}`;
        if (seen.has(key)) return;
        seen.add(key);

        const name = $(el).text().trim();
        if (!name || name.length < 2) return;

        const score = nameSimilarity(steamName, name);
        if (debug) console.log(`  [debug] candidate: "${name}" platform=${platform} score=${score.toFixed(2)}`);
        if (score < 0.25) return;

        candidates.push({
            name,
            platform,
            gameId,
            slug,
            gameUrl:   `https://gamefaqs.gamespot.com/${platform}/${gameId}-${slug}`,
            faqsUrl:   `https://gamefaqs.gamespot.com/${platform}/${gameId}-${slug}/faqs`,
            score,
            platScore: platScore(platform),
        });
    });

    return candidates.sort((a, b) =>
        b.score !== a.score ? b.score - a.score : b.platScore - a.platScore
    );
}

const FAQ_LINK_RE = /\/faqs\/(\d+)/;

export function parseFaqsPage(html) {
    const $ = cheerio.load(html);
    const seen = new Set();
    const guides = [];

    $('a[href]').each((_, el) => {
        const href = $(el).attr('href') ?? '';
        const m = href.match(FAQ_LINK_RE);
        if (!m) return;

        const faqId = m[1];
        if (seen.has(faqId)) return;
        seen.add(faqId);

        const title = $(el).text().trim();
        if (!title || title.length < 3) return;

        const $container = $(el).closest('li, tr, .pod-game-titles, .faqlist');
        const containerText = $container.text();
        const type = /\bHTML\b/i.test(containerText) ? 'html'
                   : /\b(text|txt)\b/i.test(containerText) ? 'text'
                   : 'unknown';

        const url = href.startsWith('http')
            ? href
            : `https://gamefaqs.gamespot.com${href}`;

        guides.push({ title, url, type });
    });

    return guides;
}

// ── Search implementations ────────────────────────────────────────────────────

export async function searchViaGameFAQs(browser, steamName, { debug = false } = {}) {
    const page = await setupPage(browser);
    try {
        await page.goto('https://gamefaqs.gamespot.com', { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await sleep(700 + Math.random() * 500);

        const searchSel = '#searchtextbox';
        await page.waitForSelector(searchSel, { timeout: 6_000 });
        await page.click(searchSel);
        await sleep(150 + Math.random() * 150);

        for (const char of steamName) {
            await page.keyboard.type(char);
            await sleep(40 + Math.random() * 70);
        }
        await sleep(250 + Math.random() * 200);
        await page.keyboard.press('Enter');

        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 });
        await sleep(1000 + Math.random() * 600);

        const html = await page.content();
        if (debug) console.log(`  [debug] GF search HTML: ${html.length}b`);
        return parseSearchResults(html, steamName, { debug });
    } finally {
        await page.close();
    }
}

const GFAQ_URL_RE = /gamefaqs\.gamespot\.com\/([a-z0-9-]+)\/(\d+)-([a-z0-9-]+)/i;

export async function searchViaDuckDuckGo(browser, steamName, { debug = false } = {}) {
    const query = `site:gamefaqs.gamespot.com "${steamName}" faqs`;
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

            const m = resolved.match(GFAQ_URL_RE);
            if (!m) return;

            const [, platform, gameId, slug] = m;
            if (SKIP_PLATFORM.has(platform.toLowerCase())) return;

            const key = `${platform}/${gameId}`;
            if (seen.has(key)) return;
            seen.add(key);

            const linkText = $(el).text().trim();
            const score    = nameSimilarity(steamName, linkText || slug.replace(/-/g, ' '));

            if (debug) console.log(`  [debug] ddg candidate: "${linkText}" platform=${platform} score=${score.toFixed(2)}`);

            candidates.push({
                name: linkText,
                platform,
                gameId,
                slug,
                gameUrl:   `https://gamefaqs.gamespot.com/${platform}/${gameId}-${slug}`,
                faqsUrl:   `https://gamefaqs.gamespot.com/${platform}/${gameId}-${slug}/faqs`,
                score,
                platScore: platScore(platform),
            });
        });

        return candidates.sort((a, b) =>
            b.score !== a.score ? b.score - a.score : b.platScore - a.platScore
        );
    } finally {
        await page.close();
    }
}

async function fetchPage(browser, url) {
    const page = await setupPage(browser);
    try {
        const res = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 });
        const status = res?.status() ?? 0;
        if (status === 404) return { html: null, status: 404 };
        if (!res?.ok()) throw new Error(`HTTP ${status}`);
        await sleep(500 + Math.random() * 400);
        return { html: await page.content(), status };
    } finally {
        await page.close();
    }
}

/**
 * Search GameFAQs for a game and return the list of available guides.
 *
 * Returns:
 *   { status: 'found', matchedGame, guides, candidates }
 *   { status: 'not_found' }
 *   { status: 'no_guides', matchedGame, candidates }
 *   { status: 'error', error }
 */
export async function searchGame(browser, gameName, { debug = false, minScore = 0.6 } = {}) {
    let candidates = [];

    try {
        candidates = await searchViaGameFAQs(browser, gameName, { debug });
        if (candidates.length === 0) {
            candidates = await searchViaDuckDuckGo(browser, gameName, { debug });
        }
    } catch (err) {
        return { status: 'error', error: err.message };
    }

    if (candidates.length === 0 || candidates[0].score < minScore) {
        return { status: 'not_found' };
    }

    const topNorm = normalize(candidates[0].name);
    const eligible = [
        candidates[0],
        ...candidates.slice(1).filter(c => normalize(c.name).startsWith(topNorm) && c.score >= 0.85),
    ].slice(0, 3);

    for (let ci = 0; ci < eligible.length; ci++) {
        const candidate = eligible[ci];
        await sleep(jitter(BETWEEN_PAGES_MIN, BETWEEN_PAGES_MAX));

        let guides = [];
        try {
            const { html, status } = await fetchPage(browser, candidate.faqsUrl);
            if (status === 404 || !html) continue;
            guides = parseFaqsPage(html);
        } catch (err) {
            return { status: 'error', error: err.message, matchedGame: candidate, candidates };
        }

        if (guides.length === 0) continue;

        return {
            status: 'found',
            matchedGame: {
                name:     candidate.name,
                platform: candidate.platform,
                gameUrl:  candidate.gameUrl,
                score:    candidate.score,
            },
            guides,
            candidates,
        };
    }

    return { status: 'no_guides', matchedGame: candidates[0], candidates };
}
