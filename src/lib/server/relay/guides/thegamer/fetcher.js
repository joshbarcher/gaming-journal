/**
 * TheGamer (thegamer.com) guide fetcher.
 *
 * A "guide" on TheGamer is an article, but the interesting guides are multi-part:
 *   - A series (e.g. the 12 monthly Persona 5 Royal walkthroughs)
 *   - A hub (e.g. the Baldur's Gate 3 complete guide) that links to many sub-articles
 *
 * Every page of such a guide carries the same in-article "directory" dropdown
 * (nav.article-directory-sidenav) listing all the related pages. We read that
 * directory from the start page and crawl the pages whose slug shares the same
 * base prefix as the start slug (e.g. "persona-5-royal", "baldurs-gate-3") — the
 * site groups its own guide set that way. Standalone articles (no directory)
 * download as a single page.
 *
 * After that set is fetched, we take ONE more hop: every thegamer.com article
 * linked from the prose of a directory page (the inline "RELATED:" lines, mostly)
 * is fetched too and marked `related: true` in the manifest. Without it those links
 * either vanish (stripped as external) or bounce the reader out of the app — the
 * point of keeping them is to not leave the guide.
 *
 * ── Crawl cache (_raw/_crawl-cache.json) ────────────────────────────────────
 *
 * A re-run must not redo work whose answer cannot have changed. Without the cache a
 * fully warm run still issued 179 requests and re-parsed 578 documents, because three
 * results were never written down:
 *
 *   dead slugs   — a 404 leaves nothing on disk, so all 145 were re-fetched every run
 *   allowlist    — 31 tag-listing pages re-fetched every run to rebuild the same set
 *   page derivations — every cached page was re-read from the share and re-parsed
 *                  (~3 cheerio passes each) just to recover its links and tags
 *
 * All three are now persisted and keyed so they self-invalidate:
 *   - a page entry is stale if its HTML's mtime/size changed
 *   - `dead` entries are retried after DEAD_RETRY_DAYS (articles come back)
 *   - the allowlist is refetched after ALLOWLIST_TTL_DAYS (new articles get tagged)
 *   - `offTopic` verdicts are dropped wholesale if the root tags change, since the
 *     verdict was relative to them
 *   - `--force` ignores all of it
 *
 * The guide ID stored on disk is the start article slug.
 */

import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin  from 'puppeteer-extra-plugin-stealth';
import { mkdir, writeFile, access, readFile, stat } from 'node:fs/promises';
import { join }             from 'node:path';
import * as cheerio          from 'cheerio';

import { loadAndClean } from '../parser/html-cleaner.js';
import {
    pageSlugFromHref, slugToLabel,
    preprocessRawHtml, resolveContentSelector, buildAdapter,
    extractArticleTags, extractTagListingSlugs,
} from './adapter.js';

puppeteerExtra.use(StealthPlugin());

// Runaway guard, not a tuning knob. Covers the directory pages plus the depth-1
// related hop. Truncation is logged; raise it rather than let a guide silently lose
// pages. (BG3 hub is ~218 directory pages before related links.)
const MAX_PAGES     = 1000;
// A base prefix must be shared by at least this fraction of directory links.
const MIN_COVERAGE  = 0.5;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitter(minMs, maxMs) { return minMs + Math.floor(Math.random() * (maxMs - minMs)); }

// ── Download progress ───────────────────────────────────────────────────────
//
// The job queue's default is to scrape "[n/N]" out of stdout, which assumes the page
// count is known before fetching. A BFS discovers its page set as it walks, so this
// fetcher reports structured progress instead and the queue stops scraping.
//
// The total is unknowable mid-walk, so the bar is split into phases: the directory set
// (known size), the tag listing, then the BFS — which reports done/(done+pending),
// clamped monotonic so a growing frontier never rewinds the bar.
const PHASE = { directory: [0, 40], tags: [40, 50], bfs: [50, 99] };
let _downloadPct = 0;

function emitDownload(phase, done, total) {
    const [lo, hi] = PHASE[phase];
    const frac = total > 0 ? Math.min(done / total, 1) : 0;
    const pct  = Math.max(_downloadPct, Math.round(lo + frac * (hi - lo)));
    if (pct === _downloadPct) return;
    _downloadPct = pct;
    process.stdout.write(`[PROGRESS] ${JSON.stringify({ bar: 'download', pct })}\n`);
}

function emitDownloadDone() {
    _downloadPct = 100;
    process.stdout.write(`[PROGRESS] ${JSON.stringify({ bar: 'download', pct: 100 })}\n`);
}

// Test hook: the emitter's monotonicity is the property worth pinning, and it lives in
// module state that a caller otherwise can't reach.
export const __progressForTests = {
    emitDownload, emitDownloadDone, reset: () => { _downloadPct = 0; },
};

function safeFilename(slug) {
    return slug.replace(/[^a-z0-9_-]/gi, '-').toLowerCase() + '.html';
}

// ── Base-prefix derivation ──────────────────────────────────────────────────

/**
 * Derive the base slug prefix that identifies this guide set. Walk the start
 * slug's hyphen segments from longest to shortest and return the longest prefix
 * that a majority (>= MIN_COVERAGE) of the directory candidate slugs share.
 *
 *   start "persona-5-royal-april-walkthrough-guide" + directory → "persona-5-royal"
 *   start "baldurs-gate-3-bg3-complete-guide-walkthrough" + dir  → "baldurs-gate-3"
 */
export function baseSlugPrefix(startSlug, candidateSlugs) {
    const segs = startSlug.split('-');
    const others = candidateSlugs.filter(s => s !== startSlug);
    const pool = others.length ? others : candidateSlugs;
    if (!pool.length) return segs.slice(0, Math.min(2, segs.length)).join('-');

    for (let n = segs.length - 1; n >= 2; n--) {
        const prefix  = segs.slice(0, n).join('-');
        const matches = pool.filter(s => s === prefix || s.startsWith(prefix + '-')).length;
        if (matches / pool.length >= MIN_COVERAGE) return prefix;
    }
    return segs.slice(0, Math.min(2, segs.length)).join('-');
}

// ── Browser setup ───────────────────────────────────────────────────────────

async function launchBrowser() {
    const browser = await puppeteerExtra.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    console.log('[fetcher:thegamer] Browser launched');
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
        // Images are downloaded later from their CDN URLs — skip them during fetch.
        if (['media', 'font', 'image'].includes(req.resourceType())) req.abort();
        else req.continue();
    });
    return page;
}

async function fetchPageHtml(browser, url, cfg) {
    const page = await newPage(browser, cfg);
    try {
        console.log(`  GET ${url}`);
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: cfg.fetch.timeout });
        if (!response || !response.ok()) {
            // Carry the status so callers can tell "this article is gone" from "the site
            // is unhappy right now". Only the former belongs in the dead cache.
            const err = new Error(`HTTP ${response?.status() ?? '?'} for ${url}`);
            err.status = response?.status() ?? null;
            throw err;
        }
        // TheGamer is server-rendered; a short settle covers the directory sidenav.
        await sleep(500 + Math.random() * 400);
        return await page.content();
    } finally {
        await page.close();
    }
}

// ── Directory extraction ────────────────────────────────────────────────────

/**
 * Extract the ordered, deduped list of guide pages from the in-article directory
 * dropdown. Returns [{ slug, label, url }].
 */
function extractDirectoryLinks(html, baseUrl) {
    const $ = cheerio.load(html);
    const seen  = new Set();
    const pages = [];
    $('nav.article-directory-sidenav a[href], .article-directory-sidenav a[href]').each((_, el) => {
        const href = $(el).attr('href') ?? '';
        const slug = pageSlugFromHref(href);
        if (!slug || seen.has(slug)) return;
        seen.add(slug);
        const label = $(el).text().trim() || slugToLabel(slug);
        let url;
        try { url = new URL(href, baseUrl).href; } catch { return; }
        pages.push({ slug, label, url });
    });
    return pages;
}

// ── Related-article extraction (the depth-1 hop) ────────────────────────────

/**
 * Collect thegamer.com articles linked from a page's *prose*.
 *
 * Scoped to the content region with junk selectors applied — the same view the
 * parser gets — so site chrome never leaks in. Without that filtering the raw HTML
 * yields `feed` (174 hits) and `trending-guides` (87) alongside real articles.
 *
 * Returns a Map of slug → number of links to it, so callers can rank by how often
 * the guide actually refers to a page.
 */
export function extractRelatedSlugs(html, counts = new Map()) {
    const relativized = preprocessRawHtml(html, '');

    let contentSelector;
    try {
        contentSelector = resolveContentSelector(cheerio.load(relativized));
    } catch {
        return counts; // no content region (interstitial, error page) — nothing to harvest
    }

    const { $, content } = loadAndClean(relativized, buildAdapter(contentSelector));

    $(content).find('a[href]').each((_, el) => {
        const slug = pageSlugFromHref($(el).attr('href'));
        if (slug) counts.set(slug, (counts.get(slug) ?? 0) + 1);
    });
    return counts;
}

/**
 * Rank the harvested slugs: most-linked first, ties broken alphabetically so a
 * re-fetch produces the same page set (no Math.random, no Map-insertion drift).
 */
function rankRelated(counts, exclude) {
    return [...counts.entries()]
        .filter(([slug]) => !exclude.has(slug))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([slug]) => slug);
}

// ── Crawl cache ─────────────────────────────────────────────────────────────

const CACHE_FILE         = '_crawl-cache.json';
const CACHE_VERSION      = 1;
// A 404 today may be a live article next month; retry occasionally rather than never.
const DEAD_RETRY_DAYS    = 30;
// New articles get tagged over time, so the allowlist goes stale — but not per-run.
const ALLOWLIST_TTL_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

function emptyCache() {
    return { version: CACHE_VERSION, rootTags: [], allowlist: null, pages: {}, dead: {}, offTopic: {} };
}

export async function loadCrawlCache(rawDir, now = Date.now()) {
    let cache;
    try {
        cache = JSON.parse(await readFile(join(rawDir, CACHE_FILE), 'utf8'));
    } catch {
        return emptyCache(); // absent or corrupt — rebuild rather than fail the crawl
    }
    if (cache?.version !== CACHE_VERSION) return emptyCache();

    for (const [slug, entry] of Object.entries(cache.dead ?? {})) {
        // Expire so deleted-then-restored articles get another chance.
        if (now - (entry.at ?? 0) > DEAD_RETRY_DAYS * DAY_MS) { delete cache.dead[slug]; continue; }
        // Entries written before failures were classified may record a transient error as
        // permanent. Drop anything that isn't provably a 404/410 and let it be re-checked.
        if (entry.status === undefined && !/HTTP (404|410) /.test(entry.error ?? '')) delete cache.dead[slug];
    }
    return { ...emptyCache(), ...cache };
}

async function saveCrawlCache(rawDir, cache) {
    try {
        await writeFile(join(rawDir, CACHE_FILE), JSON.stringify(cache), 'utf8');
    } catch (err) {
        console.log(`[fetcher:thegamer] Could not write crawl cache: ${err.message}`);
    }
}

export function allowlistIsFresh(cache, rootTags, now = Date.now()) {
    const a = cache.allowlist;
    // `typeof` rather than truthiness: a fetchedAt of 0 is a valid timestamp, not "absent".
    if (typeof a?.fetchedAt !== 'number' || !Array.isArray(a.slugs)) return false;
    if (now - a.fetchedAt > ALLOWLIST_TTL_DAYS * DAY_MS) return false;
    // Built for a different set of tags → meaningless.
    const before = [...(a.tags ?? [])].sort().join(',');
    const after  = [...rootTags].sort().join(',');
    return before === after;
}

export function isDead(cache, slug) {
    return Boolean(cache.dead?.[slug]);
}

/**
 * Should a fetch failure be remembered as "this article is gone"?
 *
 * Only for statuses that mean the URL itself is permanently wrong. Everything else —
 * timeouts, connection resets, 429 rate-limits, 5xx — is the site or the network having
 * a bad minute, and caching it would blacklist a perfectly good article for
 * DEAD_RETRY_DAYS. A crawl that runs while TheGamer is throttling us would otherwise
 * poison the cache with hundreds of false corpses.
 */
export function isPermanentFailure(err) {
    return err?.status === 404 || err?.status === 410;
}

// An off-topic verdict is only meaningful relative to the root tags it was judged against.
export function dropStaleVerdicts(cache, rootTags) {
    const before = [...(cache.rootTags ?? [])].sort().join(',');
    const after  = [...rootTags].sort().join(',');
    if (before !== after) cache.offTopic = {};
    cache.rootTags = [...rootTags];
    return cache;
}

/**
 * Everything the crawl needs from a page's HTML: its title, its tags, and the articles
 * it links to. Derived once and cached against the file's mtime+size, so a warm run
 * performs zero cheerio parses.
 */
function derivePageMeta(html) {
    return {
        label: startTitle(html),
        tags:  [...extractArticleTags(html)],
        links: Object.fromEntries(extractRelatedSlugs(html)),
    };
}

export function cacheEntryMatches(entry, stats) {
    return Boolean(entry) && entry.mtimeMs === stats.mtimeMs && entry.size === stats.size;
}

/**
 * Page meta from the cache when the file hasn't changed, otherwise by parsing it.
 * Returns null when the HTML isn't on disk. `html` may be supplied by the caller when
 * it has just been fetched, to avoid reading it straight back off the share.
 */
async function pageMeta(rawDir, slug, file, cache, { html = null } = {}) {
    const path = join(rawDir, file);

    let stats;
    try { stats = await stat(path); } catch { if (!html) return null; }

    if (!html && stats && cacheEntryMatches(cache.pages[slug], stats)) {
        return { ...cache.pages[slug], cached: true };
    }

    const source = html ?? await readFile(path, 'utf8').catch(() => null);
    if (source === null) return null;

    if (!stats) { try { stats = await stat(path); } catch { /* not written */ } }

    const meta = derivePageMeta(source);
    cache.pages[slug] = { ...meta, mtimeMs: stats?.mtimeMs ?? 0, size: stats?.size ?? 0 };
    return { ...meta, cached: false };
}

// ── Topic bound: which articles belong in this guide ────────────────────────

// A tag must appear on this fraction of the directory pages to count as a root tag.
const TAG_ROOT_MIN_SHARE = 0.1;
// Runaway guard on tag-listing pagination.
const MAX_TAG_PAGES = 40;
// Runaway guard on "fetch it to read its tags" probes for articles the tag listing
// doesn't cover. Each miss costs one wasted page fetch.
const MAX_TOPIC_PROBES = 600;

/**
 * The tags the guide is *about*, learned from the directory pages rather than assumed.
 * For the P5R guide that yields { persona-5-royal, persona-5 }.
 */
export function rootTagsOf(tagSetsByPage, minShare = TAG_ROOT_MIN_SHARE) {
    const pageCount = tagSetsByPage.length;
    if (!pageCount) return new Set();

    const freq = new Map();
    for (const tags of tagSetsByPage) for (const t of tags) freq.set(t, (freq.get(t) ?? 0) + 1);

    return new Set(
        [...freq.entries()].filter(([, n]) => n >= pageCount * minShare).map(([t]) => t),
    );
}

/**
 * Walk `/tag/{tag}/{n}/` and collect every article slug TheGamer files under the guide's
 * root tags. This is the site's own answer to "what is about this game", which is what
 * bounds the crawl — the slug is not a reliable signal (`makoto-persona-5-strikers-…`
 * is on-topic, `persona-5-tactica-…` is a different game).
 */
async function buildTagAllowlist(browser, rootTags, cfg, cache, { force = false } = {}) {
    if (!force && allowlistIsFresh(cache, rootTags)) {
        console.log(`[fetcher:thegamer] Tag allowlist: ${cache.allowlist.slugs.length} article(s) from cache (no tag pages fetched).`);
        return new Set(cache.allowlist.slugs);
    }

    const allow = new Set();

    for (const tag of rootTags) {
        for (let n = 1; n <= MAX_TAG_PAGES; n++) {
            const url = n === 1
                ? `https://www.thegamer.com/tag/${tag}/`
                : `https://www.thegamer.com/tag/${tag}/${n}/`;

            let listed;
            try {
                listed = extractTagListingSlugs(await fetchPageHtml(browser, url, cfg));
            } catch (err) {
                console.log(`  [tag:${tag}] page ${n} — ${err.message}; stopping this tag.`);
                break;
            }

            if (!listed.size) { console.log(`  [tag:${tag}] page ${n} empty — ${allow.size} slug(s) so far.`); break; }

            const before = allow.size;
            for (const s of listed) allow.add(s);
            const added = allow.size - before;
            console.log(`  [tag:${tag}] page ${n}: ${listed.size} listed, +${added} new`);

            // An out-of-range page number can clamp to the last page rather than 404,
            // which would otherwise spin until MAX_TAG_PAGES.
            if (n > 1 && added === 0) { console.log(`  [tag:${tag}] page ${n} added nothing new — end of tag.`); break; }

            if (n === MAX_TAG_PAGES) console.log(`  [tag:${tag}] hit MAX_TAG_PAGES (${MAX_TAG_PAGES}) — allowlist may be incomplete.`);
            // No known total; nudge the bar across the tag band as pages accumulate.
            emitDownload('tags', n, MAX_TAG_PAGES / 2);
            await sleep(jitter(cfg.fetch.delayMinMs, cfg.fetch.delayMaxMs));
        }
    }

    // If every tag listing came back empty this run while a previous run had built a
    // real allowlist, the tag pages were almost certainly blocked (bot-detection /
    // rate-limit / transient error at page 1), not genuinely emptied. Writing slugs:[]
    // with a fresh fetchedAt would make allowlistIsFresh() trust the empty set for
    // ALLOWLIST_TTL_DAYS and suppress retries. Keep the previous allowlist and do NOT
    // re-stamp fetchedAt, so the next run retries.
    const priorCount = cache.allowlist?.slugs?.length ?? 0;
    if (allow.size === 0 && priorCount > 0) {
        console.log(`[fetcher:thegamer] Tag allowlist came back empty but ${priorCount} cached — keeping previous allowlist; next run will retry.`);
        return new Set(cache.allowlist.slugs);
    }

    cache.allowlist = { fetchedAt: Date.now(), tags: [...rootTags], slugs: [...allow] };
    console.log(`[fetcher:thegamer] Tag allowlist: ${allow.size} article(s) from ${rootTags.size} tag listing(s).`);
    return allow;
}

/**
 * Fast path: is this article obviously part of the guide's topic, without fetching it?
 *
 * Tagged with a root tag (per the tag listing), OR sharing the guide's base slug prefix.
 * The prefix clause is not redundant: TheGamer leaves some articles untagged entirely
 * (e.g. `persona-5-royal-best-confidant-hangout-scenes-ranked` carries only
 * `/category/lists/`), and the allowlist can't see those.
 *
 * A `false` here means "unknown", not "off-topic" — the tag index only paginates back
 * through the most recent ~250 articles per tag, so older on-topic articles
 * (`persona-5-kasumi-romance` is tagged persona-5-royal) are missing from it. Callers
 * fall back to `isOnTopicByTags` once the page is in hand.
 */
export function makeTopicFilter(allowlist, basePrefix) {
    return slug =>
        allowlist.has(slug) ||
        Boolean(basePrefix) && (slug === basePrefix || slug.startsWith(basePrefix + '-'));
}

/**
 * Authoritative test, once the article's HTML is available: does it carry a root tag?
 * An untagged article is off-topic here — the prefix fast path already rescued the
 * untagged-but-clearly-ours case.
 */
export function isOnTopicByTags(html, rootTags) {
    for (const tag of extractArticleTags(html)) if (rootTags.has(tag)) return true;
    return false;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch a TheGamer guide (single article or directory-linked set) into rawDir.
 *
 * @param {string}  startUrl
 * @param {string}  rawDir
 * @param {object}  cfg
 * @param {object}  [opts]
 * @param {boolean} [opts.force=false]
 */
export async function fetchGuide(startUrl, rawDir, cfg, { force = false } = {}) {
    const startSlug = pageSlugFromHref(startUrl);
    if (!startSlug) throw new Error(`Unrecognised TheGamer URL: ${startUrl}`);

    await mkdir(rawDir, { recursive: true });

    // Loaded before the browser so a corrupt cache costs nothing; saved in `finally` so a
    // crash mid-crawl still banks the pages and dead slugs already discovered.
    const cache = force ? emptyCache() : await loadCrawlCache(rawDir);
    if (force) console.log('[fetcher:thegamer] --force: ignoring crawl cache.');

    const browser = await launchBrowser();
    try {
        // ── Step 1: fetch the start page, save as _index.html ────────────────
        console.log(`[fetcher:thegamer] Loading start page: ${startUrl}`);
        const indexHtml = await fetchPageHtml(browser, startUrl, cfg);
        await writeFile(join(rawDir, '_index.html'), indexHtml, 'utf8');

        // ── Step 2: build the page set from the directory dropdown ────────────
        const dirLinks = extractDirectoryLinks(indexHtml, startUrl);
        const startEntry = { slug: startSlug, label: startTitle(indexHtml) ?? slugToLabel(startSlug), url: startUrl };

        let pageSet;
        let basePrefix = null;
        if (dirLinks.length >= 2) {
            const base = baseSlugPrefix(startSlug, dirLinks.map(l => l.slug));
            basePrefix = base;
            console.log(`[fetcher:thegamer] Directory has ${dirLinks.length} links; base slug prefix "${base}"`);
            const matching = dirLinks.filter(l => l.slug === base || l.slug.startsWith(base + '-'));

            // Start page first (with its real title label), then the rest in directory order.
            const ordered = [startEntry, ...matching.filter(l => l.slug !== startSlug)];
            const seen = new Set();
            pageSet = ordered.filter(p => (seen.has(p.slug) ? false : seen.add(p.slug)));
        } else {
            console.log(`[fetcher:thegamer] No directory dropdown — single-article guide.`);
            pageSet = [startEntry];
        }

        if (pageSet.length > MAX_PAGES) {
            console.log(`[fetcher:thegamer] Page set (${pageSet.length}) exceeds cap ${MAX_PAGES} — truncating. Dropped: ${pageSet.length - MAX_PAGES} page(s).`);
            pageSet = pageSet.slice(0, MAX_PAGES);
        }
        console.log(`[fetcher:thegamer] Fetching ${pageSet.length} page(s).`);

        // ── Step 3: fetch each page ──────────────────────────────────────────
        const fetchedPages = [];
        for (let i = 0; i < pageSet.length; i++) {
            const { slug, label, url } = pageSet[i];
            const file     = safeFilename(slug);
            const destPath = join(rawDir, file);

            // Emit BEFORE the partial line below: [PROGRESS] must start its own line, and
            // the "  [page n/N] slug ... " prefix is written without a trailing newline.
            emitDownload('directory', i, pageSet.length);
            // "[page n/N]" deliberately does not match the job queue's legacy
            // /\[(\d+)\/(\d+)\]/ scrape — this fetcher drives the bar via [PROGRESS].
            process.stdout.write(`  [page ${i + 1}/${pageSet.length}] ${slug} ... `);

            // Reuse the already-fetched start page rather than re-downloading it.
            const isStart = slug === startSlug;

            if (!force && !isStart) {
                try { await access(destPath); console.log('skipped (cached)'); fetchedPages.push({ slug, label, url, file }); continue; }
                catch { /* not on disk */ }
            }

            try {
                const html = isStart ? indexHtml : await fetchPageHtml(browser, url, cfg);
                await writeFile(destPath, html, 'utf8');
                console.log(`✓ (${Math.round(html.length / 1024)}kb)${isStart ? ' (reused)' : ''}`);
                fetchedPages.push({ slug, label, url, file });
            } catch (err) {
                console.log(`✗ ${err.message}`);
            }

            const isLast = i === pageSet.length - 1;
            if (!isStart && !isLast) {
                await sleep(jitter(cfg.fetch.delayMinMs, cfg.fetch.delayMaxMs));
            }
        }

        // ── Step 3b: derive each directory page's tags + outbound links ──────
        //
        // One pass, cached. This used to be two passes over the same 86 files: once to
        // read tags, again to seed the BFS frontier.
        const directoryMeta = [];
        for (const page of fetchedPages) {
            // Under --force the directory loop above rewrote these files, so mtime moved
            // and the cache misses naturally — no need to pass force down.
            const meta = await pageMeta(rawDir, page.slug, page.file, cache);
            if (meta) directoryMeta.push(meta);
        }
        const reparsed = directoryMeta.filter(m => !m.cached).length;
        console.log(`[fetcher:thegamer] Directory meta: ${directoryMeta.length - reparsed} cached, ${reparsed} parsed.`);

        const rootTags = rootTagsOf(directoryMeta.map(m => new Set(m.tags)));
        console.log(`[fetcher:thegamer] Root tags: ${rootTags.size ? [...rootTags].join(', ') : '(none — falling back to slug prefix)'}`);

        // An off-topic verdict was judged against the old root tags; if those moved, the
        // verdicts are meaningless and every rejected slug deserves another look.
        dropStaleVerdicts(cache, rootTags);

        // ── Step 3c: the site's own list of articles about this game ─────────
        const allowlist = rootTags.size ? await buildTagAllowlist(browser, rootTags, cfg, cache, { force }) : new Set();

        const onTopic = makeTopicFilter(allowlist, basePrefix);

        // ── Step 3d: BFS the prose links, bounded by topic ───────────────────
        //
        // These pages link densely back into each other, so an unbounded walk would
        // drag in the whole site (245 new slugs at depth 2, most of them unrelated).
        //
        // Two-tier bound. The allowlist/prefix filter is a *fast path*: it accepts an
        // article without fetching it. A miss is not a rejection — the tag index only
        // paginates back through the most recent ~250 articles per tag, so older
        // on-topic ones are absent from it. Those get fetched once and judged by their
        // own tag strip, then discarded if they don't carry a root tag. That costs a
        // wasted fetch per off-topic article, and is the only way to see them at all.
        const directorySlugs = new Set(fetchedPages.map(p => p.slug));
        const visited  = new Set(directorySlugs);
        const rejected = new Set();
        const relatedPages = [];
        let probed = 0, recovered = 0, transient = 0;
        const skipped = { dead: 0, offTopic: 0 };

        // Seed the queue from the directory pages' prose — already derived above.
        let frontier = new Map();
        for (const meta of directoryMeta) {
            for (const [slug, n] of Object.entries(meta.links)) frontier.set(slug, (frontier.get(slug) ?? 0) + n);
        }

        for (let depth = 1; frontier.size; depth++) {
            const queue = rankRelated(frontier, visited).filter(slug => {
                if (rejected.has(slug)) return false;
                // Known dead: nothing on disk, and a fetch would 404 again. 145 of these
                // were being re-requested on every run.
                if (isDead(cache, slug)) { visited.add(slug); skipped.dead++; return false; }
                // Already probed and judged off-topic against these same root tags.
                if (cache.offTopic[slug])  { visited.add(slug); skipped.offTopic++; return false; }
                return true;
            });
            if (!queue.length) break;

            const budget = Math.max(0, MAX_PAGES - (fetchedPages.length + relatedPages.length));
            if (!budget) {
                console.log(`[fetcher:thegamer] Cap ${MAX_PAGES} reached — ${queue.length} candidate(s) at depth ${depth} not fetched.`);
                break;
            }
            const batch = queue.slice(0, budget);
            if (batch.length < queue.length) {
                console.log(`[fetcher:thegamer] Depth ${depth}: ${queue.length} candidate(s) but only ${budget} slot(s) under cap ${MAX_PAGES} — dropping ${queue.length - batch.length} least-linked.`);
            }
            console.log(`[fetcher:thegamer] Depth ${depth}: ${batch.length} candidate(s).`);

            const nextFrontier = new Map();
            for (let i = 0; i < batch.length; i++) {
                const slug     = batch[i];
                const url      = `https://www.thegamer.com/${slug}/`;
                const file     = safeFilename(slug);
                const destPath = join(rawDir, file);
                visited.add(slug);

                const fastAccept = onTopic(slug);
                if (!fastAccept && probed >= MAX_TOPIC_PROBES) {
                    rejected.add(slug);
                    continue;
                }

                // done = every page settled so far; pending = what's left in this batch.
                // The next depth's frontier isn't known yet, so the bar advances within a
                // depth and the monotonic clamp keeps it from rewinding when a new depth
                // enlarges the denominator. Emitted before the partial line below, which
                // has no trailing newline — [PROGRESS] must start its own line.
                const settled = fetchedPages.length + relatedPages.length;
                emitDownload('bfs', settled, settled + (batch.length - i));

                process.stdout.write(`  [d${depth} ${i + 1}/${batch.length}] ${slug} ... `);

                // Cheapest first: an unchanged file on disk needs neither network nor parse.
                // Under --force we skip the disk entirely and re-fetch.
                let meta = force ? null : await pageMeta(rawDir, slug, file, cache);
                let fetchedHtml = null;

                if (!meta) {
                    try {
                        fetchedHtml = await fetchPageHtml(browser, url, cfg);
                        await writeFile(destPath, fetchedHtml, 'utf8');
                        console.log(`✓ (${Math.round(fetchedHtml.length / 1024)}kb)`);
                    } catch (err) {
                        console.log(`✗ ${err.message}`);
                        if (isPermanentFailure(err)) {
                            // A 404 writes nothing to disk, so without this the slug is
                            // re-requested on every future run, forever.
                            cache.dead[slug] = { at: Date.now(), status: err.status, error: err.message.slice(0, 80) };
                        } else {
                            // Transient — do NOT blacklist. Retried on the next run.
                            transient++;
                        }
                        rejected.add(slug);
                        // Failures used to `continue` past the sleep, so dead URLs were
                        // hammered back-to-back while good ones waited politely.
                        if (i !== batch.length - 1) await sleep(jitter(cfg.fetch.delayMinMs, cfg.fetch.delayMaxMs));
                        continue;
                    }
                    if (i !== batch.length - 1) await sleep(jitter(cfg.fetch.delayMinMs, cfg.fetch.delayMaxMs));
                    meta = await pageMeta(rawDir, slug, file, cache, { html: fetchedHtml });
                } else if (meta.cached) {
                    console.log('cached');
                } else {
                    console.log('re-parsed (file changed)');
                }

                // Not on the tag listing and not prefix-matching — let the article's own
                // tag strip decide. This is what rescues older on-topic articles.
                if (!fastAccept) {
                    if (fetchedHtml) probed++; // only a network probe costs anything
                    if (!rootTags.size || !meta.tags.some(t => rootTags.has(t))) {
                        cache.offTopic[slug] = { at: Date.now() };
                        rejected.add(slug);
                        console.log(`      ↳ off-topic (no root tag) — discarded`);
                        continue;
                    }
                    recovered++;
                    console.log(`      ↳ recovered: tagged on-topic but absent from the tag listing`);
                }

                relatedPages.push({ slug, url, file, label: meta.label ?? slugToLabel(slug), related: true });
                for (const [s, n] of Object.entries(meta.links)) nextFrontier.set(s, (nextFrontier.get(s) ?? 0) + n);
            }
            frontier = nextFrontier;
        }

        if (probed >= MAX_TOPIC_PROBES) console.log(`[fetcher:thegamer] Hit MAX_TOPIC_PROBES (${MAX_TOPIC_PROBES}) — later unlisted articles were rejected unchecked.`);
        console.log(`[fetcher:thegamer] BFS done: ${relatedPages.length} related page(s) (${recovered} recovered by tag check); ${rejected.size} off-topic slug(s) excluded; ${probed} probe fetch(es).`);
        console.log(`[fetcher:thegamer] Cache skips: ${skipped.dead} known-dead slug(s), ${skipped.offTopic} known-off-topic slug(s) — no request, no parse.`);
        if (transient) console.log(`[fetcher:thegamer] ${transient} page(s) failed transiently (timeout / 5xx / rate-limit) — NOT cached as dead; they will be retried next run. The guide is short by that many pages.`);

        // ── Step 4: write manifest ───────────────────────────────────────────
        const manifest = {
            source:    'thegamer',
            guideId:   startSlug,
            baseSlug:  pageSet.length > 1 ? baseSlugPrefix(startSlug, pageSet.map(p => p.slug)) : startSlug,
            sourceUrl: startUrl,
            fetchedAt: new Date().toISOString(),
            // Directory pages first — extractNavTree treats pages[0] as the entry page,
            // and groups the `related: true` tail separately.
            pages:     [...fetchedPages, ...relatedPages],
        };
        emitDownloadDone();
        await writeFile(join(rawDir, '_manifest.json'), JSON.stringify(manifest, null, 2));
        console.log(`\n[fetcher:thegamer] Wrote _manifest.json (${fetchedPages.length} guide + ${relatedPages.length} related = ${fetchedPages.length + relatedPages.length} pages)`);
        return manifest;
    } finally {
        // Bank what we learned even if the crawl threw partway: the dead slugs and page
        // derivations are still valid, and re-earning them is the expensive part.
        await saveCrawlCache(rawDir, cache);
        await browser.close().catch(() => {});
        console.log('[fetcher:thegamer] Browser closed');
    }
}

// Grab the <h1> from the start page HTML for a nicer start-page label.
function startTitle(html) {
    const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (!m) return null;
    // Load through cheerio rather than regex-stripping tags: TheGamer headlines are full
    // of "(&amp; 5 You Should Avoid)", and a tag-strip leaves the entity literal, so the
    // label renders as "&amp;" in the nav and the page title.
    const text = cheerio.load(`<div>${m[1]}</div>`).root().text();
    return text.replace(/\s+/g, ' ').trim() || null;
}
