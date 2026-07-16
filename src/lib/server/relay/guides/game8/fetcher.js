/**
 * Game8 wiki guide fetcher.
 *
 * Downloads all article pages of a Game8 game wiki to a local _raw/ directory
 * using a BFS crawl: the game index seeds the queue, then each downloaded page
 * is scanned for new archive links that get added to the queue.
 *
 * Game8 structure:
 *   - Game index: https://game8.co/games/{gameSlug}
 *   - Articles:   https://game8.co/games/{gameSlug}/archives/{numericId}
 *
 * Individual article pages are server-rendered; images use data-src
 * (handled by preprocessRawHtml in the adapter, not Puppeteer rendering).
 *
 * Guide ID stored on disk = game slug (e.g. "Octopath-Traveler-2").
 * Page slugs = numeric archive IDs (e.g. "404331").
 */

import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin  from 'puppeteer-extra-plugin-stealth';
import { mkdir, writeFile, access, readFile } from 'node:fs/promises';
import { join }                               from 'node:path';
import * as cheerio                           from 'cheerio';

puppeteerExtra.use(StealthPlugin());

// ── Constants ─────────────────────────────────────────────────────────────────

// Runaway guard, not a tuning knob. Real guides legitimately run to many hundreds of
// pages — every game8 guide on disk sat exactly on the old 600, i.e. silently truncated.
// Truncation is logged; raise this rather than let a guide quietly lose pages.
const MAX_ARTICLES = 1000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitter(minMs, maxMs) { return minMs + Math.floor(Math.random() * (maxMs - minMs)); }

// ── Browser setup ─────────────────────────────────────────────────────────────

async function launchBrowser() {
    const browser = await puppeteerExtra.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    console.log('[fetcher:game8] Browser launched');
    return browser;
}

async function newPage(browser, cfg) {
    const page = await browser.newPage();
    await page.setViewport({ width: cfg.fetch.viewportWidth, height: cfg.fetch.viewportHeight });
    await page.setUserAgent(cfg.fetch.userAgent);
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'DNT':             '1',
    });
    await page.setRequestInterception(true);
    page.on('request', req => {
        if (['media', 'font', 'image'].includes(req.resourceType())) req.abort();
        else req.continue();
    });
    return page;
}

async function fetchPageHtml(browser, url, cfg) {
    const page = await newPage(browser, cfg);
    try {
        const response = await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout:   cfg.fetch.timeout,
        });

        if (!response || !response.ok()) {
            throw new Error(`HTTP ${response?.status() ?? '?'} for ${url}`);
        }

        await sleep(800 + Math.random() * 400);
        return await page.content();
    } finally {
        await page.close();
    }
}

// ── Archive link extraction ───────────────────────────────────────────────────

/**
 * Extract all archive links from an HTML page.
 *
 * For the game index page, tracks h2 headings as group labels.
 * For article pages, group defaults to the parent page's label (passed in).
 *
 * Returns { archiveId, label, group, url }[]
 */
function extractArchiveLinks(html, gameSlug, { defaultGroup = null } = {}) {
    const $ = cheerio.load(html);
    const ARCHIVE_ABS = new RegExp(`game8\\.co/games/${gameSlug}/archives/(\\d+)`, 'i');
    const ARCHIVE_REL = new RegExp(`^/games/${gameSlug}/archives/(\\d+)`, 'i');

    const seen = new Set();
    const links = [];
    let currentGroup = defaultGroup;

    $('h2, a').each((_, el) => {
        const tag = el.tagName?.toLowerCase();
        const $el = $(el);

        if (tag === 'h2') {
            const text = $el.text().trim().replace(/\s+/g, ' ');
            if (text) currentGroup = text;
            return;
        }

        const href = $el.attr('href') ?? '';
        const m    = href.match(ARCHIVE_REL) ?? href.match(ARCHIVE_ABS);
        if (!m) return;

        const archiveId = m[1];
        if (seen.has(archiveId)) return;
        seen.add(archiveId);

        const label = $el.text().trim().replace(/\s+/g, ' ') || archiveId;
        const url   = href.startsWith('http')
            ? href
            : `https://game8.co/games/${gameSlug}/archives/${archiveId}`;

        links.push({ archiveId, label, group: currentGroup, url });
    });

    return links;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch all articles of a Game8 game wiki and save raw HTML to rawDir.
 *
 * Uses a BFS crawl: game index seeds the queue, each downloaded page
 * contributes newly-discovered archive links back into the queue.
 *
 * @param {string}  startUrl         - game8.co/games/{gameSlug} or any archives URL
 * @param {string}  rawDir           - Directory to write .html files and _manifest.json
 * @param {object}  cfg              - Config from guides/config.js
 * @param {object}  [opts]
 * @param {boolean} [opts.force=false] - Re-fetch pages already on disk
 */
export async function fetchGuide(startUrl, rawDir, cfg, { force = false } = {}) {
    const urlObj    = new URL(startUrl);
    const pathParts = urlObj.pathname.split('/').filter(Boolean);

    if (pathParts.length < 2 || pathParts[0] !== 'games') {
        throw new Error(`Unrecognised Game8 URL: ${startUrl}`);
    }

    const gameSlug = pathParts[1];
    const indexUrl = `https://game8.co/games/${gameSlug}`;

    await mkdir(rawDir, { recursive: true });

    const browser = await launchBrowser();

    try {
        // ── Step 1: fetch game index → seed the BFS queue ────────────────────
        console.log(`[fetcher:game8] Loading index: ${indexUrl}`);
        const indexHtml = await fetchPageHtml(browser, indexUrl, cfg);
        await writeFile(join(rawDir, '_index.html'), indexHtml, 'utf8');

        const seedLinks = extractArchiveLinks(indexHtml, gameSlug);
        if (seedLinks.length === 0) {
            throw new Error(`No archive articles found on Game8 index page for "${gameSlug}".`);
        }
        console.log(`[fetcher:game8] Index seeded ${seedLinks.length} pages into queue.`);

        // BFS state
        // queue entries: { archiveId, label, group, url }
        const queued  = new Set(seedLinks.map(l => l.archiveId));
        const queue   = [...seedLinks];

        const fetchedPages = [];
        let qi = 0;

        // ── Step 2: BFS fetch loop ────────────────────────────────────────────
        while (qi < queue.length && fetchedPages.length < MAX_ARTICLES) {
            const { archiveId, label, group, url } = queue[qi++];
            const slug     = archiveId;
            const file     = `${slug}.html`;
            const destPath = join(rawDir, file);

            const total = Math.min(queue.length, MAX_ARTICLES);
            process.stdout.write(`  [${fetchedPages.length + 1}/${total}] ${slug} (${label.slice(0, 40)}) ... `);

            let html        = null;
            let fromCache   = false;

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
                fetchedPages.push({ slug, label, group: group ?? null, url, file });

                // Discover new archive links from this page and enqueue them
                const discovered = extractArchiveLinks(html, gameSlug, { defaultGroup: label });
                let newCount = 0;
                for (const link of discovered) {
                    if (!queued.has(link.archiveId) && fetchedPages.length + queue.length - qi < MAX_ARTICLES) {
                        queued.add(link.archiveId);
                        queue.push(link);
                        newCount++;
                    }
                }
                if (newCount > 0) {
                    console.log(`    → discovered ${newCount} new pages (queue now ${queue.length - qi} pending)`);
                }
            }

            if (!fromCache && html && qi < queue.length) {
                const delay = jitter(cfg.fetch.delayMinMs, cfg.fetch.delayMaxMs);
                await sleep(delay);
            }
        }

        if (fetchedPages.length >= MAX_ARTICLES) {
            console.log(`\n[fetcher:game8] Hit MAX_ARTICLES limit (${MAX_ARTICLES})`);
        }

        // ── Step 3: write manifest ────────────────────────────────────────────
        const manifest = {
            source:    'game8',
            guideId:   gameSlug,
            gameSlug,
            sourceUrl: indexUrl,
            fetchedAt: new Date().toISOString(),
            pages:     fetchedPages,
        };

        await writeFile(join(rawDir, '_manifest.json'), JSON.stringify(manifest, null, 2));
        console.log(`[fetcher:game8] Wrote _manifest.json (${fetchedPages.length} pages)`);

        return manifest;

    } finally {
        await browser.close().catch(() => {});
        console.log('[fetcher:game8] Browser closed');
    }
}
