// Ported verbatim from relay-server src/services/nexus/images-scraper.js (docs/relay-fold-in.md §6 — byte-identical logic).
// Scrape a mod's "Author images" gallery — the one thing the Nexus API doesn't
// expose. The images tab (?tab=images) server-renders <a class="mod-image"> links to
// the full-size images on staticdelivery. We reuse the shared stealth browser (same
// one PCGW/Reddit use) to clear Cloudflare, and are deliberately gentle: one scrape at
// a time, spaced out, on-demand only, and cached hard by the mod-detail TTL.
import { getBrowser } from '../browser/browser.service.js';
import { applySession, markSessionExpired } from './session.service.js';
import logger from '../../logger.js';

const SITE       = 'https://www.nexusmods.com';
const MIN_GAP_MS = 6000;   // ≥6s between Nexus scrapes — slow + safe

let _last  = 0;
let _chain = Promise.resolve();   // serialize scrapes (never two at once)
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function _scrape(domainName, modId) {
    const gap = MIN_GAP_MS - (Date.now() - _last);
    if (gap > 0) await sleep(gap);

    const browser     = await getBrowser();
    const page        = await browser.newPage();
    const hadSession  = await applySession(page);   // authenticated cookies unlock adult mods
    try {
        const url = `${SITE}/${domainName}/mods/${modId}?tab=images`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        // The image tiles load via an AJAX widget after DOMContentLoaded, so wait for the
        // actual image link (not just the container). Times out gracefully for mods with
        // no author images.
        await page.waitForSelector('#mod_images_list_1 a.mod-image', { timeout: 10_000 }).catch(() => {});
        await sleep(600);

        const state = await page.evaluate(() => {
            const grab = (sel) => [...document.querySelectorAll(sel)]
                .map(a => a.getAttribute('href'))
                .filter(u => u && /staticdelivery\.nexusmods\.com/.test(u));
            let out = grab('#mod_images_list_1 a.mod-image');
            if (!out.length) out = grab('a.mod-image');
            const text = (document.title + ' ' + (document.body?.innerText ?? '').slice(0, 400)).toLowerCase();
            return {
                urls:      [...new Set(out)],
                rendered:  !!document.querySelector('#tab-modimages, .mod-image-list'),
                challenge: /just a moment|checking your browser|attention required|enable javascript/.test(text),
                // Adult/login wall: the page is served but hidden behind the sign-in / adult
                // preference gate. Distinct from a Cloudflare challenge and from an empty gallery.
                loginGate: /adult content is turned off|please log in|log in to view|you must be logged in|hidden because adult/.test(text),
            };
        });

        // ok = the images tab actually rendered and wasn't a Cloudflare/login wall. Even 0
        // images is a valid "done" for such a page. A transient failure or gate returns
        // ok:false so the caller can retry instead of caching an empty result forever.
        const ok = state.rendered && !state.challenge && !state.loginGate;
        // Cookies were present but the page still gated us → the session is dead.
        if (state.loginGate && hadSession) await markSessionExpired();
        logger.info('[nexus] author images scraped', { domainName, modId, count: state.urls.length, ok, gated: state.loginGate, authed: hadSession });
        return { ok, urls: state.urls, gated: state.loginGate };
    } catch (err) {
        logger.warn('[nexus] author-image scrape failed', { domainName, modId, err: err.message });
        return { ok: false, urls: [], gated: false };
    } finally {
        _last = Date.now();
        await page.close().catch(() => {});
    }
}

// Serialized + rate-limited. Returns { ok, urls, gated } — ok:false means a transient
// failure (Cloudflare/error) or a login/adult gate worth retrying once authenticated;
// ok:true with [] means the mod genuinely has no author images. gated:true means the page
// is behind the Nexus login/adult wall (needs a valid session).
export function scrapeAuthorImages(domainName, modId) {
    const run = _chain.then(() => _scrape(domainName, modId));
    _chain = run.catch(() => ({ ok: false, urls: [], gated: false }));
    return run;
}
