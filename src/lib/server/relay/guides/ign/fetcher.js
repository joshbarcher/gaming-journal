/**
 * IGN wiki guide fetcher.
 *
 * Downloads every page of an IGN wiki guide to a local _raw/ directory.
 * No parsing happens here — the parse step reads from _raw/.
 *
 * IGN wiki structure:
 *   - Guide index: https://www.ign.com/wikis/{wikiSlug}
 *   - Each page:   https://www.ign.com/wikis/{wikiSlug}/{PageTitle}
 *   - Navigation links are in the sidebar (.scrollbar a[href*="/wikis/"])
 *
 * The guide ID stored on disk is the wiki slug (e.g. "pragmata").
 *
 * Usage: called by src/tools/fetch-guide.js
 */

import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin  from 'puppeteer-extra-plugin-stealth';
import { mkdir, writeFile } from 'node:fs/promises';
import { join }             from 'node:path';
import * as cheerio          from 'cheerio';

import { extractNavLinksFromDoc } from './adapter.js';

puppeteerExtra.use(StealthPlugin());

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitter(minMs, maxMs) { return minMs + Math.floor(Math.random() * (maxMs - minMs)); }

function safeFilename(slug) {
    return slug.replace(/[^a-z0-9_-]/gi, '-').toLowerCase() + '.html';
}

// ── Browser setup ─────────────────────────────────────────────────────────────

async function launchBrowser() {
    const browser = await puppeteerExtra.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    console.log('[fetcher:ign] Browser launched');
    return browser;
}

async function newPage(browser, cfg) {
    const page = await browser.newPage();
    await page.setViewport({ width: cfg.fetch.viewportWidth, height: cfg.fetch.viewportHeight });
    await page.setUserAgent(cfg.fetch.userAgent);
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'DNT':             '1',
    });
    await page.setRequestInterception(true);
    page.on('request', req => {
        const type = req.resourceType();
        // IGN images load from oyster.ignimgs.com — we don't need them during fetch
        if (['media', 'font', 'image'].includes(type)) req.abort();
        else req.continue();
    });
    return page;
}

async function fetchPageHtml(browser, url, cfg) {
    const page = await newPage(browser, cfg);
    try {
        console.log(`  GET ${url}`);
        const response = await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout:   cfg.fetch.timeout,
        });

        if (!response || !response.ok()) {
            throw new Error(`HTTP ${response?.status() ?? '?'} for ${url}`);
        }

        // Let JS settle so Next.js hydration fills in the wiki content
        await sleep(1200 + Math.random() * 600);

        // Light scroll to trigger any lazy-loaded sections
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
        await sleep(300);
        await page.evaluate(() => window.scrollTo(0, 0));
        await sleep(200);

        return await page.content();
    } finally {
        await page.close();
    }
}

// ── Nav extraction ────────────────────────────────────────────────────────────

/**
 * Parse the sidebar navigation from the index page HTML to discover all pages.
 *
 * Returns ordered array of { pageTitle, fsSlug, url } objects.
 *
 * IGN sidebar links: <a href="/wikis/{wikiSlug}/{PageTitle}">Label</a>
 * We collect them in sidebar order, dedup, and skip utility pages.
 */
// Index page: use both sidebar + article body (its body IS the TOC).
// All other pages: sidebar only — article body links are cross-references, not hierarchy.
function extractNavPages(html, wikiSlug, baseUrl, { sidebarOnly = false } = {}) {
    const $ = cheerio.load(html);
    return extractNavLinksFromDoc($, wikiSlug, baseUrl, { sidebarOnly });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch all pages of an IGN wiki guide and save raw HTML to rawDir.
 *
 * @param {string}  startUrl  - Any valid URL for this wiki (index or a page)
 * @param {string}  rawDir    - Directory to write .html files and _manifest.json
 * @param {object}  cfg       - Config from guides/config.js
 * @param {object}  [opts]
 * @param {boolean} [opts.force=false] - Re-fetch pages already on disk
 */
export async function fetchGuide(startUrl, rawDir, cfg, { force = false } = {}) {
    const urlObj    = new URL(startUrl);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    // pathParts: ["wikis", "{wikiSlug}"] or ["wikis", "{wikiSlug}", "{PageTitle}"]
    if (pathParts.length < 2 || pathParts[0] !== 'wikis') {
        throw new Error(`Unrecognised IGN wiki URL: ${startUrl}`);
    }
    const wikiSlug = pathParts[1];
    const indexUrl = `${urlObj.origin}/wikis/${wikiSlug}`;

    // If the user provided a section URL (e.g. /wikis/pragmata/Walkthrough),
    // use that page for nav discovery — it has the section's chapter sub-pages
    // in its sidebar, which the index page doesn't show.
    // If they provided the index itself, use the index.
    const navDiscoveryUrl = pathParts.length > 2 ? startUrl : indexUrl;

    await mkdir(rawDir, { recursive: true });

    const browser = await launchBrowser();

    try {
        // ── Step 1: load nav discovery page ──────────────────────────────────
        console.log(`[fetcher:ign] Loading nav page: ${navDiscoveryUrl}`);
        const navHtml = await fetchPageHtml(browser, navDiscoveryUrl, cfg);

        // Save as _index.html for parse step (title + nav extraction)
        // If we used a section page for nav discovery, also fetch the real index
        // so we have a stable title source. Use cached _index.html if available.
        let indexHtml = navHtml;
        if (navDiscoveryUrl !== indexUrl) {
            try {
                const { readFile: rf } = await import('node:fs/promises');
                indexHtml = await rf(join(rawDir, '_index.html'), 'utf8');
                console.log(`[fetcher:ign] Using cached _index.html for title`);
            } catch {
                console.log(`[fetcher:ign] Fetching index for title: ${indexUrl}`);
                indexHtml = await fetchPageHtml(browser, indexUrl, cfg);
            }
        }

        // pages is a live array — new entries are appended as section pages are
        // fetched and reveal sub-pages in their sidebars (BFS crawl).
        const pages    = extractNavPages(navHtml, wikiSlug, navDiscoveryUrl);
        const seenSlugs = new Set(pages.map(p => p.fsSlug));

        if (pages.length === 0) {
            throw new Error(
                `No wiki pages found in sidebar for "${wikiSlug}". ` +
                `The guide may require login, or the URL may be wrong.`
            );
        }

        console.log(`[fetcher:ign] Found ${pages.length} top-level pages from index sidebar.`);

        // Save index HTML for title extraction during parse
        await writeFile(join(rawDir, '_index.html'), indexHtml, 'utf8');

        // ── Step 2: fetch each page ──────────────────────────────────────────
        const fetchedPages = [];

        for (let i = 0; i < pages.length; i++) {
            const { pageTitle, fsSlug, label, url } = pages[i];
            const file     = safeFilename(fsSlug);
            const destPath = join(rawDir, file);

            process.stdout.write(`  [${i + 1}/${pages.length}] ${fsSlug} ... `);

            let html;
            let servedFromCache = false;

            if (!force) {
                try {
                    const { access, readFile: rf } = await import('node:fs/promises');
                    await access(destPath);
                    console.log('skipped (cached)');
                    const entry = { slug: fsSlug, pageTitle, label, url, file };
                    if (pages[i].discoveredFrom) entry.discoveredFrom = pages[i].discoveredFrom;
                    fetchedPages.push(entry);
                    // Still read cached HTML for nav discovery
                    html = await rf(destPath, 'utf8');
                    servedFromCache = true;
                } catch {
                    html = null; /* not on disk, fetch it */
                }
            }

            if (html === undefined || html === null) {
                try {
                    // Reuse already-fetched HTML if this page was the nav discovery URL
                    const isReused = url === navDiscoveryUrl || new URL(url).href === new URL(navDiscoveryUrl).href;
                    html = isReused ? navHtml : await fetchPageHtml(browser, url, cfg);
                    await writeFile(destPath, html, 'utf8');
                    console.log(`✓ (${Math.round(html.length / 1024)}kb)${isReused ? ' (reused)' : ''}`);
                    const entry = { slug: fsSlug, pageTitle, label, url, file };
                    if (pages[i].discoveredFrom) entry.discoveredFrom = pages[i].discoveredFrom;
                    fetchedPages.push(entry);
                } catch (err) {
                    console.log(`✗ ${err.message}`);
                    html = null;
                }
            }

            // After fetching, scan this page's sidebar AND body for sub-pages not yet queued.
            // Sidebar links define the nav hierarchy; body links catch hub pages that list
            // their children exclusively in-content (e.g. social-links-guide → each S-Link page).
            // seenSlugs dedup prevents cross-reference links from being re-queued.
            if (html) {
                const subPages = extractNavPages(html, wikiSlug, url, { sidebarOnly: false });
                let discovered = 0;
                for (const sp of subPages) {
                    if (!seenSlugs.has(sp.fsSlug)) {
                        seenSlugs.add(sp.fsSlug);
                        pages.push({ ...sp, discoveredFrom: fsSlug });
                        discovered++;
                    }
                }
                if (discovered > 0) {
                    console.log(`  → discovered ${discovered} sub-page(s) from ${fsSlug}`);
                }
            }

            // No delay for cached or reused pages — only throttle actual network requests
            const isLastPage = i === pages.length - 1; // re-check: pages may have grown
            if (!servedFromCache && !isLastPage && html !== null) {
                const delay = jitter(cfg.fetch.delayMinMs, cfg.fetch.delayMaxMs);
                process.stdout.write(`  (waiting ${delay}ms)\n`);
                await sleep(delay);
            }
        }

        // ── Step 3: write manifest ────────────────────────────────────────────
        const manifest = {
            source:          'ign',
            guideId:         wikiSlug,
            wikiSlug,
            sourceUrl:       indexUrl,
            navDiscoveryUrl,
            fetchedAt:       new Date().toISOString(),
            pages:           fetchedPages,
        };

        await writeFile(join(rawDir, '_manifest.json'), JSON.stringify(manifest, null, 2));
        console.log(`\n[fetcher:ign] Wrote _manifest.json (${fetchedPages.length} pages)`);

        return manifest;

    } finally {
        await browser.close().catch(() => {});
        console.log('[fetcher:ign] Browser closed');
    }
}
