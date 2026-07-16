import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin  from 'puppeteer-extra-plugin-stealth';
import logger         from '../../logger.js';

puppeteerExtra.use(StealthPlugin());

let _browser = null;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function _launchAndWarm() {
    _browser = await puppeteerExtra.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    logger.info('[browser] Stealth browser launched');

    const page = await _browser.newPage();
    try {
        await page.goto('https://www.reddit.com', { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await sleep(1500 + Math.random() * 1000);
        logger.info('[browser] Stealth browser warmed up');
    } catch (err) {
        logger.warn('[browser] Warm-up failed (non-fatal)', { err: err.message });
    } finally {
        await page.close();
    }

    return _browser;
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
    if (_browser) {
        try { await _browser.version(); return _browser; }
        catch {
            logger.warn('[browser] Browser disconnected — relaunching');
            _browser = null;
        }
    }
    return _launchAndWarm();
}

// Fetch a Reddit JSON endpoint through the stealth browser.
// Detects HTML bot-detection responses and re-warms before retrying once.
export async function browserGet(url, attempt = 0) {
    const browser = await getBrowser();
    const page    = await browser.newPage();
    let text;
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        text = await page.evaluate(() => document.body.innerText);
    } finally {
        await page.close();
    }

    const trimmed = text?.trim() ?? '';
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        if (attempt >= 2) throw new Error(`Browser got HTML after ${attempt + 1} attempts (bot detection): ${url}`);
        logger.warn('[browser] Got HTML instead of JSON — re-warming and retrying', { attempt, url });
        await _launchAndWarm();
        await sleep(2000 + Math.random() * 2000);
        return browserGet(url, attempt + 1);
    }

    return JSON.parse(trimmed);
}

// Navigate to a URL, wait for the page to render, then run evalFn in page context.
// Used for scraping SPA pages (e.g. Imgur albums) that don't return JSON.
export async function browserEval(url, evalFn, { waitMs = 2500 } = {}) {
    const browser = await getBrowser();
    const page    = await browser.newPage();
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await sleep(waitMs);
        return await page.evaluate(evalFn);
    } finally {
        await page.close();
    }
}
