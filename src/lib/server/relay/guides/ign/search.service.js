/**
 * IGN wiki guide search service.
 *
 * IGN wiki slugs are predictable kebab-case game names, so we try a direct
 * URL probe first before falling back to DuckDuckGo.
 *
 * Strategy:
 *   1. Normalize game name → candidate slugs (kebab-case variants)
 *   2. HEAD-probe each slug at ign.com/wikis/{slug} — first 200 wins
 *   3. Fallback: DuckDuckGo `site:ign.com/wikis "{gameName}"`, parse results
 *
 * Returns:
 *   { status: 'found', wikiSlug, wikiName, wikiUrl, score }
 *   { status: 'not_found' }
 *   { status: 'error', error }
 */

import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin  from 'puppeteer-extra-plugin-stealth';
import * as cheerio   from 'cheerio';

puppeteerExtra.use(StealthPlugin());

// ── Helpers ───────────────────────────────────────────────────────────────────

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Re-use the same normalize + nameSimilarity logic as the GameFAQs adapter
// (imported here so both share identical matching behaviour).
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

export function nameSimilarity(a, b) {
    const na = normalize(a);
    const nb = normalize(b);
    if (na === nb) return 1.0;
    if (na.startsWith(nb) || nb.startsWith(na)) return 0.9;

    const keep = w => /^\d+$/.test(w) || w.length > 2;
    const wa = na.split(' ').filter(keep);
    const wb = new Set(nb.split(' ').filter(keep));
    if (wa.length === 0) return 0;
    const shared = wa.filter(w => wb.has(w)).length;
    return shared / Math.max(wa.length, wb.size);
}

/**
 * Convert a game name to candidate IGN wiki slugs.
 * Generates several variants to maximise the chance of a direct probe hit.
 *
 * "Trails in the Sky 1st Chapter" →
 *   ["trails-in-the-sky-1st-chapter", "trails-sky-1st-chapter", ...]
 */
export function nameToCandidateSlugs(name, year = null) {
    const base = normalize(name);
    const slug = base.replace(/\s+/g, '-');

    const variants = [];

    // When we have a year, try the most specific slugs first to avoid landing on
    // an older game with the same name (e.g. RE2 1998 vs RE2 Remake 2019)
    if (year) {
        variants.push(`${slug}-${year}`);
        variants.push(`${slug}-remake`);
        variants.push(`${slug}-remaster`);
    }
    variants.push(slug);

    // Drop common noise words for a shorter slug variant
    const STOP = new Set(['the', 'and', 'of', 'in', 'a', 'an', 'to', 'for']);
    const short = base.split(' ').filter(w => !STOP.has(w)).join('-');
    if (short && short !== slug) {
        if (year) variants.push(`${short}-${year}`);
        variants.push(short);
    }

    return [...new Set(variants)].filter(s => s.length > 0);
}

// ── Browser setup ─────────────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export async function launchBrowser() {
    const browser = await puppeteerExtra.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    return browser;
}

async function setupPage(browser) {
    const page = await browser.newPage();
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

// ── Direct slug probe ─────────────────────────────────────────────────────────

/**
 * Try to load ign.com/wikis/{slug} and confirm it's a real wiki.
 * Returns the page title on success, or null on 404/error.
 */
async function probeSlug(browser, slug) {
    const url  = `https://www.ign.com/wikis/${slug}`;
    const page = await setupPage(browser);
    try {
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        const status = res?.status() ?? 0;
        if (status === 404 || status >= 400) return null;

        // Verify it's actually a wiki page (not a redirect to ign.com home)
        const finalUrl = page.url();
        if (!finalUrl.includes('/wikis/')) return null;

        // Extract game name from page title: "X Guide - IGN" → "X"
        const title = await page.title();
        const m     = title.match(/^(.+?)\s+Guide\s*[-–]/i);
        const name  = m ? m[1].trim() : title.replace(/\s*[-–]\s*IGN\s*$/i, '').trim();

        return { slug, name, url: finalUrl };
    } catch {
        return null;
    } finally {
        await page.close();
    }
}

// ── DuckDuckGo fallback ───────────────────────────────────────────────────────

const IGN_WIKI_RE = /ign\.com\/wikis\/([a-z0-9-]+)(?:\/[^"'\s]*)?/i;

async function searchViaDuckDuckGo(browser, gameName, { debug = false, year = null } = {}) {
    const query = year
        ? `site:ign.com/wikis "${gameName}" ${year} guide`
        : `site:ign.com/wikis "${gameName}" guide`;
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

            const m = resolved.match(IGN_WIKI_RE);
            if (!m) return;

            const wikiSlug = m[1].toLowerCase();
            // Skip non-wiki paths
            if (['wikis'].includes(wikiSlug)) return;
            if (seen.has(wikiSlug)) return;
            seen.add(wikiSlug);

            const linkText = $(el).text().trim().replace(/\s*[-–]\s*IGN\s*$/i, '').replace(/\s+Guide\s*$/i, '').trim();
            const score    = nameSimilarity(gameName, linkText || wikiSlug.replace(/-/g, ' '));

            if (debug) console.log(`  [debug] ddg candidate: "${linkText}" slug=${wikiSlug} score=${score.toFixed(2)}`);
            if (score < 0.25) return;

            candidates.push({
                wikiSlug,
                wikiName: linkText || wikiSlug.replace(/-/g, ' '),
                wikiUrl:  `https://www.ign.com/wikis/${wikiSlug}`,
                score,
            });
        });

        return candidates.sort((a, b) => b.score - a.score);
    } finally {
        await page.close();
    }
}

// ── Public: searchGame ────────────────────────────────────────────────────────

/**
 * Search IGN for a game's wiki and return the result.
 *
 * @param {Browser} browser   - Puppeteer browser instance
 * @param {string}  gameName  - Steam game name
 * @param {object}  [opts]
 * @param {boolean} [opts.debug]
 * @param {number}  [opts.minScore=0.6]
 *
 * @returns {{ status: 'found'|'not_found'|'error', wikiSlug?, wikiName?, wikiUrl?, score?, error? }}
 */
export async function searchGame(browser, gameName, { debug = false, minScore = 0.6, releaseYear = null } = {}) {
    try {
        // ── Phase 1: direct slug probe ────────────────────────────────────────
        const candidateSlugs = nameToCandidateSlugs(gameName, releaseYear);
        if (debug) console.log(`  [debug] probing slugs: ${candidateSlugs.join(', ')}`);

        for (const slug of candidateSlugs) {
            const result = await probeSlug(browser, slug);
            if (!result) continue;

            // If the probed page's name contains a year that doesn't match our release
            // year, it's a different version of the game — skip it.
            if (releaseYear) {
                const resultYearMatch = result.name.match(/\b(19|20)\d{2}\b/);
                if (resultYearMatch && Number(resultYearMatch[0]) !== releaseYear) {
                    if (debug) console.log(`  [debug] year mismatch: result "${result.name}" is ${resultYearMatch[0]}, expected ${releaseYear} — skipping`);
                    await sleep(800 + Math.random() * 500);
                    continue;
                }
            }

            const score = nameSimilarity(gameName, result.name);
            if (debug) console.log(`  [debug] probe hit: slug=${slug} name="${result.name}" score=${score.toFixed(2)}`);

            if (score >= minScore) {
                return { status: 'found', wikiSlug: slug, wikiName: result.name, wikiUrl: result.url, score };
            }

            await sleep(800 + Math.random() * 500);
        }

        // ── Phase 2: DuckDuckGo fallback ─────────────────────────────────────
        if (debug) console.log(`  [debug] slug probe missed, trying DuckDuckGo…`);
        const ddgResults = await searchViaDuckDuckGo(browser, gameName, { debug, year: releaseYear });

        if (ddgResults.length === 0) return { status: 'not_found' };

        // When we have a release year the DDG query is already year-filtered, so
        // the link-text score is unreliable (slugs like "re2-remake" score 0 against
        // "Resident Evil 2"). Instead, probe the top candidates and score by page title.
        const ddgCandidates = releaseYear
            ? ddgResults                                            // trust the year-filtered query
            : ddgResults.filter(r => r.score >= minScore);

        if (ddgCandidates.length === 0) return { status: 'not_found' };

        for (const candidate of ddgCandidates.slice(0, 3)) {
            await sleep(1000 + Math.random() * 500);
            const confirmed = await probeSlug(browser, candidate.wikiSlug);
            if (!confirmed) continue;

            // Score against the real page title — much more reliable than the slug
            const titleScore = nameSimilarity(gameName, confirmed.name);
            if (debug) console.log(`  [debug] ddg confirmed: slug=${candidate.wikiSlug} title="${confirmed.name}" score=${titleScore.toFixed(2)}`);

            if (titleScore >= minScore) {
                return {
                    status:   'found',
                    wikiSlug: candidate.wikiSlug,
                    wikiName: confirmed.name,
                    wikiUrl:  confirmed.url,
                    score:    titleScore,
                };
            }
        }

        return { status: 'not_found' };

    } catch (err) {
        return { status: 'error', error: err.message };
    }
}
