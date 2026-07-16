/**
 * Gamer Guides fetcher.
 *
 * Downloads all chapter pages of a Gamer Guides guide to a local _raw/ directory.
 *
 * Strategy:
 *   1. Fetch the guide index URL (/{slug}/guide) — it redirects to the first chapter.
 *   2. Extract the full TOC from the sidebar (all /{slug}/guide/... hrefs — server-rendered).
 *   3. Download each chapter page, skipping ones already on disk (unless force=true).
 *   4. Write a _manifest.json listing every downloaded page with its label and group.
 *
 * URL pattern: https://www.gamerguides.com/{game-slug}/guide/{section}/{subsection}/{page}
 * Content selector: .guide-page-content
 */

import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin  from 'puppeteer-extra-plugin-stealth';
import { mkdir, writeFile, access, readFile } from 'node:fs/promises';
import { join }                               from 'node:path';
import * as cheerio                           from 'cheerio';

puppeteerExtra.use(StealthPlugin());

const BASE        = 'https://www.gamerguides.com';
// Runaway guard, not a tuning knob. Truncation is logged; raise it rather than let a
// guide silently lose pages.
const MAX_PAGES   = 1000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Browser ───────────────────────────────────────────────────────────────────

export async function launchBrowser() {
    return puppeteerExtra.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
}

async function newPage(browser, cfg) {
    const page = await browser.newPage();
    await page.setViewport({ width: cfg.fetch.viewportWidth, height: cfg.fetch.viewportHeight });
    await page.setUserAgent(cfg.fetch.userAgent);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.setRequestInterception(true);
    page.on('request', req => {
        if (['media', 'font'].includes(req.resourceType())) req.abort();
        else req.continue();
    });
    return page;
}

async function fetchPageHtml(browser, url, cfg) {
    const page = await newPage(browser, cfg);
    try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: cfg.fetch.timeout });
        if (!response || !response.ok()) throw new Error(`HTTP ${response?.status() ?? '?'} for ${url}`);
        await sleep(600 + Math.random() * 400);
        return await page.content();
    } finally {
        await page.close();
    }
}

// ── TOC extraction ────────────────────────────────────────────────────────────

/**
 * Extract all guide chapter links from the page HTML.
 *
 * The TOC is fully server-rendered. Links follow the pattern:
 *   /{gameSlug}/guide/{section}/{subsection?}/{page?}
 *
 * The section name (first path segment after /guide/) becomes the group label.
 * Parent-level section links (2 path segments) serve as group headers.
 * Leaf-level links (3+ segments) are individual pages.
 */
function extractTocLinks(html, gameSlug) {
    const $ = cheerio.load(html);
    const prefix = `/${gameSlug}/guide/`;
    const seen = new Set();
    const pages = [];

    $(`a[href^="${prefix}"]`).each((_, el) => {
        const href = $(el).attr('href') ?? '';
        if (!href.startsWith(prefix) || seen.has(href)) return;
        seen.add(href);

        const relative = href.slice(prefix.length);   // e.g. "gameplay/tips-and-tricks/best-class"
        const parts    = relative.split('/').filter(Boolean);
        if (parts.length === 0) return;

        const group = parts[0]
            .replace(/-/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());

        // Parent section links (1 part) are group headers; leaf links (2+ parts) are pages
        const isLeaf = parts.length >= 2;
        const label  = $(el).text().trim().replace(/\s+/g, ' ') || parts[parts.length - 1];

        pages.push({ href, relative, parts, group, label, isLeaf });
    });

    return pages;
}

/** Convert a relative guide path to a safe filename slug. */
function relativeToSlug(relative) {
    return relative.replace(/\//g, '--');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch all pages of a Gamer Guides guide and save raw HTML to rawDir.
 *
 * @param {string}  startUrl        - https://www.gamerguides.com/{slug}/guide
 * @param {string}  rawDir          - Directory to write .html files and _manifest.json
 * @param {object}  cfg             - Config from guides/config.js
 * @param {object}  [opts]
 * @param {boolean} [opts.force]    - Re-fetch pages already on disk
 */
export async function fetchGuide(startUrl, rawDir, cfg, { force = false } = {}) {
    const urlObj   = new URL(startUrl);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    if (pathParts.length < 2 || pathParts[1] !== 'guide') {
        throw new Error(`Unrecognised Gamer Guides URL: ${startUrl}`);
    }
    const gameSlug = pathParts[0];

    await mkdir(rawDir, { recursive: true });
    const browser = await launchBrowser();

    try {
        // ── Step 1: Fetch index page to get the full TOC ─────────────────────
        console.log(`[fetcher:gamerguides] Fetching guide index: ${startUrl}`);
        const indexHtml = await fetchPageHtml(browser, startUrl, cfg);
        await writeFile(join(rawDir, '_index.html'), indexHtml, 'utf8');

        const allLinks  = extractTocLinks(indexHtml, gameSlug);
        const leafLinks = allLinks.filter(p => p.isLeaf);

        if (leafLinks.length === 0) {
            throw new Error(`No guide chapter links found for "${gameSlug}".`);
        }
        console.log(`[fetcher:gamerguides] TOC: ${allLinks.length} links (${leafLinks.length} chapter pages)`);

        // ── Step 2: Download each chapter page ────────────────────────────────
        const fetchedPages = [];

        for (let i = 0; i < leafLinks.length && fetchedPages.length < MAX_PAGES; i++) {
            const { href, relative, group, label } = leafLinks[i];
            const slug     = relativeToSlug(relative);
            const file     = `${slug}.html`;
            const destPath = join(rawDir, file);
            const url      = `${BASE}${href}`;

            const total = Math.min(leafLinks.length, MAX_PAGES);
            process.stdout.write(`  [${fetchedPages.length + 1}/${total}] ${slug.slice(0, 50)} ... `);

            let html      = null;
            let fromCache = false;

            if (!force) {
                try {
                    await access(destPath);
                    html      = await readFile(destPath, 'utf8');
                    fromCache = true;
                    process.stdout.write('cached\n');
                } catch { /* not on disk */ }
            }

            if (!html) {
                try {
                    html = await fetchPageHtml(browser, url, cfg);
                    await writeFile(destPath, html, 'utf8');
                    process.stdout.write(`✓ (${Math.round(html.length / 1024)}kb)\n`);
                } catch (err) {
                    process.stdout.write(`✗ ${err.message}\n`);
                }
            }

            if (html) {
                fetchedPages.push({ slug, file, label, group, url, href });
            }

            if (!fromCache && html && i < leafLinks.length - 1) {
                await sleep(cfg.fetch.delayMinMs + Math.random() * (cfg.fetch.delayMaxMs - cfg.fetch.delayMinMs));
            }
        }

        if (fetchedPages.length >= MAX_PAGES) {
            console.log(`\n[fetcher:gamerguides] Hit MAX_PAGES limit (${MAX_PAGES})`);
        }

        // ── Step 3: Write manifest ────────────────────────────────────────────
        const manifest = {
            source:    'gamerguides',
            guideId:   gameSlug,
            gameSlug,
            sourceUrl: startUrl,
            fetchedAt: new Date().toISOString(),
            pages:     fetchedPages,
        };

        await writeFile(join(rawDir, '_manifest.json'), JSON.stringify(manifest, null, 2));
        console.log(`[fetcher:gamerguides] Wrote _manifest.json (${fetchedPages.length} pages)`);

        return manifest;

    } finally {
        await browser.close().catch(() => {});
        console.log('[fetcher:gamerguides] Browser closed');
    }
}
