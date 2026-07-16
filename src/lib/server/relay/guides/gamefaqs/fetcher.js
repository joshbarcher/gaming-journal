/**
 * GameFAQs guide fetcher.
 *
 * Downloads every section page of an HTML guide to a local _raw/ directory.
 * No parsing happens here — the parse step reads from _raw/.
 *
 * Usage: called by src/tools/fetch-guide.js
 */

import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin  from 'puppeteer-extra-plugin-stealth';
import { mkdir, writeFile } from 'node:fs/promises';
import { join }             from 'node:path';
import * as cheerio          from 'cheerio';

puppeteerExtra.use(StealthPlugin());

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function jitter(minMs, maxMs) {
    return minMs + Math.floor(Math.random() * (maxMs - minMs));
}

// GameFAQs guide URL: /{platform}/{game}/faqs/{faqId}/{section}
function parseGuideUrl(url) {
    const m = url.match(/gamefaqs\.gamespot\.com\/([^/]+)\/([^/]+)\/faqs\/(\d+)(?:\/([^/?#]*))?/);
    if (!m) throw new Error(`Unrecognised GameFAQs guide URL: ${url}`);
    return {
        platform: m[1],
        gameSlug: m[2],
        faqId:    m[3],
        section:  m[4] || 'introduction',
    };
}

function sectionSlug(href, faqId) {
    const m = href.match(new RegExp(`/faqs/${faqId}/([^/?#]+)`));
    return m ? m[1] : null;
}

// Ensure a section slug is safe to use as a filename
function safeFilename(slug) {
    return slug.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
}

// ── Browser ───────────────────────────────────────────────────────────────────

async function launchBrowser(cfg) {
    const browser = await puppeteerExtra.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    console.log('[fetcher] Browser launched');
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

    // Intercept and abort requests for types we don't need
    await page.setRequestInterception(true);
    page.on('request', req => {
        const type = req.resourceType();
        if (['media', 'font'].includes(type)) {
            req.abort();
        } else {
            req.continue();
        }
    });

    return page;
}

// Fetch a single URL and return the full serialised HTML.
// Scrolls to trigger lazy-loaded images before capturing.
// imageCache: Map<url, Buffer> — populated after page loads using in-browser fetch (has cookies).
async function fetchPageHtml(browser, url, cfg, imageCache) {
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

        // Let JS settle
        await sleep(800 + Math.random() * 400);

        // Scroll to trigger lazy images
        await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight / 2);
        });
        await sleep(400);
        await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
        });
        await sleep(600);

        // Scroll back to top (matches human behaviour)
        await page.evaluate(() => window.scrollTo(0, 0));
        await sleep(300);

        const html = await page.content();

        // Capture guide images using the browser's own fetch (has cookies/session)
        if (imageCache) {
            await captureGuideImages(page, imageCache);
        }

        return html;
    } finally {
        await page.close();
    }
}

// Fetch images found in the guide content area using the browser's session.
// Transfers image data via CDP as base64 — bypasses auth/hotlink protection.
async function captureGuideImages(page, imageCache) {
    // Collect absolute image URLs from the guide content region
    const imgUrls = await page.evaluate(() => {
        const root = document.querySelector('#faqwrap') ?? document.body;
        return [...root.querySelectorAll('img[src]')]
            .map(img => img.src)
            .filter(src => src && !src.startsWith('data:'));
    });

    const unique = [...new Set(imgUrls)];
    if (unique.length > 0) process.stdout.write(`    [imgs] fetching ${unique.length} unique... `);
    for (const imgUrl of unique) {
        if (imageCache.has(imgUrl)) { process.stdout.write('~'); continue; }
        try {
            // Use browser-side fetch — inherits cookies and session headers
            const b64 = await page.evaluate(async (src) => {
                try {
                    const res = await fetch(src, { credentials: 'include' });
                    if (!res.ok) return null;
                    const buf = await res.arrayBuffer();
                    // Safe loop (spread operator crashes on large images)
                    const u8 = new Uint8Array(buf);
                    let binary = '';
                    for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
                    return btoa(binary);
                } catch {
                    return null;
                }
            }, imgUrl);

            if (b64) {
                imageCache.set(imgUrl, Buffer.from(b64, 'base64'));
                process.stdout.write('.');
            } else {
                process.stdout.write('x');
            }
        } catch { process.stdout.write('!'); }
    }
    if (unique.length > 0) process.stdout.write('\n');
}

// ── TOC extraction ────────────────────────────────────────────────────────────

// Extract ordered section slugs from the page's table of contents.
//
// GameFAQs TOC links use bare relative hrefs — just the slug with no path:
//   <div class="toc_menu"><a href="introduction">Introduction</a> ...
// So we use Cheerio to find .toc_menu a[href] and collect href values directly.
//
// Falls back to a full-path regex scan if .toc_menu is absent (future-proofing).
function extractTocLinks(html, faqId) {
    const $    = cheerio.load(html);
    const seen = new Set();
    const links = [];

    // Primary: GameFAQs .toc_menu — links are bare slug hrefs
    const tocEl = $('.toc_menu');
    if (tocEl.length) {
        tocEl.find('a[href]').each((_, el) => {
            const href = $(el).attr('href') ?? '';
            // Keep only bare slug hrefs (no slashes, no protocol, not empty)
            const slug = href.trim();
            if (slug && !slug.includes('/') && !slug.startsWith('#') && !slug.startsWith('http') && !seen.has(slug)) {
                seen.add(slug);
                links.push(slug);
            }
        });

        if (links.length > 0) {
            return links;
        }
        console.warn('[fetcher] .toc_menu found but contained no slug links — falling back to href scan');
    }

    // Fallback: scan all hrefs for full-path guide links (/faqs/{faqId}/slug)
    const pattern = new RegExp(`/faqs/${faqId}/([^/?#"\\s]+)`, 'g');
    let m;
    while ((m = pattern.exec(html)) !== null) {
        const slug = m[1];
        if (!seen.has(slug)) {
            seen.add(slug);
            links.push(slug);
        }
    }

    return links;
}

// Build the absolute URL for a section slug
function sectionUrl(baseUrl, faqId, slug) {
    const { origin, pathname } = new URL(baseUrl);
    // pathname: /{platform}/{game}/faqs/{faqId}/...
    const base = pathname.replace(new RegExp(`/faqs/${faqId}.*$`), '');
    return `${origin}${base}/faqs/${faqId}/${slug}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch all pages of a GameFAQs HTML guide and save raw HTML to rawDir.
 *
 * @param {string}  startUrl - Any section URL of the guide
 * @param {string}  rawDir   - Directory to write .html files and _manifest.json
 * @param {object}  cfg      - Config from guides/config.js
 * @param {object}  [opts]
 * @param {boolean} [opts.force=false] - Re-fetch pages already on disk
 */
export async function fetchGuide(startUrl, rawDir, cfg, { force = false } = {}) {
    const { faqId } = parseGuideUrl(startUrl);

    await mkdir(rawDir, { recursive: true });

    // Image cache: Map<absoluteUrl, Buffer> populated by Puppeteer response listeners
    const imageCache = new Map();

    const browser = await launchBrowser(cfg);

    try {
        // ── Step 1: load first page to discover TOC ──────────────────────────
        console.log(`[fetcher] Loading entry page to discover TOC...`);
        const firstHtml = await fetchPageHtml(browser, startUrl, cfg, imageCache);

        const slugs = extractTocLinks(firstHtml, faqId);

        if (slugs.length === 0) {
            throw new Error(
                `No TOC links found for faqId=${faqId}. ` +
                `The guide may be a text/ASCII guide (not HTML), require login, or the URL may be wrong.`
            );
        }

        console.log(`[fetcher] Found ${slugs.length} sections: ${slugs.join(', ')}`);

        // ── Step 2: fetch each section ───────────────────────────────────────
        const pages    = [];

        for (let i = 0; i < slugs.length; i++) {
            const slug    = slugs[i];
            const file    = `${safeFilename(slug)}.html`;
            const destPath = join(rawDir, file);
            const url     = sectionUrl(startUrl, faqId, slug);

            process.stdout.write(`  [${i + 1}/${slugs.length}] ${slug} ... `);

            // Use cached version unless --force
            if (!force) {
                try {
                    const { access } = await import('node:fs/promises');
                    await access(destPath);
                    console.log('skipped (cached)');
                    pages.push({ slug, url, file });
                    continue;
                } catch { /* not on disk, fetch it */ }
            }

            try {
                // Reuse the already-fetched HTML for the first page
                const html = (i === 0) ? firstHtml : await fetchPageHtml(browser, url, cfg, imageCache);
                await writeFile(destPath, html, 'utf8');
                console.log(`✓ (${Math.round(html.length / 1024)}kb)`);
                pages.push({ slug, url, file });
            } catch (err) {
                console.log(`✗ ${err.message}`);
                // Don't abort the whole run on one bad page
            }

            // Polite delay between requests (skip after last page)
            if (i < slugs.length - 1) {
                const delay = jitter(cfg.fetch.delayMinMs, cfg.fetch.delayMaxMs);
                process.stdout.write(`  (waiting ${delay}ms)\n`);
                await sleep(delay);
            }
        }

        // ── Step 3: write manifest ────────────────────────────────────────────
        const manifest = {
            source:    'gamefaqs',
            faqId,
            sourceUrl: startUrl,
            fetchedAt: new Date().toISOString(),
            pages,
        };

        await writeFile(join(rawDir, '_manifest.json'), JSON.stringify(manifest, null, 2));
        console.log(`\n[fetcher] Wrote _manifest.json (${pages.length} pages)`);

        // ── Step 4: flush image cache to disk ────────────────────────────────
        if (imageCache.size > 0) {
            const imgDir  = join(rawDir, 'img');
            await mkdir(imgDir, { recursive: true });

            const { createHash } = await import('node:crypto');
            const { extname }    = await import('node:path');

            const urlMap = {};
            let saved = 0;

            for (const [url, buf] of imageCache) {
                try {
                    const parsed  = new URL(url);
                    const ext     = extname(parsed.pathname).split('?')[0].toLowerCase() || '.jpg';
                    const hash    = createHash('md5').update(url).digest('hex').slice(0, 8);
                    const filename = `${hash}${ext}`;
                    const dest    = join(imgDir, filename);
                    await writeFile(dest, buf);
                    urlMap[url] = `img/${filename}`;
                    saved++;
                } catch { /* skip on error */ }
            }

            await writeFile(join(rawDir, '_image_cache.json'), JSON.stringify(urlMap, null, 2));
            console.log(`[fetcher] Saved ${saved} images to _raw/img/`);
        }

        return manifest;

    } finally {
        await browser.close().catch(() => {});
        console.log('[fetcher] Browser closed');
    }
}
