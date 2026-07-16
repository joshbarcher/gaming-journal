// Ported verbatim from relay-server src/services/nexus/session.service.js
// (docs/relay-fold-in.md §6 — logic byte-identical; only the data-dir helper
// rewritten onto featureDir()).
//
// Nexus website session (cookies) for the stealth scraper. Adult mod pages are gated
// behind a logged-in Nexus account with adult content enabled; the API key only
// authenticates the API, not the website. We capture the browser cookies once (see the
// login-capture helper), inject them before scraping, and mark the session expired when a
// scrape hits the login/adult wall despite having cookies — so the backfill can pause and
// prompt a re-login. Single-user LAN app; the cookie file lives beside the other nexus
// JSON on the NAS and is treated as a committed-style secret.
import fs from 'fs/promises';
import path from 'path';
import logger from '../../logger.js';
import { featureDir } from '../shared/data-root.js';

function sessionPath() { return path.join(featureDir('nexus'), 'session.json'); }

let _mem;   // undefined = unread, null = none on disk, object = loaded

export async function getSession() {
    if (_mem !== undefined) return _mem;
    try { _mem = JSON.parse(await fs.readFile(sessionPath(), 'utf8')); }
    catch { _mem = null; }
    return _mem;
}

// cookies: array of Puppeteer-shaped cookie objects ({ name, value, domain, path, ... }).
export async function saveSession(cookies) {
    const data = { cookies: cookies ?? [], capturedAt: new Date().toISOString(), status: 'active' };
    await fs.mkdir(path.dirname(sessionPath()), { recursive: true });
    await fs.writeFile(sessionPath(), JSON.stringify(data, null, 2));
    _mem = data;
    logger.info('[nexus] session saved', { cookies: data.cookies.length });
    return data;
}

export async function markSessionExpired() {
    const s = await getSession();
    if (!s || s.status === 'expired') return;
    s.status = 'expired';
    s.expiredAt = new Date().toISOString();
    await fs.writeFile(sessionPath(), JSON.stringify(s, null, 2)).catch(() => {});
    _mem = s;
    logger.warn('[nexus] session marked expired — re-login needed');
}

export async function clearSession() {
    await fs.rm(sessionPath(), { force: true }).catch(() => {});
    _mem = null;
}

// Inject the stored cookies onto a page (they apply browser-wide, scoped to nexusmods.com).
// Returns true if a session's cookies were applied.
export async function applySession(page) {
    const s = await getSession();
    if (!s?.cookies?.length) return false;
    try { await page.setCookie(...s.cookies); return true; }
    catch (err) { logger.warn('[nexus] setCookie failed', { err: err.message }); return false; }
}

// Public status for the UI — never leaks cookie values.
export async function sessionStatus() {
    const s = await getSession();
    if (!s?.cookies?.length) return { present: false, status: 'missing' };
    return { present: true, status: s.status ?? 'active', capturedAt: s.capturedAt ?? null, expiredAt: s.expiredAt ?? null };
}
