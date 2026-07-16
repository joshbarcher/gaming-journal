// One-time (re-runnable) Nexus login capture for the adult-mod image scraper.
// Ported from relay-server scripts/capture-nexus-session.mjs — the target is now
// the journal's own folded-in endpoint (POST /relay/api/nexus/session); the
// captured session lands in $RELAY_DATA_ROOT/nexus/session.json on the NAS.
//
// Adult mods on nexusmods.com are gated behind a logged-in account with adult content
// enabled. This opens a REAL browser (same puppeteer-extra + stealth stack the
// scraper uses, so Cloudflare Turnstile lets the login through), waits for you to log in
// and enable adult content, verifies an adult mod's images actually render, then ships the
// session cookies to the journal (POST /relay/api/nexus/session). Re-run whenever
// Settings flags the session Expired.
//
// Run from the gaming-journal repo (needs its puppeteer + stealth deps):
//   node scripts/capture-nexus-session.mjs [journalBaseUrl]
//   JOURNAL_URL=http://192.168.86.65:8061 node scripts/capture-nexus-session.mjs
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin  from 'puppeteer-extra-plugin-stealth';

puppeteerExtra.use(StealthPlugin());

const JOURNAL    = process.argv[2] || process.env.JOURNAL_URL || 'http://192.168.86.65:8061';
const LOGIN_URL  = 'https://www.nexusmods.com/users/sign_in';
const VERIFY_URL = 'https://www.nexusmods.com/residentevilrequiem/mods/799?tab=images'; // known adult mod
const MAX_WAIT_MS = 12 * 60 * 1000;
const POLL_MS = 8000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// puppeteer cookies are already the shape page.setCookie() wants — just drop the extra
// fields (session/size/priority/…) and session-cookie expires so the scraper can replay them.
function clean(c) {
    const o = { name: c.name, value: c.value, domain: c.domain, path: c.path || '/', httpOnly: !!c.httpOnly, secure: !!c.secure };
    if (typeof c.expires === 'number' && c.expires > 0) o.expires = c.expires;
    if (c.sameSite && ['Strict', 'Lax', 'None'].includes(c.sameSite)) o.sameSite = c.sameSite;
    return o;
}

console.log(`\n  Journal target: ${JOURNAL}`);
console.log('  Opening a stealth browser window…\n');

const browser = await puppeteerExtra.launch({
    headless: false, defaultViewport: null,
    args: ['--start-maximized', '--no-sandbox', '--disable-setuid-sandbox'],
});
let disconnected = false;
browser.on('disconnected', () => { disconnected = true; });

const pages = await browser.pages();
const login = pages[0] ?? await browser.newPage();
await login.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});

console.log('  ┌────────────────────────────────────────────────────────────────┐');
console.log('  │  In the browser window (keep it open, ignore the 2nd tab):       │');
console.log('  │   1. Log in to your Nexus Mods account.                          │');
console.log('  │   2. Account → Site preferences → enable "Show adult content".   │');
console.log('  │  Then just wait — it auto-detects, captures, and saves.          │');
console.log('  └────────────────────────────────────────────────────────────────┘\n');

const started = Date.now();
let ok = false, probe;

while (Date.now() - started < MAX_WAIT_MS && !disconnected) {
    await sleep(POLL_MS);
    if (disconnected) break;
    try {
        if (!probe || probe.isClosed()) probe = await browser.newPage();
        await probe.goto(VERIFY_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(2000);
        const state = await probe.evaluate(() => {
            const imgs = document.querySelectorAll('#mod_images_list_1 a.mod-image, a.mod-image').length;
            const t = (document.title + ' ' + (document.body?.innerText || '')).toLowerCase();
            return {
                imgs,
                challenge: /just a moment|checking your browser|attention required/.test(t),
                loginGate: /please log in|log in to view|you must be logged in/.test(t),
                adultGate: /adult content is turned off|hidden because adult/.test(t),
            };
        });
        if (state.imgs > 0) { ok = true; break; }
        const secs = Math.round((Date.now() - started) / 1000);
        const why = state.challenge ? 'clearing Cloudflare…'
                  : state.adultGate ? 'logged in, but adult content is still OFF — enable it in Site preferences'
                  : state.loginGate ? 'waiting for you to log in…'
                  : 'waiting for the images tab…';
        console.log(`  … ${why} (${secs}s)`);
    } catch (e) {
        console.log(`  … probe retry (${(e.message || '').slice(0, 70)})`);
    }
}

if (!ok) {
    console.error(disconnected
        ? '\n  ✗ Browser was closed before capture finished. Re-run and keep it open.\n'
        : '\n  ✗ Timed out. Make sure you logged in AND enabled adult content, then re-run.\n');
    if (!disconnected) await browser.close().catch(() => {});
    process.exit(1);
}

const raw = await probe.cookies('https://www.nexusmods.com', 'https://nexusmods.com');
const cookies = raw.filter(c => /nexusmods\.com$/.test((c.domain || '').replace(/^\./, ''))).map(clean);
console.log(`\n  ✓ Adult session verified — captured ${cookies.length} cookies. Saving to the journal…`);

const res = await fetch(`${JOURNAL}/relay/api/nexus/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookies }),
}).catch(e => ({ ok: false, _err: e.message }));

if (res && res.ok) {
    console.log(`  ✓ Saved: ${JSON.stringify(await res.json().catch(() => ({})))}\n`);
    await browser.close().catch(() => {});
    process.exit(0);
} else {
    console.error(`  ✗ POST to journal failed: ${res?._err || res?.status}. Is ${JOURNAL} reachable?\n`);
    await browser.close().catch(() => {});
    process.exit(1);
}
