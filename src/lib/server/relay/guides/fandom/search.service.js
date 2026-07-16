/**
 * Fandom wiki search service.
 *
 * Finds the Fandom wiki for a game using two strategies:
 *
 *   1. Slug-based detection: derive a wiki subdomain from the game name and check
 *      if {slug}.fandom.com is a real wiki with content for that game.
 *
 *   2. Puppeteer search: navigate to fandom.com/search?q={game} and wait for
 *      React to render wiki result links, then extract the first matching wiki URL.
 *      Also uses the MediaWiki cross-wiki search on gaming-adjacent hubs.
 *
 * Once the wiki URL is found, uses the MediaWiki search API to locate the exact
 * game article page within that wiki.
 *
 * Guide ID format: {wikiSubdomain}--{articleSlug}
 * e.g. "persona--Persona_3_Reload"
 */

import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin  from 'puppeteer-extra-plugin-stealth';

puppeteerExtra.use(StealthPlugin());

const FETCH_HEADERS = {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

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

// ── Slug-based wiki detection ─────────────────────────────────────────────────

function toSlug(name) {
    return name
        .toLowerCase()
        .replace(/['']/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function wikiSlugCandidates(gameName) {
    const base = toSlug(gameName);
    const candidates = [base];

    // Drop subtitle after colon (e.g. "persona-3-reload" from "persona-3-reload")
    // Try franchise root (e.g. "persona" from "persona-3-reload")
    const parts = base.split('-');
    if (parts.length > 2) {
        // Drop trailing version/qualifier: "persona-3-reload" → "persona-3"
        candidates.push(parts.slice(0, -1).join('-'));
        // Franchise root: "persona"
        candidates.push(parts[0]);
    }
    if (parts.length > 1) {
        candidates.push(parts.slice(0, 2).join('-'));
    }

    return [...new Set(candidates)];
}

/**
 * Try a direct page title lookup on the wiki using the API.
 * Returns the canonical title if the page exists, or null.
 */
async function lookupTitle(wikiBase, title) {
    const encoded = encodeURIComponent(title.replace(/ /g, '_'));
    const url = `${wikiBase}/api.php?action=query&titles=${encoded}&redirects=1&format=json&origin=*`;
    try {
        const resp = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(6_000) });
        if (!resp.ok) return null;
        const data = await resp.json();
        const pages = Object.values(data?.query?.pages ?? {});
        if (pages.length === 0 || pages[0].missing !== undefined) return null;
        // Follow redirect if present
        const normalized = data?.query?.normalized?.[0]?.to ?? null;
        const redirected  = data?.query?.redirects?.[0]?.to   ?? null;
        return redirected ?? normalized ?? pages[0].title;
    } catch {
        return null;
    }
}

/**
 * Check if a Fandom wiki subdomain is valid and has a page matching the game.
 * Returns { wikiBase, articleSlug, articleTitle } or null.
 *
 * Strategy:
 *   1. Direct title lookup for exact game name (follows redirects)
 *   2. Direct lookup for "{gameName} (video game)" qualifier
 *   3. MW search API with smart ranking
 */
async function checkWiki(subdomain, gameName) {
    const wikiBase = `https://${subdomain}.fandom.com`;

    // ── Step 1: Direct title lookup ──────────────────────────────────────────
    for (const candidate of [gameName, `${gameName} (video game)`, `${gameName} (game)`]) {
        const title = await lookupTitle(wikiBase, candidate);
        if (title && !title.toLowerCase().includes('disambiguation')) {
            return {
                wikiBase,
                subdomain,
                articleSlug:  title.replace(/ /g, '_'),
                articleTitle: title,
            };
        }
    }

    // ── Step 2: MW search API ────────────────────────────────────────────────
    const searchQuery = encodeURIComponent(gameName);
    const apiUrl = `${wikiBase}/api.php?action=query&list=search&srsearch=${searchQuery}&srnamespace=0&srlimit=10&format=json&origin=*`;

    try {
        const resp = await fetch(apiUrl, {
            headers: FETCH_HEADERS,
            signal: AbortSignal.timeout(8_000),
        });
        if (!resp.ok) return null;

        const data = await resp.json();
        const allResults = data?.query?.search ?? [];
        // Skip subpages (/ in title) — they're never the main game article
        const results = allResults.filter(r => !r.title.includes('/'));
        if (results.length === 0) return null;

        const gameNameLower = gameName.toLowerCase();
        const gameNameNorm  = gameNameLower.replace(/[^a-z0-9]/g, '');

        // Strip parenthetical qualifiers from a title and normalise.
        // "Elden Ring (game)" → "eldenring"   "Elden Ring Nightreign" → "eldenringnightreign"
        const normStripped = t => t.replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]/g, '').toLowerCase();

        // Priority order: exact → qualifier-stripped exact → first non-disambiguation
        // "startsWith" is intentionally removed — it's too loose and matches spinoffs/sequels.
        const exact     = results.find(r => r.title.replace(/_/g, ' ').toLowerCase() === gameNameLower);
        const normMatch = results.find(r => normStripped(r.title) === gameNameNorm);
        // Only use a fallback if the stripped title is an exact match — prevents "Elden Ring Nightreign"
        // from matching a search for "Elden Ring".
        const fallback  = results.find(r =>
            normStripped(r.title) === gameNameNorm &&
            !r.title.toLowerCase().includes('disambiguation')
        ) ?? null;
        const best = exact ?? normMatch ?? fallback;
        if (!best) return null;

        return {
            wikiBase,
            subdomain,
            articleSlug:  best.title.replace(/ /g, '_'),
            articleTitle: best.title,
        };
    } catch {
        return null;
    }
}

// ── Puppeteer search fallback ─────────────────────────────────────────────────

/**
 * Use Puppeteer to search fandom.com and extract wiki result URLs.
 * The search page is a React SPA — we wait up to 8s for results to render.
 */
async function puppeteerSearch(browser, gameName) {
    const page = await browser.newPage();
    try {
        await page.setUserAgent(FETCH_HEADERS['User-Agent']);
        const url = `https://www.fandom.com/search?q=${encodeURIComponent(gameName + ' wiki')}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });

        // Wait for fandom wiki links to appear in the rendered DOM (up to 8s)
        try {
            await page.waitForFunction(
                () => document.querySelector('a[href*=".fandom.com/wiki/"]') !== null,
                { timeout: 8_000 }
            );
        } catch { /* timed out — no results rendered */ }

        const links = await page.evaluate(() => {
            const anchors = [...document.querySelectorAll('a[href*=".fandom.com/wiki/"]')];
            return anchors.map(a => a.href).filter(h =>
                !/(community|support|help|vignette|images|soap)\.fandom/.test(h) &&
                !/\.(png|jpg|svg|css|js)/.test(h)
            );
        });

        if (links.length === 0) return null;

        // Extract subdomain from the first result
        const match = links[0].match(/^https?:\/\/([a-z0-9-]+)\.fandom\.com\/wiki\/(.+)$/i);
        if (!match) return null;

        const [, subdomain, articleSlug] = match;
        return { subdomain, articleSlug: decodeURIComponent(articleSlug) };
    } finally {
        await page.close().catch(() => {});
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Search for a Fandom wiki for a given game.
 *
 * @param {object} browser  - Puppeteer browser instance
 * @param {string} gameName
 * @returns {{ status, wikiBase?, wikiSubdomain?, articleSlug?, guideId?, gameName?, score? }}
 */
export async function searchGame(browser, gameName) {
    // ── Strategy 1: slug-based subdomain detection ────────────────────────────
    const slugs = wikiSlugCandidates(gameName);
    for (const slug of slugs) {
        const result = await checkWiki(slug, gameName);
        if (result) {
            const guideId = `${result.subdomain}--${result.articleSlug}`;
            return {
                status:        'found',
                wikiBase:      result.wikiBase,
                wikiSubdomain: result.subdomain,
                articleSlug:   result.articleSlug,
                guideId,
                gameName:      result.articleTitle,
                score:         slug === slugs[0] ? 1.0 : 0.85,
            };
        }
    }

    // ── Strategy 2: Puppeteer search on fandom.com ────────────────────────────
    try {
        const found = await puppeteerSearch(browser, gameName);
        if (found) {
            // Verify the wiki with the MW API
            const verified = await checkWiki(found.subdomain, gameName);
            if (verified) {
                const guideId = `${verified.subdomain}--${verified.articleSlug}`;
                return {
                    status:        'found',
                    wikiBase:      verified.wikiBase,
                    wikiSubdomain: verified.subdomain,
                    articleSlug:   verified.articleSlug,
                    guideId,
                    gameName:      verified.articleTitle,
                    score:         0.75,
                };
            }
        }
    } catch (err) {
        console.warn(`[search:fandom] Puppeteer search failed: ${err.message}`);
    }

    return { status: 'not_found' };
}
