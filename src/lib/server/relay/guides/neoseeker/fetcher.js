/**
 * Neoseeker guide fetcher.
 *
 * Neoseeker is Cloudflare-protected (403 on plain fetch), so Puppeteer is
 * required. The guide index lives at /{gameSlug}/walkthrough; sub-pages are
 * at /{gameSlug}/{PageTitle} (Title_Case with underscores).
 *
 * Crawl strategy:
 *   1. Load the index (walkthrough) page; seed queue from TOC links
 *   2. BFS: after each page fetch, scan #wiki-content for new /{gameSlug}/ links
 *   3. Enqueue newly discovered pages (skips wiki namespaces like File:, Special:)
 *
 * Guide ID format: game slug  (e.g. "resident-evil-requiem")
 */

import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin  from 'puppeteer-extra-plugin-stealth';
import { mkdir, writeFile, access, readFile } from 'node:fs/promises';
import { join }                               from 'node:path';
import * as cheerio                           from 'cheerio';

puppeteerExtra.use(StealthPlugin());

const BASE = 'https://www.neoseeker.com';

// ── Browser ───────────────────────────────────────────────────────────────────

async function launchBrowser() {
    return puppeteerExtra.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
}

async function makePage(browser, cfg) {
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

async function fetchPageHtml(page, url, cfg, retries = 3) {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: cfg.fetch.timeout });
        const status = response?.status() ?? 0;
        if (status === 429) {
            const delay = 5000 * Math.pow(2, attempt);
            process.stdout.write(` [429 — waiting ${delay / 1000}s] `);
            await new Promise(r => setTimeout(r, delay));
            continue;
        }
        if (!response || status < 200 || status >= 300) throw new Error(`HTTP ${status || '?'} — ${url}`);
        return page.content();
    }
    throw new Error(`HTTP 429 — ${url} (exhausted ${retries} retries)`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Neoseeker wiki namespaces that are not guide content pages
const SKIP_NS = /^(File|Special|Talk|User|Template|Category|Help|MediaWiki|Module):/i;

// Strip characters that are illegal in Windows/POSIX filenames.
// The slug is preserved as-is for URLs; only the on-disk filename is sanitised.
function safeFilename(slug) {
    return slug.replace(/[\\/:*?"<>|]/g, '_');
}

// ── Link extraction ───────────────────────────────────────────────────────────

// Known content-area selectors, in priority order (mirrors adapter.js CONTENT_SELECTORS).
const CONTENT_SELECTORS = ['#wiki-content', '.mw-parser-output', '#mw-content-text', 'article'];

/**
 * Extract guide page links from HTML.
 * For the TOC, reads from .wiki-toc (falls back to #toc if absent).
 * For content pages, tries all known content-area selectors so pages using
 * .mw-parser-output or #mw-content-text instead of #wiki-content are handled.
 * Returns { slug, label, url }[] for pages not already in `seen`.
 */
function extractGuideLinks(html, gameSlug, seen, { tocOnly = false } = {}) {
    const $ = cheerio.load(html);
    const pages = [];

    let selector;
    if (tocOnly) {
        // Try canonical TOC first; fall back to MediaWiki #toc
        selector = $('.wiki-toc').length
            ? '.wiki-toc a[href]'
            : '#toc a[href]';
    } else {
        // Use whichever content region is present (same priority as adapter.js)
        const contentSel = CONTENT_SELECTORS.find(s => $(s).length) ?? CONTENT_SELECTORS[0];
        selector = `${contentSel} a[href], .wiki-toc a[href], #toc a[href]`;
    }

    $(selector).each((_, el) => {
        const href = $(el).attr('href') ?? '';
        let pageTitle, pageUrl;
        try {
            const u     = new URL(href, BASE);
            if (u.hostname !== 'www.neoseeker.com') return;
            const parts = u.pathname.split('/').filter(Boolean);
            if (parts[0] !== gameSlug) return;

            if (parts.length === 2 && parts[1] !== 'walkthrough') {
                // Standard format: /{gameSlug}/{page}
                pageTitle = decodeURIComponent(parts[1]);
                pageUrl   = `${BASE}/${gameSlug}/${encodeURIComponent(pageTitle)}`;
            } else if (parts.length === 3) {
                // Sub-page with section prefix: /{gameSlug}/{section}/{page}
                pageTitle = decodeURIComponent(parts[2]);
                pageUrl   = `${BASE}/${gameSlug}/${encodeURIComponent(parts[1])}/${encodeURIComponent(pageTitle)}`;
            } else {
                return;
            }
        } catch {
            return;
        }

        if (SKIP_NS.test(pageTitle)) return;
        if (seen.has(pageTitle)) return;
        seen.add(pageTitle);

        const titleAttr = ($(el).attr('title') ?? '').replace(/^walkthrough\//, '');
        const label = titleAttr || $(el).text().trim() || pageTitle.replace(/_/g, ' ');
        pages.push({
            slug:  pageTitle,
            file:  `${safeFilename(pageTitle)}.html`,
            label,
            url:   pageUrl,
        });
    });

    return pages;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function slugToLabel(slug) {
    return slug.replace(/_/g, ' ');
}

/**
 * Fetch all pages of a Neoseeker guide and save raw HTML to rawDir.
 *
 * @param {string} startUrl  — /{gameSlug}/walkthrough
 * @param {string} rawDir
 * @param {object} cfg
 * @param {{ force?: boolean }} opts
 */
export async function fetchGuide(startUrl, rawDir, cfg, { force = false } = {}) {
    const urlObj   = new URL(startUrl);
    const parts    = urlObj.pathname.split('/').filter(Boolean);
    const gameSlug = parts[0];

    if (!gameSlug) throw new Error(`Could not parse game slug from URL: ${startUrl}`);

    await mkdir(rawDir, { recursive: true });

    const browser = await launchBrowser();
    const page    = await makePage(browser, cfg);

    console.log(`[fetcher:neoseeker] Game slug: "${gameSlug}"`);
    console.log(`[fetcher:neoseeker] Index: ${BASE}/${gameSlug}/walkthrough`);

    try {
        // ── Step 1: fetch index (walkthrough) page ────────────────────────────

        const indexUrl  = `${BASE}/${gameSlug}/walkthrough`;
        const indexDest = join(rawDir, 'walkthrough.html');
        let indexHtml;

        if (!force) {
            try { indexHtml = await readFile(indexDest, 'utf8'); } catch { /* not cached */ }
        }

        if (!indexHtml) {
            process.stdout.write(`  [index] walkthrough ... `);
            indexHtml = await fetchPageHtml(page, indexUrl, cfg);
            await writeFile(indexDest, indexHtml, 'utf8');
            process.stdout.write(`✓ (${Math.round(indexHtml.length / 1024)}kb)\n`);
            await new Promise(r => setTimeout(r, 1200 + Math.random() * 800));
        } else {
            process.stdout.write(`  [index] walkthrough ... cached\n`);
        }

        // Copy to _index.html for nav tree extraction in parse-guide.js
        await writeFile(join(rawDir, '_index.html'), indexHtml, 'utf8');

        // ── Step 2: seed BFS queue from TOC ──────────────────────────────────

        const seen = new Set(['walkthrough']);
        const tocPages = extractGuideLinks(indexHtml, gameSlug, seen, { tocOnly: true });

        if (tocPages.length === 0) {
            console.warn(`[fetcher:neoseeker] WARNING: TOC selector found 0 pages — the walkthrough index may use an unrecognised layout.`);
            console.warn(`  Inspect the cached HTML to find the nav/TOC structure:`);
            console.warn(`  ${join(rawDir, 'walkthrough.html')}`);
        } else {
            console.log(`[fetcher:neoseeker] TOC: ${tocPages.length} pages`);
        }

        // Also discover any content-linked pages from the index page itself
        extractGuideLinks(indexHtml, gameSlug, seen).forEach(p => tocPages.push(p));

        const fetchedPages = [
            { slug: 'walkthrough', file: 'walkthrough.html', label: 'Introduction', url: indexUrl },
        ];

        const queue = [...tocPages];

        // ── Step 3: BFS fetch loop ────────────────────────────────────────────

        for (let qi = 0; qi < queue.length; qi++) {
            const p        = queue[qi];
            const destPath = join(rawDir, p.file);

            process.stdout.write(`  [${qi + 1}/${queue.length}] ${p.slug.slice(0, 50)} ... `);

            let html      = null;
            let fromCache = false;

            if (!force) {
                try {
                    await access(destPath);
                    html      = await readFile(destPath, 'utf8');
                    fromCache = true;
                    process.stdout.write('cached\n');
                } catch { /* not cached */ }
            }

            if (!html) {
                try {
                    html = await fetchPageHtml(page, p.url, cfg);
                    await writeFile(destPath, html, 'utf8');
                    process.stdout.write(`✓ (${Math.round(html.length / 1024)}kb)\n`);
                } catch (err) {
                    process.stdout.write(`✗ ${err.message}\n`);
                }
            }

            if (html) {
                fetchedPages.push(p);

                // Discover new pages linked from this page's content
                const discovered = extractGuideLinks(html, gameSlug, seen);
                if (discovered.length > 0) {
                    console.log(`    → discovered ${discovered.length} new page(s): ${discovered.map(d => d.slug).join(', ')}`);
                    queue.push(...discovered);
                }
            }

            if (!fromCache && html && qi < queue.length - 1) {
                await new Promise(r => setTimeout(r, 1200 + Math.random() * 800));
            }
        }

        // ── Step 4: write manifest ────────────────────────────────────────────

        const manifest = {
            source:    'neoseeker',
            guideId:   gameSlug,
            gameSlug,
            base:      BASE,
            sourceUrl: startUrl,
            fetchedAt: new Date().toISOString(),
            pages:     fetchedPages,
        };

        await writeFile(join(rawDir, '_manifest.json'), JSON.stringify(manifest, null, 2));
        console.log(`[fetcher:neoseeker] Wrote _manifest.json (${fetchedPages.length} pages)`);

        if (fetchedPages.length === 1) {
            console.warn(`[fetcher:neoseeker] WARNING: Only the walkthrough index page was fetched — no sub-pages were discovered.`);
            console.warn(`  The guide may use a layout the adapter does not recognise. Re-run with --force after`);
            console.warn(`  checking the TOC structure in: ${join(rawDir, 'walkthrough.html')}`);
        }

        return manifest;

    } finally {
        await browser.close().catch(() => {});
        console.log('[fetcher:neoseeker] Browser closed');
    }
}
