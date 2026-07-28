import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin  from 'puppeteer-extra-plugin-stealth';
import logger         from '../../logger.js';

puppeteerExtra.use(StealthPlugin());

let _browser   = null;
let _launching = null;   // in-flight launch, shared by concurrent callers

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// NOT a liveness probe: puppeteer memoises browser.version() after the first
// successful call, so it keeps resolving from cache (in 0ms) long after Chrome
// has died. Using it as a health check silently hands out dead browsers forever.
// browser.connected reflects the live CDP transport state, which is what we want.
function isAlive(browser) {
    return browser?.connected === true;
}

// Chrome died / the CDP transport went away — the browser is unusable but a
// relaunch will fix it, so these are worth retrying.
function isDisconnectError(err) {
    const name = err?.name ?? '';
    if (name === 'ConnectionClosedError' || name === 'TargetCloseError') return true;
    return /Connection closed|Target closed|Session closed|Protocol error/i.test(err?.message ?? '');
}

async function _launchAndWarm() {
    // Concurrent callers share one launch — otherwise each racing request spawns
    // its own Chrome and all but the last get orphaned.
    if (_launching) return _launching;

    _launching = (async () => {
        // Replacing _browser without closing the old one orphans a full Chrome
        // (and its /tmp profile dir) for the lifetime of the process.
        const previous = _browser;
        _browser = null;
        if (previous) await previous.close().catch(() => {});

        const browser = await puppeteerExtra.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        logger.info('[browser] Stealth browser launched');

        const page = await browser.newPage();
        try {
            await page.goto('https://www.reddit.com', { waitUntil: 'domcontentloaded', timeout: 30_000 });
            await sleep(1500 + Math.random() * 1000);
            logger.info('[browser] Stealth browser warmed up');
        } catch (err) {
            logger.warn('[browser] Warm-up failed (non-fatal)', { err: err.message });
        } finally {
            await page.close().catch(() => {});
        }

        _browser = browser;
        return browser;
    })();

    try { return await _launching; }
    finally { _launching = null; }
}

export async function startBrowser() {
    return _launchAndWarm();
}

export async function closeBrowser() {
    if (_browser) {
        await _browser.close().catch(() => {});
        _browser = null;
        logger.info('[browser] Stealth browser closed');
    }
}

export async function getBrowser() {
    if (isAlive(_browser)) return _browser;
    // Leave the handle in place — _launchAndWarm() closes it, so a crashed
    // Chrome (and its /tmp profile dir) gets reaped rather than orphaned.
    if (_browser) logger.warn('[browser] Browser disconnected — relaunching');
    return _launchAndWarm();
}

// Open a page, read its text, and always clean the page up. page.close() is
// swallowed so a failing close can never mask the error that actually broke the
// fetch (a bare `finally { await page.close() }` replaces it).
async function _readPageText(url) {
    const browser = await getBrowser();
    const page    = await browser.newPage();
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        return await page.evaluate(() => document.body.innerText);
    } finally {
        await page.close().catch(() => {});
    }
}

// Fetch a Reddit JSON endpoint through the stealth browser.
// Relaunches and retries when Chrome dies under us, and detects HTML
// bot-detection responses and re-warms before retrying.
export async function browserGet(url, { htmlAttempt = 0, connAttempt = 0 } = {}) {
    let text;
    try {
        text = await _readPageText(url);
    } catch (err) {
        // Without this the browser singleton stays dead and every downstream
        // caller 500s until the process restarts.
        if (isDisconnectError(err) && connAttempt < 2) {
            logger.warn('[browser] Lost the browser mid-fetch — relaunching and retrying', { connAttempt, err: err.message });
            await _launchAndWarm();
            return browserGet(url, { htmlAttempt, connAttempt: connAttempt + 1 });
        }
        throw err;
    }

    const trimmed = text?.trim() ?? '';
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        if (htmlAttempt >= 2) throw new Error(`Browser got HTML after ${htmlAttempt + 1} attempts (bot detection): ${url}`);
        logger.warn('[browser] Got HTML instead of JSON — re-warming and retrying', { attempt: htmlAttempt, url });
        await _launchAndWarm();
        await sleep(2000 + Math.random() * 2000);
        return browserGet(url, { htmlAttempt: htmlAttempt + 1, connAttempt });
    }

    return JSON.parse(trimmed);
}

// Navigate to a URL, wait for the page to render, then run evalFn in page context.
// Used for scraping SPA pages (e.g. Imgur albums) that don't return JSON.
export async function browserEval(url, evalFn, { waitMs = 2500, connAttempt = 0 } = {}) {
    const browser = await getBrowser();
    const page    = await browser.newPage();
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await sleep(waitMs);
        return await page.evaluate(evalFn);
    } catch (err) {
        if (isDisconnectError(err) && connAttempt < 2) {
            logger.warn('[browser] Lost the browser mid-eval — relaunching and retrying', { connAttempt, err: err.message });
            await _launchAndWarm();
            return browserEval(url, evalFn, { waitMs, connAttempt: connAttempt + 1 });
        }
        throw err;
    } finally {
        await page.close().catch(() => {});
    }
}
