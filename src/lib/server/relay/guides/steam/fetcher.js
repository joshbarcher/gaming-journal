/**
 * Steam community guide fetcher.
 *
 * Steam guide pages load all sections in a single HTML document at:
 *   https://steamcommunity.com/sharedfiles/filedetails/?id={guideId}
 *
 * DOM structure (discovered by live inspection):
 *
 *   div.guide.subSections
 *     div.subSection.detailBox[id="{sectionId}"]   ← each authored section
 *       div.subSectionTitle                          ← section heading
 *       div.subSectionDesc                           ← BBCode-rendered content
 *
 *   div.rightbox_list_option[id="guideSectionSelection_{sectionId}"]
 *     div.guideSubSectionSelectionLink               ← nav label
 *
 * Section IDs to skip:
 *   "0"  = "Overview" (Steam's "show all" default — not a real authored section)
 *   "-1" = "Comments" (comments thread)
 *
 * Strategy: fetch the page once with Puppeteer, then use cheerio to slice each
 * section into its own {slug}.html file. The manifest lists one entry per section.
 * parse-guide.js reads each file independently — no special anchor-slicing needed.
 *
 * Each section file embeds hidden .workshopItemTitle and .friendBlockContent divs
 * so extractTitle/extractAuthor work without needing the full raw page.
 */

import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin  from 'puppeteer-extra-plugin-stealth';
import * as cheerio   from 'cheerio';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join }                               from 'node:path';

puppeteerExtra.use(StealthPlugin());

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function titleToSlug(label) {
    return label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

// ── Browser setup ─────────────────────────────────────────────────────────────

async function launchBrowser() {
    const browser = await puppeteerExtra.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    console.log('[fetcher:steam] Browser launched');
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
        if (['media', 'font', 'image'].includes(req.resourceType())) req.abort();
        else req.continue();
    });
    return page;
}

async function fetchPageHtml(browser, url, cfg) {
    const page = await newPage(browser, cfg);
    try {
        const { hostname } = new URL(url);
        await page.setCookie(
            { name: 'birthtime',      value: '631152001', domain: hostname },
            { name: 'mature_content', value: '1',         domain: hostname },
        );

        console.log(`  GET ${url}`);
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: cfg.fetch.timeout });
        if (!response || !response.ok()) throw new Error(`HTTP ${response?.status() ?? '?'} for ${url}`);

        await sleep(800 + Math.random() * 400);
        return await page.content();
    } finally {
        await page.close();
    }
}

// ── Section extraction ────────────────────────────────────────────────────────

/**
 * Extract the ordered section list from the right-sidebar nav.
 * Skips sectionId "0" (Overview = show-all default) and "-1" (Comments).
 */
function extractSections($) {
    const seen  = new Set();
    const items = [];

    $('.rightbox_list_option').each((_, el) => {
        const rawId     = $(el).attr('id') ?? '';
        const sectionId = rawId.replace('guideSectionSelection_', '');
        if (sectionId === '0' || sectionId === '-1') return;
        if (!sectionId || seen.has(sectionId)) return;
        seen.add(sectionId);

        const label = $(el).find('.guideSubSectionSelectionLink').text().trim();
        if (!label) return;

        items.push({ sectionId, label, slug: titleToSlug(label) });
    });

    return items;
}

/**
 * Extract guide-level metadata (title + author) from the full page.
 * Author: .friendBlockContent contains "Name\n\t\tOffline" — take only the first line.
 */
function extractGuideMeta($) {
    const title = $('div.workshopItemTitle').first().text().trim() || 'Steam Guide';

    const rawAuthor = $('div.friendBlockContent').first().text();
    const author    = rawAuthor ? rawAuthor.split('\n')[0].trim() || null : null;

    return { title, author };
}

/**
 * Build a standalone HTML file for one section.
 *
 * Embeds .workshopItemTitle and .friendBlockContent (already cleaned) so
 * adapter extractTitle / extractAuthor work without the full page.
 * Content is scoped to .subSectionDesc — the adapter targets that selector.
 */
function buildSectionHtml($, sectionId, label, guideTitle, guideAuthor) {
    const subSection = $(`.subSection[id="${sectionId}"]`);
    if (!subSection.length) return null;

    const descHtml   = subSection.find('.subSectionDesc').html() ?? '';
    const authorHtml = guideAuthor
        ? `<div class="friendBlockContent">${guideAuthor}</div>`
        : '';

    return (
        `<!DOCTYPE html><html><head><meta charset="utf-8">` +
        `<title>${guideTitle} — ${label}</title></head><body>` +
        `<div class="workshopItemTitle">${guideTitle}</div>` +
        `${authorHtml}` +
        `<div class="subSectionDesc">${descHtml}</div>` +
        `</body></html>`
    );
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch a Steam community guide and save one HTML file per section to rawDir.
 *
 * @param {string}  guideUrl  - https://steamcommunity.com/sharedfiles/filedetails/?id=12345
 * @param {string}  rawDir    - Directory to write section .html files and _manifest.json
 * @param {object}  cfg       - Config from guides/config.js
 * @param {object}  [opts]
 * @param {boolean} [opts.force=false] - Re-fetch even if already on disk
 */
export async function fetchGuide(guideUrl, rawDir, cfg, { force = false } = {}) {
    const guideId = new URL(guideUrl).searchParams.get('id');
    if (!guideId) throw new Error(`Could not extract guide ID from URL: ${guideUrl}`);

    await mkdir(rawDir, { recursive: true });

    const manifestPath = join(rawDir, '_manifest.json');
    if (!force) {
        try {
            await access(manifestPath);
            const existing = JSON.parse(await readFile(manifestPath, 'utf8'));
            if (existing.pages?.length > 0) {
                console.log(`[fetcher:steam] already on disk with ${existing.pages.length} sections — skipping fetch`);
                return existing;
            }
        } catch { /* not cached */ }
    }

    const browser = await launchBrowser();

    try {
        const html = await fetchPageHtml(browser, guideUrl, cfg);
        const $    = cheerio.load(html);

        const sections = extractSections($);
        if (sections.length === 0) {
            throw new Error(
                `No guide sections found in nav sidebar. ` +
                `The guide may require login, be deleted, or have no authored sections.`
            );
        }
        console.log(`[fetcher:steam] Found ${sections.length} sections`);

        const { title: guideTitle, author: guideAuthor } = extractGuideMeta($);
        console.log(`[fetcher:steam] Title: "${guideTitle}"`);
        if (guideAuthor) console.log(`[fetcher:steam] Author: "${guideAuthor}"`);

        // Dedup slugs: duplicate labels get a -{sectionId} suffix
        const slugCount = {};
        for (const s of sections) {
            slugCount[s.slug] = (slugCount[s.slug] ?? 0) + 1;
            if (slugCount[s.slug] > 1) s.slug = `${s.slug}-${s.sectionId}`;
        }

        // Save full raw page for reference (parse step does not use this file)
        await writeFile(join(rawDir, '_raw.html'), html, 'utf8');

        const fetchedPages = [];
        for (const [i, sec] of sections.entries()) {
            const file     = `${sec.slug}.html`;
            const destPath = join(rawDir, file);

            const sectionHtml = buildSectionHtml($, sec.sectionId, sec.label, guideTitle, guideAuthor);
            if (!sectionHtml) {
                console.log(`  [${i + 1}/${sections.length}] ${sec.slug} — subSection not found in DOM (skipped)`);
                continue;
            }

            await writeFile(destPath, sectionHtml, 'utf8');
            console.log(`  [${i + 1}/${sections.length}] ${sec.slug} ✓`);
            fetchedPages.push({
                slug:      sec.slug,
                label:     sec.label,
                sectionId: sec.sectionId,
                url:       guideUrl,
                file,
            });
        }

        const manifest = {
            source:    'steam',
            guideId,
            sourceUrl: guideUrl,
            title:     guideTitle,
            author:    guideAuthor,
            fetchedAt: new Date().toISOString(),
            pages:     fetchedPages,
        };

        await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
        console.log(`\n[fetcher:steam] Wrote _manifest.json (${fetchedPages.length} sections)`);

        return manifest;

    } finally {
        await browser.close().catch(() => {});
        console.log('[fetcher:steam] Browser closed');
    }
}
