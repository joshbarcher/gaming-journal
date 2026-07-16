// Ported verbatim from relay-server src/services/steam/achievement-schema-scraper.js
// (docs/relay-fold-in.md §6 — logic byte-identical; only the logger import path
// changed). closeBrowser() must be called on shutdown — the relay wires it in
// server.js's shutdown handler; the journal's boot/shutdown harness must do the same.
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import logger from '../../logger.js';

puppeteerExtra.use(StealthPlugin());

// ── Shared Puppeteer browser ──────────────────────────────────────────────────
// One Chrome instance is kept alive for all scrape calls.
// Health-checked before each use; transparently relaunched if it crashes.
// Mirrors the pattern in pcgw.service.js.

let _browser = null;

async function _getBrowser() {
    if (_browser) {
        try {
            await _browser.version(); // throws if Chrome has died
            return _browser;
        } catch {
            logger.warn('[ach-scraper] Shared browser disconnected — relaunching');
            _browser = null;
        }
    }
    _browser = await puppeteerExtra.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    logger.info('[ach-scraper] Shared browser launched');
    return _browser;
}

/** Call on server shutdown so Chrome exits cleanly. */
export async function closeBrowser() {
    if (_browser) {
        await _browser.close().catch(() => {});
        _browser = null;
        logger.info('[ach-scraper] Shared browser closed');
    }
}

const MATURE_COOKIES = [
    { name: 'birthtime',                    value: '283996801',  domain: 'steamcommunity.com' },
    { name: 'lastagecheckage',              value: '1-0-1979',   domain: 'steamcommunity.com' },
    { name: 'mature_content',               value: '1',          domain: 'steamcommunity.com' },
    { name: 'wants_mature_content',         value: '1',          domain: 'steamcommunity.com' },
    { name: 'content_descriptors_accepted', value: '1,3,4',      domain: 'steamcommunity.com' },
];

async function _fetchPageHtml(url) {
    const browser = await _getBrowser();
    const page    = await browser.newPage();
    try {
        await page.setCookie(...MATURE_COOKIES);
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        if (!res.ok()) {
            logger.warn('[ach-scraper] Community stats page unavailable', {
                url, status: res.status(),
            });
            return null;
        }
        return await page.content();
    } finally {
        await page.close();
    }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Scrapes the Steam Community global achievement stats page for a game.
 *
 * Uses Puppeteer + stealth plugin to avoid bot-detection on steamcommunity.com.
 * Rate-paced by the caller (syncAchievements processBatch); no additional
 * inter-call delay is applied here.
 *
 * The page does NOT expose internal API names, so the returned array is
 * positional: entry [0] → first achievement from GetPlayerAchievements, etc.
 * Valve always returns both lists in the same schema-defined order.
 *
 * @param {string|number} appid
 * @param {{ htmlFn?: (url: string) => Promise<string|null> }} [opts]
 *   htmlFn — injected in tests so no real browser is launched.
 * @returns {Promise<Array<{displayName:string, description:string, icon:string|null}>>}
 */
export async function scrapeAchievementSchema(appid, { htmlFn } = {}) {
    const url = `https://steamcommunity.com/stats/${appid}/achievements`;
    try {
        const html = htmlFn ? await htmlFn(url) : await _fetchPageHtml(url);
        if (!html) return [];
        return parseAchievementHtml(html);
    } catch (err) {
        logger.warn('[ach-scraper] Failed to scrape community stats page', {
            appid, err: err.message,
        });
        return [];
    }
}

/**
 * Pure HTML parser — exported for unit testing without a browser.
 *
 * Splits on <div class="achieveRow"> boundaries and extracts:
 *   icon        — first <img src="…"> inside the block
 *   displayName — text content of the first <h3>
 *   description — text content of the first <h5> (absent for hidden achievements)
 *
 * @param {string} html
 * @returns {Array<{displayName:string, description:string, icon:string|null}>}
 */
export function parseAchievementHtml(html) {
    const chunks  = html.split(/<div[^>]+class="achieveRow[^"]*"[^>]*>/);
    const results = [];

    for (let i = 1; i < chunks.length; i++) {
        const chunk = chunks[i];

        const imgMatch = chunk.match(/<img[^>]+src="([^"]+)"[^>]*>/);
        const icon     = imgMatch ? imgMatch[1].trim() : null;

        const h3Match = chunk.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
        if (!h3Match) continue;
        const displayName = _decodeEntities(h3Match[1].trim());
        if (!displayName) continue;

        const h5Match    = chunk.match(/<h5[^>]*>([\s\S]*?)<\/h5>/);
        const description = h5Match ? _decodeEntities(h5Match[1].trim()) : '';

        results.push({ displayName, description, icon });
    }

    return results;
}

// ── Minimal HTML entity decoder ───────────────────────────────────────────────

const ENTITIES = {
    '&amp;':  '&',
    '&lt;':   '<',
    '&gt;':   '>',
    '&quot;': '"',
    '&#39;':  "'",
    '&apos;': "'",
};

function _decodeEntities(str) {
    return str.replace(/&[a-z]+;|&#\d+;/gi, (entity) => {
        if (ENTITIES[entity]) return ENTITIES[entity];
        const m = entity.match(/&#(\d+);/);
        if (m) return String.fromCharCode(Number(m[1]));
        return entity;
    });
}
