/**
 * Neoseeker guide search service.
 *
 * Neoseeker returns 403 for plain HTTP fetch (Cloudflare-protected), so we use
 * Puppeteer for all probes. Strategy:
 *   1. Derive slug candidates from game name (kebab-case)
 *   2. Probe each /{slug}/walkthrough via Puppeteer — 200 + canonical URL wins
 *   3. Fallback: DuckDuckGo `site:neoseeker.com walkthrough {gameName}`
 *
 * Guide ID = game slug (e.g. "trails-of-cold-steel-iv-the-end-of-saga")
 * Guide URL = https://www.neoseeker.com/{slug}/walkthrough
 */

import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin  from 'puppeteer-extra-plugin-stealth';

puppeteerExtra.use(StealthPlugin());

const BASE = 'https://www.neoseeker.com';

const ROMAN = {
    i:1,ii:2,iii:3,iv:4,v:5,vi:6,vii:7,viii:8,ix:9,x:10,
    xi:11,xii:12,xiii:13,xiv:14,xv:15,xvi:16,xvii:17,xviii:18,xix:19,xx:20,
};

function toSlug(name, { convertRoman = true } = {}) {
    // NFD-normalize to decompose diacritics (ö→o, é→e, etc.) before lowercasing
    let s = name
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[™®©'']/g, '');
    if (convertRoman) {
        s = s.replace(/\b(x{0,3}(?:ix|iv|v?i{0,3}))\b/g, w => ROMAN[w] != null ? String(ROMAN[w]) : w);
    }
    return s
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function slugCandidates(name) {
    // Try roman-numeral-preserved slug first — Neoseeker uses roman numerals in URLs
    // (e.g. "trails-of-cold-steel-iv", not "trails-of-cold-steel-4")
    const baseRoman  = toSlug(name, { convertRoman: false });
    const baseNumeric = toSlug(name, { convertRoman: true });

    const seen = new Set();
    const candidates = [];
    const add = s => { if (s && !seen.has(s)) { seen.add(s); candidates.push(s); } };

    add(baseRoman);
    if (baseNumeric !== baseRoman) add(baseNumeric);

    // Strip leading "the-"
    if (baseRoman.startsWith('the-')) add(baseRoman.slice(4));

    // Truncated variants (drop last segment, drop to first two segments)
    const parts = baseRoman.split('-');
    if (parts.length > 2) {
        add(parts.slice(0, -1).join('-'));
        add(parts.slice(0, 2).join('-'));
    }

    // Before colon (e.g. "The Legend of Heroes: ..." → "the-legend-of-heroes")
    const colonIdx = name.indexOf(':');
    if (colonIdx > 0) add(toSlug(name.slice(0, colonIdx), { convertRoman: false }));

    return candidates;
}

export function normalize(name) {
    return name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function nameSimilarity(a, b) {
    const na = normalize(a);
    const nb = normalize(b);
    if (na === nb) return 1.0;
    if (na.startsWith(nb) || nb.startsWith(na)) return 0.9;
    const keep = w => w.length > 2 || /^\d+$/.test(w);
    const wa = na.split(' ').filter(keep);
    const wb = new Set(nb.split(' ').filter(keep));
    if (wa.length === 0) return 0;
    const shared = wa.filter(w => wb.has(w)).length;
    return shared / Math.max(wa.length, wb.size);
}

let _browser = null;

export async function launchBrowser() {
    if (_browser) {
        try { await _browser.version(); return _browser; } catch { _browser = null; }
    }
    _browser = await puppeteerExtra.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    return _browser;
}

export async function closeBrowser() {
    if (_browser) { await _browser.close().catch(() => {}); _browser = null; }
}

async function makePage(browser) {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.setRequestInterception(true);
    page.on('request', req => {
        if (['media', 'font', 'image', 'stylesheet'].includes(req.resourceType())) req.abort();
        else req.continue();
    });
    return page;
}

async function probeSlug(page, slug) {
    const url = `${BASE}/${slug}/walkthrough`;
    try {
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        if (!resp) return null;
        const status = resp.status();
        if (status === 404) return null;
        if (status !== 200) return null;

        // Verify via canonical link that this is actually a walkthrough page
        const canonical = await page.$eval('link[rel="canonical"]', el => el.href).catch(() => '');
        if (!canonical.includes('/walkthrough')) return null;

        // Extract the authoritative slug from the canonical URL — handles redirects
        // (e.g. probing /god-of-war-ragnar-k/ redirects to /god-of-war-ragnarok/)
        const canonSlug = canonical.match(/neoseeker\.com\/([^/]+)\/walkthrough/)?.[1] ?? slug;

        const title = await page.$eval(
            '#page-title h1, .page-title h1, h1',
            el => el.textContent.trim()
        ).catch(() => canonSlug);

        return { slug: canonSlug, url: `${BASE}/${canonSlug}/walkthrough`, title };
    } catch {
        return null;
    }
}

async function searchViaDuckDuckGo(page, gameName) {
    const query = encodeURIComponent(`site:neoseeker.com walkthrough "${gameName}"`);
    try {
        await page.goto(`https://duckduckgo.com/?q=${query}&ia=web`, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await new Promise(r => setTimeout(r, 2000));

        const hrefs = await page.$$eval('a[href]', els =>
            els.map(a => a.href).filter(h => /neoseeker\.com\/[a-z0-9-]+\/walkthrough/.test(h))
        );

        for (const href of hrefs.slice(0, 5)) {
            const m = href.match(/neoseeker\.com\/([a-z0-9-]+)\/walkthrough/);
            if (!m) continue;
            const result = await probeSlug(page, m[1]);
            if (result) return result;
        }
    } catch { /* DDG unavailable */ }
    return null;
}

/**
 * Search Neoseeker for a game's walkthrough.
 *
 * @param {*} browser - Puppeteer browser instance
 * @param {string} gameName
 * @returns {{ status: 'found', slug, url, title, score } | { status: 'not_found' } | { status: 'error', error }}
 */
export async function searchGame(browser, gameName) {
    let page;
    try {
        page = await makePage(browser);
        const candidates = slugCandidates(gameName);
        console.log(`[search:neoseeker] Probing ${candidates.length} slug candidates for "${gameName}"`);

        const MIN_SCORE = 0.65;
        for (const slug of candidates) {
            console.log(`[search:neoseeker] Probing /${slug}/walkthrough`);
            const result = await probeSlug(page, slug);
            if (result) {
                const score = nameSimilarity(gameName, result.title.replace(/\s+Walkthrough.*$/i, ''));
                console.log(`[search:neoseeker] Found: ${result.url} (score=${score.toFixed(2)})`);
                if (score < MIN_SCORE) {
                    console.log(`[search:neoseeker] Score too low (${score.toFixed(2)} < ${MIN_SCORE}), skipping`);
                    continue;
                }
                return { status: 'found', slug: result.slug, url: result.url, title: result.title, score };
            }
        }

        console.log(`[search:neoseeker] Slug candidates failed — trying DuckDuckGo`);
        const ddg = await searchViaDuckDuckGo(page, gameName);
        if (ddg) {
            const score = nameSimilarity(gameName, ddg.title.replace(/\s+Walkthrough.*$/i, ''));
            return { status: 'found', slug: ddg.slug, url: ddg.url, title: ddg.title, score };
        }

        return { status: 'not_found' };
    } catch (err) {
        return { status: 'error', error: err.message };
    } finally {
        await page?.close().catch(() => {});
    }
}
