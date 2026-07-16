/**
 * Fandom wiki guide fetcher.
 *
 * Uses plain HTTP fetch (no browser) — Fandom/MediaWiki pages are fully
 * server-rendered so Puppeteer is not needed. Fetches pages concurrently
 * in small batches and BFS-crawls links discovered on each page.
 *
 * Guide ID format: {wikiSubdomain}--{articleTitle}
 * e.g. "elden-ring--Elden_Ring_(game)"
 */

import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin  from 'puppeteer-extra-plugin-stealth';
import { mkdir, writeFile, access, readFile } from 'node:fs/promises';
import { join }                               from 'node:path';
import * as cheerio                           from 'cheerio';

puppeteerExtra.use(StealthPlugin());

// Runaway guard, not a tuning knob. Truncation is logged; raise it rather than let a
// guide silently lose pages. Matters most here — this is an unbounded BFS across wiki
// links, so the cap is the only thing standing between one guide and a whole wiki.
const MAX_PAGES = 1000;

const SKIP_NAMESPACE_RE = /^(Special|Talk|User(?:[ _]talk)?|File(?:[ _]talk)?|MediaWiki(?:[ _]talk)?|Template(?:[ _]talk)?|Help(?:[ _]talk)?|Category(?:[ _]talk)?|Forum|Blog|Message[ _]Wall|Board|Thread):/i;

// ── Browser ───────────────────────────────────────────────────────────────────

async function launchBrowser() {
    return puppeteerExtra.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
}

// Reuse a single page across all fetches — open/close per article was the bottleneck.
async function makePage(browser, cfg) {
    const page = await browser.newPage();
    await page.setViewport({ width: cfg.fetch.viewportWidth, height: cfg.fetch.viewportHeight });
    await page.setUserAgent(cfg.fetch.userAgent);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.setRequestInterception(true);
    page.on('request', req => {
        if (['media', 'font', 'image'].includes(req.resourceType())) req.abort();
        else req.continue();
    });
    return page;
}

async function fetchPageHtml(page, url, cfg) {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: cfg.fetch.timeout });
    if (!response || !response.ok()) throw new Error(`HTTP ${response?.status() ?? '?'}`);
    return page.content();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function titleToSlug(title) {
    return title.replace(/ /g, '_').replace(/[/\\:*?"<>|]/g, '-');
}

export function slugToLabel(slug) {
    return slug.replace(/_/g, ' ').replace(/--.*$/, '');
}

export function parseGuideId(guideId) {
    const sep = guideId.indexOf('--');
    if (sep === -1) throw new Error(`Invalid Fandom guide ID: ${guideId}`);
    return {
        wikiSubdomain: guideId.slice(0, sep),
        articleTitle:  guideId.slice(sep + 2),
    };
}

// ── Link extraction ───────────────────────────────────────────────────────────

function extractArticleLinks(html) {
    const $ = cheerio.load(html);
    const links = new Set();

    $('.mw-parser-output a[href^="/wiki/"]').each((_, el) => {
        const href = $(el).attr('href') ?? '';
        if (!href.startsWith('/wiki/')) return;
        const articleTitle = decodeURIComponent(href.slice(6).split('#')[0]);
        if (!articleTitle || SKIP_NAMESPACE_RE.test(articleTitle)) return;
        links.add(articleTitle);
    });

    return [...links];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch all pages of a Fandom wiki guide and save raw HTML to rawDir.
 *
 * @param {string}  startUrl
 * @param {string}  rawDir
 * @param {object}  cfg
 * @param {object}  [opts]
 * @param {boolean} [opts.force]
 */
export async function fetchGuide(startUrl, rawDir, cfg, { force = false } = {}) {
    const urlObj = new URL(startUrl);
    const wikiSubdomain = urlObj.hostname.split('.')[0];
    const wikiBase      = `https://${urlObj.hostname}`;

    if (!urlObj.pathname.startsWith('/wiki/')) {
        throw new Error(`Expected a Fandom /wiki/ URL, got: ${startUrl}`);
    }
    const startArticle = decodeURIComponent(urlObj.pathname.slice(6));

    await mkdir(rawDir, { recursive: true });

    const browser = await launchBrowser();
    const page    = await makePage(browser, cfg);

    // BFS state
    const queued       = new Set([startArticle]);
    const queue        = [startArticle];
    const fetchedPages = [];
    let qi = 0;

    console.log(`[fetcher:fandom] BFS from "${startArticle}" — max ${MAX_PAGES} pages`);

    try {
    while (qi < queue.length && fetchedPages.length < MAX_PAGES) {
        const article  = queue[qi++];
        const slug     = titleToSlug(article);
        const destPath = join(rawDir, `${slug}.html`);
        const url      = `${wikiBase}/wiki/${encodeURIComponent(article)}`;
        const total    = Math.min(MAX_PAGES, queue.length);

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
                html = await fetchPageHtml(page, url, cfg);
                await writeFile(destPath, html, 'utf8');
                process.stdout.write(`✓ (${Math.round(html.length / 1024)}kb)\n`);
            } catch (err) {
                process.stdout.write(`✗ ${err.message}\n`);
            }
        }

        if (html) {
            fetchedPages.push({ slug, file: `${slug}.html`, label: slugToLabel(slug), url });

            const links = extractArticleLinks(html);
            let newCount = 0;
            for (const link of links) {
                if (!queued.has(link) && fetchedPages.length + (queue.length - qi) < MAX_PAGES) {
                    queued.add(link);
                    queue.push(link);
                    newCount++;
                }
            }
            if (newCount > 0) {
                console.log(`    → +${newCount} queued (${queue.length - qi} pending)`);
            }
        }

        if (!fromCache && html && qi < queue.length) {
            await new Promise(r => setTimeout(r, 300 + Math.random() * 200));
        }
    }
    } finally {
        await browser.close().catch(() => {});
        console.log('[fetcher:fandom] Browser closed');
    }

    if (fetchedPages.length >= MAX_PAGES) {
        console.log(`\n[fetcher:fandom] Hit MAX_PAGES limit (${MAX_PAGES})`);
    }

    // Copy start page as _index.html for nav tree extraction
    const startSlug = titleToSlug(startArticle);
    try {
        const startHtml = await readFile(join(rawDir, `${startSlug}.html`), 'utf8');
        await writeFile(join(rawDir, '_index.html'), startHtml, 'utf8');
    } catch { /* not fatal */ }

    const manifest = {
        source:       'fandom',
        guideId:      `${wikiSubdomain}--${startSlug}`,
        wikiSubdomain,
        wikiBase,
        startArticle: startSlug,
        sourceUrl:    startUrl,
        fetchedAt:    new Date().toISOString(),
        pages:        fetchedPages,
    };

    await writeFile(join(rawDir, '_manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`[fetcher:fandom] Wrote _manifest.json (${fetchedPages.length} pages)`);

    return manifest;
}
