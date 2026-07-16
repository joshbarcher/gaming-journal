// Port of relay-server src/controllers/guides/guides.controller.js.
//
// The Express (req, res) handlers become framework-neutral functions that the
// SvelteKit routes under src/routes/relay/api/guides/ adapt to Responses:
//   - plain handlers return { status, body } (+ optional cacheControl)
//   - SSE handlers return either { status, body } (pre-stream validation
//     failure) or { run(send) } — an async runner the route drives against a
//     ReadableStream; send(data) writes one `data: <json>\n\n` frame. Event
//     names/payloads are byte-identical to the relay (web + RN parse them).
//
// Wave-3 debts repaid (docs/relay-fold-in.md "Wave-3 debts"): games.service and
// home.service are ported now, so the IGN release-year disambiguation reads
// games.service.getOne and mark-used busts the local home payload cache —
// exactly as the relay controller does.

import { readdir, readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { join }                                      from 'node:path';
import { spawn }                                     from 'node:child_process';
import { launchBrowser as launchGfaqsBrowser,       searchGame as searchGameFAQs }   from './gamefaqs/search.service.js';
import { launchBrowser as launchIgnBrowser,          searchGame as searchIgn }        from './ign/search.service.js';
import { launchBrowser as launchGame8Browser,        searchGame as searchGame8 }     from './game8/search.service.js';
import { searchGame as searchSteam }                                                   from './steam/search.service.js';
import { searchGame as searchGamerGuides }                                             from './gamerguides/search.service.js';
import { launchBrowser as launchFandomBrowser,       searchGame as searchFandom }    from './fandom/search.service.js';
import { launchBrowser as launchNeoseekerBrowser,   searchGame as searchNeoseeker } from './neoseeker/search.service.js';
import { launchBrowser as launchTheGamerBrowser,    searchGame as searchTheGamer }  from './thegamer/search.service.js';
import { getOne as getGame }                                                           from '../games/games.service.js';
import { invalidateHomeCache }                                                         from '../home/home.service.js';
import { featureDir }                                                                  from '../shared/data-root.js';
import { TOOLS_DIR }                                                                   from './tools-dir.js';

// ── Path helpers ──────────────────────────────────────────────────────────────
// featureDir() is read at call time (not module load) so tests can point
// DATA_DIR at a temp dir after import.

function steamRoot(steamId)                              { return join(featureDir('guides'), String(steamId)); }
function guideRoot(steamId, source, guideId)             { return join(steamRoot(steamId), source, guideId); }
function metaPath(steamId, source, guideId)              { return join(guideRoot(steamId, source, guideId), '_meta.json'); }
function usagePath(steamId, source, guideId)              { return join(guideRoot(steamId, source, guideId), '_usage.json'); }
function sectionPath(steamId, source, guideId, section)  { return join(guideRoot(steamId, source, guideId), section, 'content.json'); }
function searchPath(steamId)                             { return join(steamRoot(steamId), '_search.json'); }

async function isDir(p) {
    try { return (await stat(p)).isDirectory(); } catch { return false; }
}

// Strip " by Author", "(PC)", "(PS5/PC)", etc. from GameFAQs guide titles
function cleanTitle(raw) {
    return raw
        .replace(/\s+by\s+.+$/i, '')
        .replace(/\s*\([^)]*\)\s*$/, '')
        .trim()
}

// Load _search.json and build a guideId → cleaned title map for one steamId.
// Handles all sources: GameFAQs (numeric faqId), IGN (wikiSlug), Steam (id), Game8 (gameSlug).
function guideIdFromUrl(source, url) {
    if (!url) return null;
    if (source === 'ign')         return url.match(/ign\.com\/wikis\/([^/?#]+)/i)?.[1]?.toLowerCase() ?? null;
    if (source === 'steam')       { try { return new URL(url).searchParams.get('id') ?? null; } catch { return null; } }
    if (source === 'game8')       return url.match(/game8\.co\/games\/([A-Za-z0-9-]+)/i)?.[1] ?? null;
    if (source === 'gamerguides') return url.match(/gamerguides\.com\/([^/?#]+)/i)?.[1] ?? null;
    if (source === 'fandom') {
        const m = url.match(/^https?:\/\/([a-z0-9-]+)\.fandom\.com\/wiki\/([^?#]+)/i);
        if (!m) return null;
        return `${m[1]}--${decodeURIComponent(m[2]).replace(/ /g, '_')}`;
    }
    if (source === 'neoseeker') return url.match(/neoseeker\.com\/([a-z0-9-]+)\/walkthrough/i)?.[1] ?? null;
    if (source === 'thegamer') {
        const slug = url.match(/thegamer\.com\/([a-z0-9-]+)\/?(?:[?#]|$)/i)?.[1]?.toLowerCase() ?? null;
        return (slug && !['tag', 'author', 'category', 'search'].includes(slug)) ? slug : null;
    }
    return url.match(/\/faqs\/(\d+)/)?.[1] ?? null;
}

async function buildTitleMap(steamId) {
    try {
        const raw    = await readFile(searchPath(steamId), 'utf8');
        const search = JSON.parse(raw);
        const map    = {};

        for (const [src, srcData] of Object.entries(search.sources ?? {})) {
            for (const g of srcData.guides ?? []) {
                const id = guideIdFromUrl(src, g.url);
                if (id) map[id] = cleanTitle(g.title);
            }
        }

        return map;
    } catch {
        return {};
    }
}

// ── In-progress tracking ──────────────────────────────────────────────────────

const _downloading = new Set();
const _searching   = new Set();

// Per-steamId write lock so parallel gamefaqs + ign searches don't clobber each other.
const _writeLocks = new Map();
async function withWriteLock(steamId, fn) {
    const prev = _writeLocks.get(steamId) ?? Promise.resolve();
    let release;
    const next = new Promise(r => { release = r; });
    _writeLocks.set(steamId, next);
    await prev;
    try { return await fn(); } finally { release(); }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/**
 * GET /api/guides/:steamId
 * Returns flat list of all downloaded guides across all sources.
 * [ { source, guideId, title, author, parsedAt, pageCount, lastUsedAt } ]
 */
export async function listGuides(steamId) {
    const root = steamRoot(steamId);

    let sourceDirs;
    try {
        sourceDirs = await readdir(root);
    } catch {
        return [];
    }

    const titleMap = await buildTitleMap(steamId);
    const guides = [];
    let n = 0;

    for (const source of sourceDirs) {
        if (source.startsWith('_')) continue;
        const srcDir = join(root, source);
        if (!await isDir(srcDir)) continue;

        let guideIds;
        try { guideIds = await readdir(srcDir); } catch { continue; }

        for (const guideId of guideIds) {
            if (guideId.startsWith('_')) continue;
            const gDir = join(srcDir, guideId);
            if (!await isDir(gDir)) continue;

            n++;
            let lastUsedAt = null;
            try { lastUsedAt = JSON.parse(await readFile(join(gDir, '_usage.json'), 'utf8')).lastUsedAt ?? null; } catch { /* never used */ }

            try {
                const meta = JSON.parse(await readFile(join(gDir, '_meta.json'), 'utf8'));
                guides.push({
                    source,
                    guideId,
                    title:      titleMap[guideId] ?? `Guide #${n}`,
                    author:     meta.author,
                    parsedAt:   meta.parsedAt,
                    pageCount:  meta.pages?.length ?? 0,
                    sizeBytes:  meta.sizeBytes ?? 0,
                    lastUsedAt,
                });
            } catch {
                guides.push({ source, guideId, title: titleMap[guideId] ?? `Guide #${n}`, author: null, parsedAt: null, pageCount: 0, sizeBytes: 0, lastUsedAt });
            }
        }
    }

    return guides;
}

/**
 * GET /api/guides/:steamId/search
 * Returns cached _search.json (pre-computed guide discovery results), or null.
 */
export async function getSearch(steamId) {
    try {
        const raw = await readFile(searchPath(steamId), 'utf8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/**
 * GET /api/guides/:steamId/:source/:guideId/fulltext
 * Returns _fulltext.json (pre-built Fuse.js search index).
 * If the file is missing (guide parsed before fulltext feature), builds it on-the-fly
 * from the per-page content.json files, persists it, and returns the result.
 */
export async function getFulltext(steamId, source, guideId) {
    const root         = guideRoot(steamId, source, guideId);
    const fulltextPath = join(root, '_fulltext.json');

    // Fast path: index already on disk
    try {
        const raw = await readFile(fulltextPath, 'utf8');
        return { status: 200, body: JSON.parse(raw), cacheControl: 'public, max-age=3600' };
    } catch { /* fall through */ }

    // Build on-the-fly from per-page content.json files
    try {
        const meta  = JSON.parse(await readFile(join(root, '_meta.json'), 'utf8'));
        const pages = meta.pages ?? [];

        const stripHtml = s => (s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const entries   = [];

        function extractListItem(item, slug, label) {
            const text = stripHtml(item.text ?? '');
            if (text.length > 3) entries.push({ slug, label, text });
            for (const child of item.children?.items ?? []) extractListItem(child, slug, label);
        }

        function extractText(block, slug, label) {
            switch (block.type) {
                case 'section':
                    if (block.heading) entries.push({ slug, label, text: block.heading });
                    for (const child of block.children ?? []) extractText(child, slug, label);
                    break;
                case 'paragraph': {
                    const text = stripHtml(block.html);
                    if (text.length > 10) entries.push({ slug, label, text });
                    break;
                }
                case 'list':
                    for (const item of block.items ?? []) extractListItem(item, slug, label);
                    break;
                case 'table': {
                    const cells = [
                        ...(block.headers ?? []),
                        ...(block.rows ?? []).flat(),
                    ].map(c => stripHtml(c?.text ?? c?.html ?? '')).filter(Boolean);
                    if (cells.length) entries.push({ slug, label, text: cells.join(' · ') });
                    break;
                }
            }
        }

        for (const page of pages) {
            const safeSeg = page.slug.replace(/[\\/:*?"<>|]/g, '_');
            try {
                const blocks = JSON.parse(await readFile(join(root, safeSeg, 'content.json'), 'utf8'));
                for (const block of blocks) extractText(block, page.slug, page.label);
            } catch { /* section missing or not yet parsed */ }
        }

        // Persist so future requests hit the fast path
        await writeFile(fulltextPath, JSON.stringify(entries)).catch(() => {});

        return { status: 200, body: entries, cacheControl: 'public, max-age=3600' };
    } catch {
        return { status: 404, body: { error: 'Fulltext index not found — re-parse the guide' } };
    }
}

/**
 * GET /api/guides/:steamId/:source/:guideId/meta
 * Returns _meta.json for a specific downloaded guide.
 */
export async function getMeta(steamId, source, guideId) {
    try {
        const [meta, titleMap] = await Promise.all([
            readFile(metaPath(steamId, source, guideId), 'utf8').then(JSON.parse),
            buildTitleMap(steamId),
        ]);
        if (titleMap[guideId]) meta.title = titleMap[guideId];
        // sizeBytes is written by parse-guide.js at parse time — no live dirSize call needed
        return { status: 200, body: meta };
    } catch {
        return { status: 404, body: { error: 'Guide not found' } };
    }
}

/**
 * POST /api/guides/:steamId/:source/:guideId/mark-used
 * Records "now" as the guide's lastUsedAt timestamp, written to a sibling
 * _usage.json so re-parsing the guide (which rewrites _meta.json) never
 * clobbers usage history.
 */
export async function markUsed(steamId, source, guideId) {
    const root = guideRoot(steamId, source, guideId);

    if (!await isDir(root)) return { status: 404, body: { error: 'Guide not found' } };

    const lastUsedAt = new Date().toISOString();
    try {
        await writeFile(usagePath(steamId, source, guideId), JSON.stringify({ lastUsedAt }));
        // Bust the home payload cache so the landing page's guide card reflects
        // the new "most recently used" ordering immediately.
        invalidateHomeCache();
        return { status: 200, body: { ok: true, lastUsedAt } };
    } catch (err) {
        return { status: 500, body: { error: err.message } };
    }
}

/**
 * GET /api/guides/:steamId/:source/:guideId/:section
 * Returns content.json for one section of a guide.
 */
export async function getSection(steamId, source, guideId, section) {
    if (/\.\./.test(section)) return { status: 400, body: { error: 'Invalid section' } };
    const safeSection = section.replace(/[\\/:*?"<>|]/g, '_');
    try {
        const raw = await readFile(sectionPath(steamId, source, guideId, safeSection), 'utf8');
        return { status: 200, body: JSON.parse(raw) };
    } catch {
        return { status: 404, body: { error: 'Section not found' } };
    }
}

/**
 * POST /api/guides/:steamId/search
 * Body: { gameName: string, source?: 'gamefaqs'|'ign' }
 *
 * Runs a live guide search for the game, saves _search.json, and streams
 * progress via Server-Sent Events.
 *
 * SSE event shapes:
 *   { phase: "status",    message: string }
 *   { phase: "done",      data: SearchJson }
 *   { phase: "not_found", message: string }
 *   { phase: "error",     message: string }
 */
export function beginSearchRun(steamId, body) {
    const { gameName, source = 'gamefaqs' } = body ?? {};

    if (!gameName || typeof gameName !== 'string') {
        return { status: 400, body: { error: 'gameName is required' } };
    }
    if (!['gamefaqs', 'ign', 'steam', 'game8', 'gamerguides', 'fandom', 'neoseeker', 'thegamer'].includes(source)) {
        return { status: 400, body: { error: 'source must be "gamefaqs", "ign", "steam", "game8", "gamerguides", "fandom", "neoseeker", or "thegamer"' } };
    }

    const searchKey = `${steamId}:${source}`;
    if (_searching.has(searchKey)) {
        return { status: 409, body: { error: 'Search already in progress for this game' } };
    }
    _searching.add(searchKey);

    const run = async (send) => {
        let browser;
        try {
            const gameDir = steamRoot(steamId);
            await mkdir(gameDir, { recursive: true });

            if (source === 'ign') {
                // ── IGN search ────────────────────────────────────────────────────
                send({ phase: 'status', message: `Launching browser…` });
                browser = await launchIgnBrowser();
                send({ phase: 'status', message: `Searching IGN wikis for "${gameName}"…` });

                // Extract release year for disambiguation (e.g. RE2 original vs remake)
                const gameData    = getGame(steamId);
                const yearStr     = gameData?.store?.releaseDate ?? gameData?.releaseDate ?? '';
                const yearMatch   = String(yearStr).match(/\b(19|20)\d{2}\b/);
                const releaseYear = yearMatch ? Number(yearMatch[0]) : null;

                const result = await searchIgn(browser, gameName, { releaseYear });

                if (result.status === 'error') { send({ phase: 'error',     message: result.error }); return; }
                if (result.status === 'not_found') { send({ phase: 'not_found', message: `No IGN wiki found for "${gameName}"` }); return; }

                const searchJson = await withWriteLock(steamId, async () => {
                    let fresh = {};
                    try { fresh = JSON.parse(await readFile(searchPath(steamId), 'utf8')); } catch { /* fresh start */ }
                    const merged = {
                        ...fresh,
                        steamId,
                        sources: {
                            ...(fresh.sources ?? {}),
                            ign: {
                                searchedAt:  new Date().toISOString(),
                                matchedGame: { name: result.wikiName, gameUrl: result.wikiUrl, score: result.score },
                                guides:      [{ title: `${result.wikiName} Wiki`, url: result.wikiUrl, type: 'html' }],
                            },
                        },
                    };
                    await writeFile(searchPath(steamId), JSON.stringify(merged, null, 2));
                    return merged;
                });
                send({ phase: 'done', data: searchJson });

            } else if (source === 'game8') {
                // ── Game8 search ──────────────────────────────────────────────────
                send({ phase: 'status', message: `Launching browser…` });
                browser = await launchGame8Browser();
                send({ phase: 'status', message: `Searching Game8 for "${gameName}"…` });
                const result = await searchGame8(browser, gameName);

                if (result.status === 'error')     { send({ phase: 'error',     message: result.error }); return; }
                if (result.status === 'not_found') { send({ phase: 'not_found', message: `No Game8 wiki found for "${gameName}"` }); return; }

                const gameUrl = result.gameUrl ?? `https://game8.co/games/${result.gameSlug}`;
                const searchJson = await withWriteLock(steamId, async () => {
                    let fresh = {};
                    try { fresh = JSON.parse(await readFile(searchPath(steamId), 'utf8')); } catch { /* fresh start */ }
                    const merged = {
                        ...fresh,
                        steamId,
                        sources: {
                            ...(fresh.sources ?? {}),
                            game8: {
                                searchedAt:  new Date().toISOString(),
                                matchedGame: { name: result.gameName, gameUrl, score: result.score },
                                guides:      [{ title: `${result.gameName} Wiki`, url: gameUrl, type: 'html' }],
                            },
                        },
                    };
                    await writeFile(searchPath(steamId), JSON.stringify(merged, null, 2));
                    return merged;
                });
                send({ phase: 'done', data: searchJson });

            } else if (source === 'steam') {
                // ── Steam search (no browser — direct API call) ───────────────────
                send({ phase: 'status', message: `Searching Steam guides for "${gameName}"…` });
                const result = await searchSteam(steamId, gameName);

                if (result.status === 'error')     { send({ phase: 'error',     message: result.error }); return; }
                if (result.status === 'not_found') { send({ phase: 'not_found', message: `No Steam community guides found for "${gameName}"` }); return; }

                const searchJson = await withWriteLock(steamId, async () => {
                    let fresh = {};
                    try { fresh = JSON.parse(await readFile(searchPath(steamId), 'utf8')); } catch { /* fresh start */ }
                    const merged = {
                        ...fresh,
                        steamId,
                        sources: {
                            ...(fresh.sources ?? {}),
                            steam: {
                                searchedAt:  new Date().toISOString(),
                                matchedGame: result.matchedGame,
                                guides:      result.guides,
                                categories:  result.categories,
                            },
                        },
                    };
                    await writeFile(searchPath(steamId), JSON.stringify(merged, null, 2));
                    return merged;
                });
                send({ phase: 'done', data: searchJson });

            } else if (source === 'gamerguides') {
                // ── Gamer Guides search (no browser — slug inference) ─────────────
                send({ phase: 'status', message: `Searching Gamer Guides for "${gameName}"…` });
                const result = await searchGamerGuides(gameName);

                if (result.status === 'error')     { send({ phase: 'error',     message: result.error }); return; }
                if (result.status === 'not_found') { send({ phase: 'not_found', message: `No Gamer Guides guide found for "${gameName}"` }); return; }

                const guideUrl = result.guideUrl ?? `https://www.gamerguides.com/${result.gameSlug}/guide`;
                const searchJson = await withWriteLock(steamId, async () => {
                    let fresh = {};
                    try { fresh = JSON.parse(await readFile(searchPath(steamId), 'utf8')); } catch { /* fresh start */ }
                    const merged = {
                        ...fresh,
                        steamId,
                        sources: {
                            ...(fresh.sources ?? {}),
                            gamerguides: {
                                searchedAt:  new Date().toISOString(),
                                matchedGame: { name: result.gameName, gameUrl: guideUrl, score: result.score },
                                guides:      [{ title: `${result.gameName} Guide`, url: guideUrl, type: 'html' }],
                            },
                        },
                    };
                    await writeFile(searchPath(steamId), JSON.stringify(merged, null, 2));
                    return merged;
                });
                send({ phase: 'done', data: searchJson });

            } else if (source === 'fandom') {
                // ── Fandom search ─────────────────────────────────────────────────
                send({ phase: 'status', message: `Launching browser…` });
                browser = await launchFandomBrowser();
                send({ phase: 'status', message: `Searching Fandom wikis for "${gameName}"…` });
                const result = await searchFandom(browser, gameName);

                if (result.status === 'error')     { send({ phase: 'error',     message: result.error }); return; }
                if (result.status === 'not_found') { send({ phase: 'not_found', message: `No Fandom wiki found for "${gameName}"` }); return; }

                const wikiUrl = `${result.wikiBase}/wiki/${result.articleSlug}`;
                const searchJson = await withWriteLock(steamId, async () => {
                    let fresh = {};
                    try { fresh = JSON.parse(await readFile(searchPath(steamId), 'utf8')); } catch { /* fresh start */ }
                    const merged = {
                        ...fresh,
                        steamId,
                        sources: {
                            ...(fresh.sources ?? {}),
                            fandom: {
                                searchedAt:  new Date().toISOString(),
                                matchedGame: { name: result.gameName, gameUrl: wikiUrl, score: result.score },
                                guides:      [{ title: `${result.gameName} Wiki`, url: wikiUrl, type: 'html' }],
                            },
                        },
                    };
                    await writeFile(searchPath(steamId), JSON.stringify(merged, null, 2));
                    return merged;
                });
                send({ phase: 'done', data: searchJson });

            } else if (source === 'neoseeker') {
                // ── Neoseeker search ──────────────────────────────────────────────
                send({ phase: 'status', message: `Launching browser…` });
                browser = await launchNeoseekerBrowser();
                send({ phase: 'status', message: `Searching Neoseeker for "${gameName}"…` });
                const result = await searchNeoseeker(browser, gameName);

                if (result.status === 'error')     { send({ phase: 'error',     message: result.error }); return; }
                if (result.status === 'not_found') { send({ phase: 'not_found', message: `No Neoseeker walkthrough found for "${gameName}"` }); return; }

                const guideUrl = result.url;
                const searchJson = await withWriteLock(steamId, async () => {
                    let fresh = {};
                    try { fresh = JSON.parse(await readFile(searchPath(steamId), 'utf8')); } catch { /* fresh start */ }
                    const guideName = result.title.replace(/\s+Walkthrough.*$/i, '').trim() || gameName;
                    const merged = {
                        ...fresh,
                        steamId,
                        sources: {
                            ...(fresh.sources ?? {}),
                            neoseeker: {
                                searchedAt:  new Date().toISOString(),
                                matchedGame: { name: guideName, gameUrl: guideUrl, score: result.score },
                                guides:      [{ title: `${guideName} Walkthrough`, url: guideUrl, type: 'html' }],
                            },
                        },
                    };
                    await writeFile(searchPath(steamId), JSON.stringify(merged, null, 2));
                    return merged;
                });
                send({ phase: 'done', data: searchJson });

            } else if (source === 'thegamer') {
                // ── TheGamer search (DuckDuckGo — returns multiple guide articles) ─
                send({ phase: 'status', message: `Launching browser…` });
                browser = await launchTheGamerBrowser();
                send({ phase: 'status', message: `Searching TheGamer for "${gameName}"…` });
                const result = await searchTheGamer(browser, gameName);

                if (result.status === 'error')     { send({ phase: 'error',     message: result.error }); return; }
                if (result.status === 'not_found') { send({ phase: 'not_found', message: `No TheGamer guides found for "${gameName}"` }); return; }

                const searchJson = await withWriteLock(steamId, async () => {
                    let fresh = {};
                    try { fresh = JSON.parse(await readFile(searchPath(steamId), 'utf8')); } catch { /* fresh start */ }
                    const merged = {
                        ...fresh,
                        steamId,
                        sources: {
                            ...(fresh.sources ?? {}),
                            thegamer: {
                                searchedAt:  new Date().toISOString(),
                                matchedGame: { name: gameName, gameUrl: result.guides[0].url, score: result.guides[0].score },
                                guides:      result.guides.map(g => ({ title: g.title, url: g.url, type: 'html' })),
                            },
                        },
                    };
                    await writeFile(searchPath(steamId), JSON.stringify(merged, null, 2));
                    return merged;
                });
                send({ phase: 'done', data: searchJson });

            } else {
                // ── GameFAQs search ───────────────────────────────────────────────
                send({ phase: 'status', message: `Launching browser…` });
                browser = await launchGfaqsBrowser();
                send({ phase: 'status', message: `Searching GameFAQs for "${gameName}"…` });
                const result = await searchGameFAQs(browser, gameName);

                if (result.status === 'error')    { send({ phase: 'error',     message: result.error }); return; }
                if (result.status === 'not_found') { send({ phase: 'not_found', message: `No match found on GameFAQs for "${gameName}"` }); return; }
                if (result.status === 'no_guides') { send({ phase: 'not_found', message: `"${result.matchedGame?.name ?? gameName}" found but has no guides listed` }); return; }

                const searchJson = await withWriteLock(steamId, async () => {
                    let fresh = {};
                    try { fresh = JSON.parse(await readFile(searchPath(steamId), 'utf8')); } catch { /* fresh start */ }
                    const merged = {
                        ...fresh,
                        steamId,
                        sources: {
                            ...(fresh.sources ?? {}),
                            gamefaqs: {
                                searchedAt:  new Date().toISOString(),
                                matchedGame: result.matchedGame ?? null,
                                guides:      result.guides ?? [],
                            },
                        },
                    };
                    await writeFile(searchPath(steamId), JSON.stringify(merged, null, 2));
                    return merged;
                });
                send({ phase: 'done', data: searchJson });
            }

        } catch (err) {
            send({ phase: 'error', message: err.message });
        } finally {
            _searching.delete(searchKey);
            await browser?.close().catch(() => {});
        }
    };

    return { run };
}

/**
 * POST /api/guides/:steamId/download
 * Body: { source: "gamefaqs", url: "https://gamefaqs.gamespot.com/.../faqs/82117/..." }
 *
 * Extracts guideId from the URL, runs fetch-guide.js then parse-guide.js as child
 * processes, and streams progress via Server-Sent Events.
 *
 * SSE event shape: { phase: "fetch"|"parse"|"done"|"error", line?: string, message?: string }
 */
export function beginDownload(steamId, body) {
    const { source = 'gamefaqs', url } = body ?? {};

    if (!url || typeof url !== 'string') {
        return { status: 400, body: { error: 'url is required' } };
    }
    if (!/^https?:\/\//.test(url)) {
        return { status: 400, body: { error: 'url must be an absolute https URL' } };
    }

    // Extract guide ID per source:
    //   gamefaqs — numeric faqId from /faqs/{id}
    //   ign      — wiki slug from /wikis/{slug}
    let guideId;
    guideId = guideIdFromUrl(source, url);

    if (!guideId) {
        return { status: 400, body: { error: 'Could not extract guide ID from URL' } };
    }

    const key = `${steamId}:${source}:${guideId}`;
    if (_downloading.has(key)) {
        return { status: 409, body: { error: 'Download already in progress for this guide' } };
    }
    _downloading.add(key);

    const run = async (sendRaw) => {
        function send(data) {
            console.log(`[guides:download:send] ${new Date().toISOString()}`, JSON.stringify(data).slice(0, 120));
            sendRaw(data);
        }

        // ── Child process helper ──────────────────────────────────────────────

        function runScript(scriptName, args) {
            return new Promise((resolve, reject) => {
                const child = spawn(
                    process.execPath,
                    [join(TOOLS_DIR, scriptName), ...args],
                    { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }
                );

                child.stdout.setEncoding('utf8');
                child.stderr.setEncoding('utf8');

                let buffer = '';

                const flush = (chunk) => {
                    buffer += chunk;
                    const lines = buffer.split('\n');
                    buffer = lines.pop() ?? '';
                    for (const line of lines) {
                        if (!line.trim()) continue;
                        if (line.startsWith('[PROGRESS] ')) {
                            console.log(`[guides:download:progress-line] ${new Date().toISOString()}`, line.slice(11, 80));
                            try {
                                send({ phase: 'progress', ...JSON.parse(line.slice(11)) });
                            } catch { /* malformed — ignore */ }
                        } else {
                            send({ phase: scriptName.replace('.js', ''), line });
                        }
                    }
                };

                child.stdout.on('data', flush);
                child.stderr.on('data', flush);

                child.on('close', code => {
                    if (buffer.trim()) send({ phase: scriptName.replace('.js', ''), line: buffer });
                    if (code === 0) resolve();
                    else reject(new Error(`${scriptName} exited with code ${code}`));
                });

                child.on('error', reject);
            });
        }

        // ── Run pipeline ──────────────────────────────────────────────────────

        try {
            send({ phase: 'fetch', line: `Fetching guide pages…` });
            await runScript('fetch-guide.js', [
                '--url',      url,
                '--steam-id', String(steamId),
                '--source',   source,
                '--guide-id', guideId,
            ]);

            send({ phase: 'parse', line: `Parsing guide content…` });
            await runScript('parse-guide.js', [
                '--steam-id', String(steamId),
                '--source',   source,
                '--guide-id', guideId,
            ]);

            send({ phase: 'done' });
        } catch (err) {
            send({ phase: 'error', message: err.message });
        } finally {
            _downloading.delete(key);
        }
    };

    return { run };
}
