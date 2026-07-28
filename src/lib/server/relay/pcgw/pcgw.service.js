import path from 'node:path';
import fs from 'node:fs/promises';
import { mapChunked } from '../shared/map-chunked.js';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import logger from '../../logger.js';
import { getAllGames } from '../shared/getAllGames.js';
import { featureDir } from '../shared/data-root.js';
import {
    parseVideoFromHtml,
    parseInputFromHtml,
    parseCloudFromHtml,
    parseAvailabilityFromHtml,
    parsePathsFromHtml,
    parseFixesFromHtml,
    collectUnknownRows,
    detectDrift,
} from './pcgw.parser.js';

const PCGW_API = 'https://www.pcgamingwiki.com/w/api.php';

// Jitter between games
const PCGW_MIN_MS = 2_000;
const PCGW_MAX_MS = 4_000;

// Cargo 429 retry
const MAX_RETRIES = 3;

// After this many consecutive failures a section is marked 'skipped'
const MAX_SECTION_FAILURES = 3;

// All tracked sections in fetch order. 'pageTitle' must come first.
const ALL_SECTIONS = ['pageTitle', 'video', 'input', 'cloud', 'availability', 'paths', 'fixes'];

// Sections sourced from the full page HTML (everything except pageTitle)
const HTML_SECTIONS = ['video', 'input', 'cloud', 'availability', 'paths', 'fixes'];

// ── Path helpers ──────────────────────────────────────────────────────────────

function pcgwDir()     { return featureDir('pcgw'); }
function entryPath(id) { return path.join(pcgwDir(), `${id}.json`); }
function indexPath()      { return path.join(pcgwDir(), 'index.json'); }
function healthPath()     { return path.join(pcgwDir(), 'health.json'); }
function htmlCacheDir()   { return path.join(pcgwDir(), 'html'); }
function htmlCachePath(id){ return path.join(htmlCacheDir(), `${id}.html`); }

function pcgwPageUrl(pageTitle) {
    return 'https://www.pcgamingwiki.com/wiki/' +
        pageTitle.replace(/ /g, '_').replace(/[%#?]/g, encodeURIComponent);
}

function jitter() {
    return new Promise(r => setTimeout(r, PCGW_MIN_MS + Math.random() * (PCGW_MAX_MS - PCGW_MIN_MS)));
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function cargoQuery(params, fetchFn, retries = 0) {
    const url = new URL(PCGW_API);
    url.searchParams.set('format', 'json');
    url.searchParams.set('action', 'cargoquery');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetchFn(url.toString(), {
        headers: { 'User-Agent': 'relay-server/1.0 (personal game library tool)' },
    });

    if (res.status === 429) {
        if (retries >= MAX_RETRIES) throw new Error('PCGW API 429 Too Many Requests');
        await new Promise(r => setTimeout(r, (retries + 1) * 5_000));
        return cargoQuery(params, fetchFn, retries + 1);
    }
    if (!res.ok) throw new Error(`PCGW API ${res.status} ${res.statusText}`);

    const body = await res.json();
    if (body.error) throw new Error(`PCGW Cargo error: ${body.error.info}`);
    return body.cargoquery ?? [];
}

// ── Puppeteer browser ─────────────────────────────────────────────────────────

puppeteerExtra.use(StealthPlugin());

export async function launchBrowser() {
    return puppeteerExtra.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
}

// ── Persistent shared browser ─────────────────────────────────────────────────
// One Chrome instance is kept alive across all on-demand and bulk fetches.
// A health check before each use ensures a crashed browser is transparently
// replaced rather than causing a cascade of failures.

let _browser = null;

async function _getBrowser() {
    // browser.connected, not browser.version(): puppeteer memoises version()
    // after the first successful call, so it keeps resolving from cache once
    // Chrome has died and the health check never fires.
    if (_browser) {
        if (_browser.connected) return _browser;
        logger.warn('[pcgw] Shared browser disconnected — relaunching');
        await _browser.close().catch(() => {});
        _browser = null;
    }
    _browser = await launchBrowser();
    logger.info('[pcgw] Shared browser launched');
    return _browser;
}

// Call on server shutdown so Chrome exits cleanly.
export async function closeBrowser() {
    if (_browser) {
        await _browser.close().catch(() => {});
        _browser = null;
        logger.info('[pcgw] Shared browser closed');
    }
}

async function fetchPageWithBrowser(browser, url, retries = 0) {
    const page = await browser.newPage();
    try {
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        if (res.status() === 429) {
            if (retries >= MAX_RETRIES) throw new Error('PCGW 429 Too Many Requests');
            await new Promise(r => setTimeout(r, (retries + 1) * 10_000));
            return fetchPageWithBrowser(browser, url, retries + 1);
        }
        if (!res.ok()) throw new Error(`PCGW HTTP ${res.status()}`);
        return page.content();
    } finally {
        await page.close();
    }
}

// ── Section fetchers ──────────────────────────────────────────────────────────

async function fetchPageTitle(appid, fetchFn) {
    const rows = await cargoQuery({
        tables: 'Infobox_game',
        fields: '_pageName=pageTitle',
        where:  `Steam_AppID HOLDS "${appid}"`,
        limit:  '1',
    }, fetchFn);
    if (rows.length === 0) return null;
    const pageTitle = rows[0].title?.pageTitle;
    if (!pageTitle) return null;
    return { pageTitle, pageUrl: pcgwPageUrl(pageTitle) };
}

// ── Section status helpers ────────────────────────────────────────────────────

function sectionNeedsFetch(sectionStatus, force) {
    if (force) return true;
    if (!sectionStatus) return true;
    if (sectionStatus.status === 'ok') return false;
    if (sectionStatus.status === 'skipped') return false;
    return (sectionStatus.attempts ?? 0) < MAX_SECTION_FAILURES;
}

function markOk(entry, section) {
    entry.sections[section] = { status: 'ok', fetchedAt: new Date().toISOString() };
}

// A section parse "returned nothing": null, an empty array, or an object whose every field is
// null/empty. The PCGW parsers don't throw on structural drift — they silently return these — so
// this lets the sync distinguish "genuinely no data" from "keep the good cached section".
function isEmptySectionValue(v) {
    if (v == null) return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object') {
        return Object.values(v).every(x =>
            x == null ||
            (Array.isArray(x) && x.length === 0) ||
            (typeof x === 'object' && Object.keys(x).length === 0));
    }
    return false;
}

function markFailed(entry, section, err) {
    const prev     = entry.sections[section] ?? {};
    const attempts = (prev.attempts ?? 0) + 1;
    const status   = attempts >= MAX_SECTION_FAILURES ? 'skipped' : 'failed';
    entry.sections[section] = {
        status,
        attempts,
        lastAttempt: new Date().toISOString(),
        lastError:   err.message,
    };
    if (status === 'skipped') {
        logger.warn('[pcgw] Section permanently skipped after max failures',
            { appid: entry.appid, section, attempts });
    }
}

const LEGACY_FLAT_FIELDS = [
    'ultrawide', 'widescreen', 'hdr', 'fps60', 'fps120', 'rayTracing',
    'controllerSupport', 'fullControllerSupport', 'controllerRemapping',
    'keyRemapping', 'steamInput', 'steamCloud', 'gogCloud',
    'drm', 'steamDrm', 'gogDrm',
];

function migrateSections(entry) {
    const ok = () => ({ status: 'ok', fetchedAt: entry.fetchedAt ?? new Date().toISOString() });

    if (!entry.sections) {
        const s = {};
        if (entry.pageTitle)                               s.pageTitle    = ok();
        if (entry.video)                                   s.video        = ok();
        if (entry.input)                                   s.input        = ok();
        if (entry.cloud)                                   s.cloud        = ok();
        if (entry.availability || entry.drm !== undefined) s.availability = ok();
        entry = { ...entry, sections: s };
    }

    if (entry.video && entry.input && entry.cloud && entry.availability) {
        const cleaned = { ...entry };
        for (const f of LEGACY_FLAT_FIELDS) delete cleaned[f];
        return cleaned;
    }

    return entry;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getEntry(appid) {
    try { return JSON.parse(await fs.readFile(entryPath(appid), 'utf8')); }
    catch { return null; }
}

export async function getIndex() {
    try { return JSON.parse(await fs.readFile(indexPath(), 'utf8')); }
    catch { return []; }
}

async function rebuildIndex() {
    let files;
    try { files = await fs.readdir(pcgwDir()); } catch { return []; }

    const eligible = files.filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== 'health.json');
    const raws     = await mapChunked(eligible, f => fs.readFile(path.join(pcgwDir(), f), 'utf8').catch(() => null));

    const index = [];
    const unknownAggregate = { video: {}, input: {}, cloud: {} };
    const driftList        = [];

    for (const raw of raws) {
        if (!raw) continue;
        try {
            const e = JSON.parse(raw);

            if (e.found) {
                index.push({
                    appid:                 e.appid,
                    steamName:             e.steamName,
                    pageTitle:             e.pageTitle,
                    pageUrl:               e.pageUrl,
                    drm:                   e.availability?.drm ?? [],
                    steamCloud:            e.cloud?.steam ?? null,
                    ultrawide:             e.video?.ultrawide ?? null,
                    hdr:                   e.video?.hdr ?? null,
                    controllerSupport:     e.input?.controller?.support ?? null,
                    fullControllerSupport: e.input?.controller?.fullSupport ?? null,
                    fixCount:              e.fixes?.length ?? 0,
                });
            }

            // Aggregate unknown rows — each game contributes at most once per row
            for (const section of ['video', 'input', 'cloud']) {
                for (const row of (e.unknownRows?.[section] ?? [])) {
                    unknownAggregate[section][row] = (unknownAggregate[section][row] ?? 0) + 1;
                }
            }

            // Collect drift flags
            if (e.drift?.sections?.length > 0) {
                driftList.push({
                    appid:     e.appid,
                    steamName: e.steamName,
                    sections:  e.drift.sections,
                    drifted:   e.drift.drifted,
                });
            }
        } catch { /* skip malformed */ }
    }

    // Sort unknown rows by game count descending
    const unknownRows = {};
    for (const [section, rows] of Object.entries(unknownAggregate)) {
        unknownRows[section] = Object.entries(rows)
            .sort(([, a], [, b]) => b - a)
            .map(([row, games]) => ({ row, games }));
    }

    await fs.writeFile(indexPath(), JSON.stringify(index, null, 2));
    await fs.writeFile(healthPath(), JSON.stringify(
        { unknownRows, drift: driftList, updatedAt: new Date().toISOString() },
        null, 2
    ));
    return index;
}

/** @param {number|string|null} [appid] */
export async function clearHtmlCache(appid = null) {
    if (appid) {
        await fs.rm(htmlCachePath(appid), { force: true });
        return 1;
    }
    const files = await fs.readdir(htmlCacheDir()).catch(() => []);
    await Promise.all(files.map(f => fs.rm(path.join(htmlCacheDir(), f), { force: true })));
    return files.length;
}

export async function getHealth() {
    try { return JSON.parse(await fs.readFile(healthPath(), 'utf8')); }
    catch { return { unknownRows: { video: [], input: [], cloud: [] }, drift: [], updatedAt: null }; }
}

/**
 * Sync a single game by appid.
 * 1. Looks up the PCGW page title via one Cargo API call (plain fetch).
 * 2. Fetches the full wiki page via Puppeteer (real browser, bypasses bot detection).
 * 3. Parses all data sections locally from that HTML.
 * Saves after every step so partial progress is never lost.
 *
 * `force`   — re-fetch the page and re-parse. What the UI refresh button sends.
 * `reparse` — re-parse the cached HTML without re-fetching. Cheap way to backfill
 *             newly-extracted fields across the library after a parser change.
 *
 * htmlFn is injected by syncAll (shared browser across all games).
 * When called standalone it uses the module-level shared browser (_getBrowser).
 */
/**
 * @param {number|string} appid
 * @param {{ force?: boolean, reparse?: boolean, fetchFn?: typeof fetch, htmlFn?: Function|null, steamName?: string }} [opts]
 */
export async function syncGame(appid, { force = false, reparse = false, fetchFn = fetch, htmlFn = null, steamName } = {}) {
    const redo = force || reparse;
    await fs.mkdir(pcgwDir(), { recursive: true });

    if (!htmlFn) {
        const browser = await _getBrowser();
        htmlFn = url => fetchPageWithBrowser(browser, url);
    }

    let entry;
    try {
        entry = migrateSections(JSON.parse(await fs.readFile(entryPath(appid), 'utf8')));
    } catch {
        entry = { appid, sections: {} };
    }
    if (!entry.sections) entry.sections = {};
    if (steamName) entry.steamName = steamName;

    const save = () => fs.writeFile(entryPath(appid), JSON.stringify(entry, null, 2));

    // ── pageTitle via Cargo ──────────────────────────────────────────────────
    if (sectionNeedsFetch(entry.sections.pageTitle, force)) {
        try {
            const result = await fetchPageTitle(appid, fetchFn);
            if (result === null) {
                entry.found = false;
                markOk(entry, 'pageTitle');
                await save();
                return { appid, found: false };
            }
            Object.assign(entry, result);
            entry.found = true;
            markOk(entry, 'pageTitle');
            await save();
        } catch (err) {
            markFailed(entry, 'pageTitle', err);
            await save();
            throw err;
        }
    }

    if (!entry.found) return { appid, found: false };

    // ── Full page HTML via cache or Puppeteer → all remaining sections ────────
    const needsHtml = HTML_SECTIONS.some(s => sectionNeedsFetch(entry.sections[s], redo));
    let htmlFromCache = false;

    if (needsHtml) {
        let html;
        try {
            // A forced sync must re-fetch, not just re-parse: wiki pages grow after
            // release, and a cached snapshot can predate whole sections (fixes,
            // "Issues unresolved") that no amount of re-parsing will conjure up.
            const cached = force
                ? null
                : await fs.readFile(htmlCachePath(appid), 'utf8').catch(() => null);
            if (cached) {
                html = cached;
                htmlFromCache = true;
                logger.debug('[pcgw] HTML from cache', { appid });
            } else {
                html = await htmlFn(entry.pageUrl);
                await fs.mkdir(htmlCacheDir(), { recursive: true });
                await fs.writeFile(htmlCachePath(appid), html);
                logger.debug('[pcgw] HTML fetched and cached', { appid, force });
            }
        } catch (err) {
            for (const name of HTML_SECTIONS) {
                if (sectionNeedsFetch(entry.sections[name], redo)) markFailed(entry, name, err);
            }
            await save();
            logger.warn('[pcgw] HTML fetch failed', { appid, err: err.message });
            return { appid, found: entry.found, incomplete: HTML_SECTIONS };
        }

        const parsers = {
            video:        () => ({ video:        parseVideoFromHtml(html) }),
            input:        () => ({ input:        parseInputFromHtml(html) }),
            cloud:        () => ({ cloud:        parseCloudFromHtml(html) }),
            availability: () => ({ availability: parseAvailabilityFromHtml(html) }),
            paths:        () => ({ paths:        parsePathsFromHtml(html) }),
            fixes:        () => ({ fixes:        parseFixesFromHtml(html) }),
        };

        for (const [name, parseFn] of Object.entries(parsers)) {
            if (!sectionNeedsFetch(entry.sections[name], redo)) continue;
            try {
                const parsed = parseFn();       // { [name]: value }
                // If the parse came back empty but we already have good data for this section, it's
                // almost certainly PCGW structural drift (parsers return empty, they don't throw) —
                // keep the cached section rather than blanking it. First-time empties still record.
                if (isEmptySectionValue(parsed[name]) && !isEmptySectionValue(entry[name])) {
                    logger.warn('[pcgw] Empty parse over good section — keeping cached', { appid, section: name });
                    continue;
                }
                Object.assign(entry, parsed);
                markOk(entry, name);
            } catch (err) {
                markFailed(entry, name, err);
                logger.warn('[pcgw] Section parse failed', { appid, section: name, err: err.message });
            }
        }

        entry.unknownRows = collectUnknownRows(html);

        const drift = detectDrift(html);
        entry.drift = drift;
        if (drift.drifted) {
            logger.warn('[pcgw] Structural drift detected', { appid, sections: drift.sections });
        }

        for (const f of LEGACY_FLAT_FIELDS) delete entry[f];
        await save();
    }

    const incomplete = ALL_SECTIONS.filter(n => entry.sections[n]?.status !== 'ok');
    logger.debug('[pcgw] Game sync complete', {
        appid,
        name:       entry.steamName,
        found:      entry.found,
        incomplete: incomplete.length ? incomplete : undefined,
        drift:      entry.drift?.sections?.length ? entry.drift.sections : undefined,
    });

    return { appid, found: entry.found, incomplete, drift: entry.drift, htmlFromCache };
}

/**
 * Bulk-sync PCGamingWiki data for all owned Steam games.
 * Already-complete entries are skipped; incomplete entries only re-fetch what's missing.
 * One Puppeteer browser instance is shared across all games in the run.
 */
export async function syncAll({ force = false, reparse = false, fetchFn = fetch, htmlFn = null, onProgress } = {}) {
    const games = await getAllGames();
    if (games.length === 0) throw new Error('No games found — run Steam sync first');
    await fs.mkdir(pcgwDir(), { recursive: true });

    let fetched = 0, skipped = 0, noPage = 0, failed = 0, driftWarnings = 0, htmlCacheHits = 0;

    // The slowest sync in the app — one Puppeteer page load per game. Report 0%
    // before the first one so the dashboard draws a determinate meter, not a pulse.
    onProgress?.(0, games.length);

    const width   = String(games.length).length;
    const counter = n => `[${String(n + 1).padStart(width)}/${games.length}]`;

    let resolvedHtmlFn = htmlFn;
    if (!resolvedHtmlFn) {
        const browser  = await _getBrowser();
        resolvedHtmlFn = url => fetchPageWithBrowser(browser, url);
    }

    for (let i = 0; i < games.length; i++) {
        const game   = games[i];
        const prefix = `[pcgw] ${counter(i)} ${game.name}`;

        if (!force && !reparse) {
            try {
                const existing = migrateSections(
                    JSON.parse(await fs.readFile(entryPath(game.appid), 'utf8'))
                );
                const sectionsToCheck = existing.found === false
                    ? ['pageTitle']
                    : ALL_SECTIONS;
                const needsWork = sectionsToCheck.some(n => sectionNeedsFetch(existing.sections[n], false));
                if (!needsWork) {
                    skipped++;
                    logger.info(`${prefix} — skipped`);
                    onProgress?.(i + 1, games.length);
                    continue;
                }
            } catch { /* entry doesn't exist yet */ }
        }

        // Only the network path needs rate-limiting; a cache-served game sleeps for nothing.
        let hitNetwork = true;
        try {
            const result = await syncGame(game.appid, { force, reparse, fetchFn, htmlFn: resolvedHtmlFn, steamName: game.name });
            if (!result.found) {
                noPage++;
                logger.info(`${prefix} — no page`);
            } else {
                fetched++;
                const source = result.htmlFromCache ? 'cached' : 'fetched';
                const drift  = result.drift?.drifted ? ' [drift]' : '';
                logger.info(`${prefix} — ${source}${drift}`);
            }
            if (result.htmlFromCache) { htmlCacheHits++; hitNetwork = false; }
            if (result.drift?.drifted)   driftWarnings++;
        } catch (err) {
            failed++;
            logger.warn(`${prefix} — failed: ${err.message}`);
        }

        onProgress?.(i + 1, games.length);
        if (hitNetwork && i < games.length - 1) await jitter();
    }

    await rebuildIndex();
    logger.info('[pcgw] Sync complete', { fetched, skipped, noPage, failed, driftWarnings, htmlCacheHits, total: games.length });
    return { fetched, skipped, noPage, failed, driftWarnings, htmlCacheHits, total: games.length };
}
