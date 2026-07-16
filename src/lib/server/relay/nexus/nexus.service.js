// Ported verbatim from relay-server src/services/nexus/nexus.service.js
// (docs/relay-fold-in.md §6 — logic byte-identical; only imports + data-dir
// helpers rewritten). Data stays under $RELAY_DATA_ROOT/nexus — same on-disk
// paths as the relay.
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import logger from '../../logger.js';
import { mapChunked } from '../shared/map-chunked.js';
import { getAllGames } from '../shared/getAllGames.js';
import { featureDir } from '../shared/data-root.js';
import { tracked } from '../metrics/tracked.js';
import { recordWrite } from '../../../../../activity.js';
import { parseContent } from '../guides/parser/content-parser.js';
import { bbcodeToHtml } from './bbcode.js';
import { scrapeAuthorImages } from './images-scraper.js';

// Turn a mod's BBCode description into structured ContentBlock[] by reusing the guide
// parser: BBCode → semantic HTML → Cheerio → parseContent (which sanitises each
// paragraph via cleanInlineHtml and models headings/lists/images). Keep external links.
const DESC_PARSE_CFG = { links: { keepExternal: true, keepInternal: false }, br: { behavior: 'keep' } };
export function descriptionToBlocks(bbcode) {
    const html = bbcodeToHtml(bbcode);
    if (!html) return [];
    try {
        const $ = cheerio.load(`<div id="__nx">${html}</div>`);
        return parseContent($, $('#__nx')[0], DESC_PARSE_CFG, {});
    } catch (err) {
        logger.warn('[nexus] description parse failed', { err: err.message });
        return [];
    }
}

// NexusMods exposes two programmatic surfaces, both OUTSIDE the Cloudflare wall
// that fronts the website: the v1 REST API (used here only for the games list,
// which the v2 schema does not expose cleanly) and the v2 GraphQL API (used for
// the per-game mod list — one query returns everything the card needs).
const NEXUS_REST    = 'https://api.nexusmods.com/v1';
const NEXUS_GRAPHQL = 'https://api.nexusmods.com/v2/graphql';
const SITE_BASE     = 'https://www.nexusmods.com';

// How many mods to store per game. The section shows a handful; a future full
// "all mods" page can raise this or paginate — the stored shape already carries
// totalMods, categories, and dates to support that.
const MOD_COUNT = parseInt(process.env.NEXUS_MOD_COUNT ?? '12', 10);

const DEFAULT_TTL_DAYS = 7;          // mod rankings move slowly — weekly is plenty
const GAMES_TTL_DAYS   = 7;          // the games list changes rarely

const MIN_DELAY_MS = 150;
const MAX_DELAY_MS = 400;

// Below this many remaining calls in the current window we stop reaching out and
// serve/keep cache instead — being a good API citizen per the Acceptable Use Policy.
const RL_FLOOR = 100;

function jitter(min, max) { return min + Math.random() * (max - min); }
function sleep(ms)        { return new Promise(r => setTimeout(r, ms)); }

// ── In-memory caches ────────────────────────────────────────────────────────────
// The relay is the SOLE writer of these JSON files, so we serve reads from memory
// and write through to disk — queries (full-page infinite scroll, sort, search,
// mod-detail) never re-read the NAS. A modest TTL still lets an out-of-band file
// edit surface eventually. Populated on read, refreshed on every write.
const MEM_TTL_MS = 10 * 60 * 1_000;
let   _gamesMem  = null;               // { games, at }
const _entryMem  = new Map();          // appid       -> { value, at }  (value may be null)
const _detailMem = new Map();          // `${appid}:${modId}` -> { value, at }

function memGet(map, key) {
    const hit = map.get(key);
    if (hit && (Date.now() - hit.at) < MEM_TTL_MS) return hit;   // { value }
    return null;
}
function memSet(map, key, value) { map.set(key, { value, at: Date.now() }); }

// Drop all in-memory caches (test isolation / manual flush).
export function _resetCaches() { _gamesMem = null; _entryMem.clear(); _detailMem.clear(); _deepMem.clear(); }

function nexusDir()       { return featureDir('nexus'); }
function entryPath(appid) { return path.join(nexusDir(), `${appid}.json`); }
function indexPath()      { return path.join(nexusDir(), 'index.json'); }
function gamesCachePath() { return path.join(nexusDir(), 'games.json'); }
function overridesPath()  { return path.join(nexusDir(), 'overrides.json'); }
function imagesDir(appid) { return path.join(nexusDir(), 'images', String(appid)); }

function syncIntervalHours() {
    return parseInt(process.env.NEXUS_SYNC_INTERVAL_HOURS ?? String(DEFAULT_TTL_DAYS * 24), 10);
}

function apiKey() {
    const key = process.env.NEXUS_API_KEY;
    if (!key) throw new Error('NEXUS_API_KEY not configured');
    return key;
}

// Nexus asks integrations to identify themselves. These headers are sent on
// every call; the apikey authenticates as the operator's personal (personal-use)
// key. See docs/features/external/nexus.md.
function headers(extra = {}) {
    return {
        apikey:                apiKey(),
        'Application-Name':    'gaming-journal',
        'Application-Version': process.env.NEXUS_APP_VERSION ?? '0.1',
        'User-Agent':          'gaming-journal/0.1 (personal LAN app)',
        ...extra,
    };
}

// Reads NexusMods' rate-limit headers and warns as the window drains. Returns
// the smaller of the hourly/daily remaining counts, or null when absent.
function readRateLimit(res, ctx) {
    const raw    = [res.headers.get('x-rl-hourly-remaining'), res.headers.get('x-rl-daily-remaining')];
    const vals   = raw.filter(v => v != null && v !== '').map(Number).filter(Number.isFinite);
    if (vals.length === 0) return null;   // endpoint didn't report limits — treat as unknown, not zero
    const remaining = Math.min(...vals);
    if (remaining <= RL_FLOOR) {
        logger.warn('[nexus] Rate-limit window low — backing off', { ctx, remaining });
    }
    return remaining;
}

// ── Nexus API calls ─────────────────────────────────────────────────────────

// Full games catalogue (~4,900 entries). Cached to disk with a weekly TTL so we
// hit this heavy endpoint at most once a week regardless of how many games get
// resolved. Returns [{ id, name, domain_name }, ...].
async function fetchGamesList(fetchFn = fetch) {
    const res = await fetchFn(`${NEXUS_REST}/games.json`, { headers: headers() });
    readRateLimit(res, 'games');
    if (!res.ok) throw new Error(`Nexus games list failed: ${res.status}`);
    const list = await res.json();
    return (Array.isArray(list) ? list : [])
        .map(g => ({ id: g.id, name: g.name, domain_name: g.domain_name }));
}

async function getGamesList({ force = false, fetchFn = fetch } = {}) {
    // Memory first — the games list is ~4,900 entries and would otherwise be re-read
    // off the NAS on every uncached resolution.
    if (!force && _gamesMem && (Date.now() - _gamesMem.at) < MEM_TTL_MS) return _gamesMem.games;

    if (!force) {
        try {
            const cached = JSON.parse(await fs.readFile(gamesCachePath(), 'utf8'));
            const age = Date.now() - new Date(cached.fetchedAt).getTime();
            if (age < GAMES_TTL_DAYS * 86_400_000 && Array.isArray(cached.games)) {
                _gamesMem = { games: cached.games, at: Date.now() };
                return cached.games;
            }
        } catch { /* not cached / stale — refetch */ }
    }
    const games = await fetchGamesList(fetchFn);
    await fs.mkdir(nexusDir(), { recursive: true });
    await fs.writeFile(gamesCachePath(), JSON.stringify({ fetchedAt: new Date().toISOString(), games }, null, 2));
    _gamesMem = { games, at: Date.now() };
    logger.info('[nexus] Games list cached', { count: games.length });
    return games;
}

// Fields fetched for list/section/full-page cards. One GraphQL page.
const MOD_LIST_FIELDS = `modId gameId name summary version author fileSize
  uploader{ name avatar }
  pictureUrl thumbnailUrl thumbnailLargeUrl downloads endorsements adult status category
  tags{ name }
  createdAt updatedAt`;

const MODS_QUERY = `query($f:ModsFilter,$s:[ModsSort!],$c:Int,$o:Int){
  mods(filter:$f, sort:$s, count:$c, offset:$o){
    nodes{ ${MOD_LIST_FIELDS} }
    totalCount
  }
}`;

// Map a caller-facing sort key onto the GraphQL sort field + a sensible default
// direction. Unknown keys fall back to endorsements.
const SORT_MAP = {
    endorsements: ['endorsements', 'DESC'],
    downloads:    ['downloads',    'DESC'],
    updated:      ['updatedAt',    'DESC'],
    added:        ['createdAt',    'DESC'],
    name:         ['name',         'ASC'],
    size:         ['size',         'DESC'],
    relevance:    ['relevance',    'DESC'],
};
export function buildSort(sort) {
    const [field, direction] = SORT_MAP[sort] ?? SORT_MAP.endorsements;
    return [{ [field]: { direction } }];
}

// Execute the mods query with an arbitrary filter/sort/paging.
async function queryMods({ filter, sort, count, offset = 0 }, fetchFn = fetch) {
    const body = { query: MODS_QUERY, variables: { f: filter, s: sort, c: count, o: offset } };
    const res = await fetchFn(NEXUS_GRAPHQL, {
        method:  'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body:    JSON.stringify(body),
    });
    readRateLimit(res, 'mods');
    if (!res.ok) throw new Error(`Nexus GraphQL failed: ${res.status}`);
    const json = await res.json();
    if (json.errors?.length) {
        throw new Error(`Nexus GraphQL errors: ${json.errors.map(e => e.message).join('; ')}`);
    }
    const mods = json.data?.mods ?? { nodes: [], totalCount: 0 };
    return { nodes: mods.nodes ?? [], totalCount: mods.totalCount ?? 0 };
}

// Section: top mods by endorsement for a game.
async function fetchMods(domainName, count = MOD_COUNT, fetchFn = fetch) {
    return queryMods({
        filter: { gameDomainName: { value: domainName, op: 'EQUALS' } },
        sort:   buildSort('endorsements'),
        count,
    }, fetchFn);
}

// Full page: one paginated / sorted / searched page of a game's mods.
async function fetchModsPage(domainName, { sort = 'endorsements', offset = 0, limit = 24, q = '', adult = 'all' } = {}, fetchFn = fetch) {
    const filter = { gameDomainName: { value: domainName, op: 'EQUALS' } };
    if (q) filter.name = { value: q, op: 'WILDCARD' };
    // 3-state adult filter: 'hide' excludes 18+, 'only' shows just 18+, 'all' (default) includes both.
    if (adult === 'hide')      filter.adultContent = { value: false, op: 'EQUALS' };
    else if (adult === 'only') filter.adultContent = { value: true,  op: 'EQUALS' };
    // Relevance ordering only makes sense with a search term; otherwise it degenerates.
    const effectiveSort = (q && sort === 'endorsements') ? 'relevance' : sort;
    return queryMods({ filter, sort: buildSort(effectiveSort), count: limit, offset }, fetchFn);
}

// Enumerate a game's adult mod ids, most-endorsed first, up to `cap` (the image backfill
// bounds each game so an outlier like Skyrim — 18k+ adult mods — doesn't run for days).
export async function listAdultModIds(domainName, { cap = Infinity, fetchFn = fetch } = {}) {
    const ids = [];
    const PAGE = 80;
    let offset = 0;
    while (ids.length < cap) {
        const { nodes } = await queryMods({
            filter: {
                gameDomainName: { value: domainName, op: 'EQUALS' },
                adultContent:   { value: true, op: 'EQUALS' },
            },
            sort: buildSort('endorsements'), count: PAGE, offset,
        }, fetchFn);
        if (!nodes.length) break;
        for (const n of nodes) ids.push(n.modId);
        if (nodes.length < PAGE) break;
        offset += PAGE;
        await sleep(200);
    }
    const unique = [...new Set(ids)];
    return Number.isFinite(cap) ? unique.slice(0, cap) : unique;
}

// Rich single-mod detail for the local mod page.
const MOD_DETAIL_QUERY = `query($f:ModsFilter){
  mods(filter:$f, count:1){
    nodes{
      modId gameId name summary description version author fileSize
      downloads endorsements adult status supportsVortex directDownloadEnabled
      createdAt updatedAt
      pictureUrl thumbnailUrl thumbnailLargeUrl
      modCategory{ name }
      uploader{ name avatar memberId }
      tags{ name }
    }
  }
}`;

// Nexus requires gameId (not domain) when filtering by modId.
async function fetchModDetail(gameId, modId, fetchFn = fetch) {
    const body = {
        query: MOD_DETAIL_QUERY,
        variables: { f: { gameId: { value: String(gameId), op: 'EQUALS' }, modId: { value: String(modId), op: 'EQUALS' } } },
    };
    const res = await fetchFn(NEXUS_GRAPHQL, {
        method:  'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body:    JSON.stringify(body),
    });
    readRateLimit(res, 'mod-detail');
    if (!res.ok) throw new Error(`Nexus GraphQL failed: ${res.status}`);
    const json = await res.json();
    if (json.errors?.length) {
        throw new Error(`Nexus GraphQL errors: ${json.errors.map(e => e.message).join('; ')}`);
    }
    return json.data?.mods?.nodes?.[0] ?? null;
}

// ── Shape helpers (exported for testing) ─────────────────────────────────────

export function normalizeName(name) {
    return String(name ?? '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip diacritics
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');                        // drop all punctuation/space
}

export function modPageUrl(domainName, modId) {
    return `${SITE_BASE}/${domainName}/mods/${modId}`;
}

export function shapeMod(node, domainName) {
    return {
        modId:          node.modId,
        name:           node.name,
        summary:        node.summary ?? null,
        version:        node.version ?? null,
        author:         node.author ?? null,
        uploaderName:   node.uploader?.name ?? null,
        uploaderAvatar: node.uploader?.avatar ?? null,
        fileSize:       node.fileSize ?? null,        // KB
        imageUrl:       node.pictureUrl ?? null,       // Nexus CDN (fallback)
        imageLargeUrl:  node.thumbnailLargeUrl ?? null,
        thumbUrl:       node.thumbnailUrl ?? null,     // Nexus CDN (fallback)
        localImage:     null,                          // filled by cacheModImages()
        localThumb:     null,                          // filled by cacheModImages()
        downloads:      node.downloads ?? 0,
        endorsements:   node.endorsements ?? 0,
        adult:          node.adult ?? false,
        category:       node.category ?? null,
        tags:           (node.tags ?? []).map(t => t.name).filter(Boolean),
        createdAt:      node.createdAt ?? null,
        updatedAt:      node.updatedAt ?? null,
        url:            modPageUrl(domainName, node.modId),
    };
}

// Rich shape for the single-mod page.
export function shapeModDetail(node, domainName) {
    return {
        modId:               node.modId,
        gameId:              node.gameId ?? null,
        name:                node.name,
        summary:             node.summary ?? null,
        description:         node.description ?? null,   // long-form (BBCode/HTML)
        version:             node.version ?? null,
        author:              node.author ?? null,
        fileSize:            node.fileSize ?? null,       // KB
        downloads:           node.downloads ?? 0,
        endorsements:        node.endorsements ?? 0,
        adult:               node.adult ?? false,
        status:              node.status ?? null,
        supportsVortex:      node.supportsVortex ?? false,
        directDownloadEnabled: node.directDownloadEnabled ?? false,
        category:            node.modCategory?.name ?? node.category ?? null,
        uploaderName:        node.uploader?.name ?? null,
        uploaderAvatar:      node.uploader?.avatar ?? null,
        uploaderId:          node.uploader?.memberId ?? null,
        tags:                (node.tags ?? []).map(t => t.name).filter(Boolean),
        imageUrl:            node.pictureUrl ?? null,
        imageLargeUrl:       node.thumbnailLargeUrl ?? null,
        thumbUrl:            node.thumbnailUrl ?? null,
        localImage:          null,   // hero image, filled by getModDetail()
        createdAt:           node.createdAt ?? null,
        updatedAt:           node.updatedAt ?? null,
        url:                 modPageUrl(domainName, node.modId),
    };
}

// ── Image mirroring ────────────────────────────────────────────────────────────
// Same request→cache routine the relay uses for Reddit/Steam images: download the
// original to $DATA_DIR/relay/nexus/images/<appid>/, store a web path on the mod,
// and let serveWithWebp() lazily produce a WebP sidecar on first request. The
// browser then loads /relay/images/nexus/... instead of hot-linking Nexus.

// Derive a safe extension from a URL, defaulting to .jpg (mirrors reddit.service).
function imageExt(url) {
    try {
        const m = new URL(url).pathname.match(/\.(jpe?g|png|gif|webp)$/i);
        return m ? `.${m[1].toLowerCase()}` : '.jpg';
    } catch { return '.jpg'; }
}

export function localImageUrl(appid, modId, url) { return `/images/nexus/${appid}/${modId}${imageExt(url)}`; }
export function localThumbUrl(appid, modId, url) { return `/images/nexus/${appid}/${modId}_thumb${imageExt(url)}`; }

// Download and cache a file. Returns true on success (mirrors reddit._cacheFile).
// Uses plain fetch — staticdelivery.nexusmods.com is a public CDN, no fingerprinting.
async function cacheFile(dest, url, fetchFn = fetch) {
    try {
        const res = await fetchFn(url);
        if (!res.ok) { logger.debug('[nexus] image fetch failed', { status: res.status }); return false; }
        const buf = Buffer.from(await res.arrayBuffer());
        await fs.writeFile(dest, buf);
        recordWrite(buf.length, dest); // NAS mod image (see activity.js)
        return true;
    } catch (err) {
        logger.warn('[nexus] image cache error', { err: err.message });
        return false;
    }
}

// Cache one mod image (thumb or full). Nexus embeds a timestamp in the URL, so a
// changed URL means a new image: we drop the stale original AND its webp sidecar
// so both regenerate. Returns the web path, or null on failure.
async function cacheModImage(appid, modId, url, { thumb, prevUrl = null, fetchFn = fetch } = {}) {
    if (!url) return null;
    await fs.mkdir(imagesDir(appid), { recursive: true });
    const fname    = thumb ? `${modId}_thumb${imageExt(url)}` : `${modId}${imageExt(url)}`;
    const dest     = path.join(imagesDir(appid), fname);
    const localUrl = thumb ? localThumbUrl(appid, modId, url) : localImageUrl(appid, modId, url);

    const changed = Boolean(prevUrl) && prevUrl !== url;
    let exists = false;
    try { await fs.access(dest); exists = true; } catch { /* not cached */ }

    if (exists && !changed) return localUrl;   // already have the current image
    if (changed) {
        await fs.rm(dest, { force: true }).catch(() => {});
        await fs.rm(path.join(imagesDir(appid), fname.replace(/\.[^.]+$/, '.webp')), { force: true }).catch(() => {});
    }
    const ok = await cacheFile(dest, url, fetchFn);
    return ok ? localUrl : null;
}

// Mirror thumbnails + full images for every mod in an entry, mutating each mod
// with localThumb/localImage. prevMods (from the existing entry) lets us re-pull
// only images whose upstream URL changed. Bounded concurrency; failures are
// non-fatal (the CDN url remains as a fallback).
async function cacheModImages(appid, mods, prevMods = [], fetchFn = fetch) {
    const prevById = new Map(prevMods.map(m => [m.modId, m]));
    await mapChunked(mods, async (mod) => {
        const prev = prevById.get(mod.modId);
        mod.localThumb = await cacheModImage(appid, mod.modId, mod.thumbUrl,
            { thumb: true,  prevUrl: prev?.thumbUrl, fetchFn }).catch(() => null);
        mod.localImage = await cacheModImage(appid, mod.modId, mod.imageUrl,
            { thumb: false, prevUrl: prev?.imageUrl, fetchFn }).catch(() => null);
    });
}

// ── Steam → Nexus game resolution ─────────────────────────────────────────────
// Nexus has no Steam appid in its data, so we match by name. Order:
//   1. overrides.json  (authoritative manual map: { "<appid>": "<domain_name>" })
//   2. exact normalized-name match against the games list
//   3. unique substring match (either direction) — bails if ambiguous, because a
//      wrong game is worse than none (e.g. "Skyrim" vs "Skyrim Special Edition")
// Returns { domainName, gameId, nexusName } or all-null when unmatched.

async function loadOverrides() {
    try { return JSON.parse(await fs.readFile(overridesPath(), 'utf8')); }
    catch { return {}; }
}

async function saveOverride(appid, domainName) {
    const overrides = await loadOverrides();
    overrides[String(appid)] = domainName;
    await fs.mkdir(nexusDir(), { recursive: true });
    await fs.writeFile(overridesPath(), JSON.stringify(overrides, null, 2));
}

export function matchGame(steamName, games) {
    const target = normalizeName(steamName);
    if (!target) return null;

    // 1. exact match on the Nexus name or domain
    const exact = games.find(g => normalizeName(g.name) === target || normalizeName(g.domain_name) === target);
    if (exact) return { domainName: exact.domain_name, gameId: exact.id, nexusName: exact.name };

    // 2. Nexus name contained in the (often franchise-prefixed) Steam title, e.g.
    //    "The Elder Scrolls V: Skyrim Special Edition" ⊇ "Skyrim Special Edition".
    //    Pick the MOST SPECIFIC — the longest such name — so "Skyrim Special
    //    Edition" wins over the shorter "Skyrim". We only match this direction
    //    (nexus ⊆ steam); the reverse would wrongly map base games to editions.
    let best = null, bestLen = 0, contested = false;
    for (const g of games) {
        const n = normalizeName(g.name);
        if (n.length < 5 || !target.includes(n)) continue;
        if (n.length > bestLen) { best = g; bestLen = n.length; contested = false; }
        else if (n.length === bestLen && g.id !== best?.id) { contested = true; }
    }
    // A genuine tie between two different games at the same length is ambiguous —
    // prefer no result over a wrong one; the override file resolves those.
    if (best && !contested) return { domainName: best.domain_name, gameId: best.id, nexusName: best.name };
    return null;
}

async function resolveGame(appid, steamName, { domain = null, fetchFn = fetch } = {}) {
    if (domain) {
        const games = await getGamesList({ fetchFn }).catch(() => []);
        const g = games.find(x => x.domain_name === domain);
        return { domainName: domain, gameId: g?.id ?? null, nexusName: g?.name ?? steamName };
    }
    const overrides = await loadOverrides();
    const override  = overrides[String(appid)];
    if (override) {
        const games = await getGamesList({ fetchFn }).catch(() => []);
        const g = games.find(x => x.domain_name === override);
        return { domainName: override, gameId: g?.id ?? null, nexusName: g?.name ?? steamName };
    }
    const games = await getGamesList({ fetchFn });
    return matchGame(steamName, games) ?? { domainName: null, gameId: null, nexusName: null };
}

// Resolve a game's Nexus domain, preferring the already-cached section entry
// (the full-page/mod-page are reached from the section, so it exists). Falls back
// to a fresh name resolution when uncached. Returns null when unmatched.
async function resolveDomainForApp(appid, name = null, fetchFn = fetch) {
    const entry = await getEntry(appid);
    if (entry && 'domainName' in entry) {
        return entry.domainName
            ? { domainName: entry.domainName, gameId: entry.gameId ?? null, nexusName: entry.nexusName ?? null }
            : null;
    }
    const { domainName, gameId, nexusName } = await resolveGame(appid, name, { fetchFn });
    return domainName ? { domainName, gameId, nexusName } : null;
}

// ── Full-page pagination / search ───────────────────────────────────────────────
// Live paginated/sorted/searched mods for a game — powers the local full mods page's
// infinite scroll. Images are NOT mirrored here (potentially hundreds); the frontend
// hot-links the Nexus CDN thumbnail, using the mirrored copy when one exists.
export async function getModsPage(appid, { sort = 'endorsements', offset = 0, limit = 24, q = '', adult = 'all', name = null, fetchFn = fetch } = {}) {
    appid  = Number(appid);
    offset = Math.max(0, Number(offset) || 0);
    limit  = Math.min(50, Math.max(1, Number(limit) || 24));
    if (!['hide', 'all', 'only'].includes(adult)) adult = 'all';

    const game = await resolveDomainForApp(appid, name, fetchFn);
    if (!game) return { appid, domainName: null, nexusName: null, sort, q, offset, limit, totalCount: 0, mods: [] };

    const { nodes, totalCount } = await fetchModsPage(game.domainName, { sort, offset, limit, q, adult }, fetchFn);
    return {
        appid,
        domainName: game.domainName,
        nexusName:  game.nexusName,
        gameUrl:    `${SITE_BASE}/${game.domainName}`,
        sort, q, offset, limit, adult,
        totalCount,
        mods: nodes.map(n => shapeMod(n, game.domainName)),
    };
}

// ── Deep pull ────────────────────────────────────────────────────────────────────
// Crawl a game's ENTIRE mod catalogue (up to a cap) into a local cache so the mods
// page can search/sort/filter the full set client-side. Adult content is included
// (no adultContent filter). Thumbnails are mirrored per mod. The crawl runs in the
// background, writing progress so the frontend can stream records + a live count.
const DEEP_CAP        = parseInt(process.env.NEXUS_DEEP_CAP ?? '5000', 10);
const DEEP_PAGE       = 80;    // Nexus clamps `count` to 80
const DEEP_PAGE_DELAY = 250;   // polite gap between pages (ms)
const DEEP_FLUSH_EVERY = 5;    // persist progress every N pages

function deepDir()       { return path.join(nexusDir(), 'deep'); }
function deepPath(appid) { return path.join(deepDir(), `${appid}.json`); }

const _deepMem     = new Map();   // appid -> dataset (write-through, for GET polls)
const _deepRunning = new Set();   // appids with an active crawl

export async function getDeep(appid) {
    appid = Number(appid);
    if (_deepMem.has(appid)) return _deepMem.get(appid);
    try {
        const d = JSON.parse(await fs.readFile(deepPath(appid), 'utf8'));
        _deepMem.set(appid, d);
        return d;
    } catch { return null; }
}

async function writeDeep(appid, data) {
    _deepMem.set(appid, data);
    await fs.mkdir(deepDir(), { recursive: true });
    await fs.writeFile(deepPath(appid), JSON.stringify(data)).catch(err =>
        logger.warn('[nexus] deep write failed', { appid, err: err.message }));
}

// Kick off (or return the status of) a deep pull. Non-blocking: the crawl runs in
// the background and updates the cached dataset as it goes.
export async function startDeepPull(appid, { force = false, name = null, fetchFn = fetch } = {}) {
    appid = Number(appid);
    if (_deepRunning.has(appid)) return { status: 'running' };

    const existing = await getDeep(appid);
    const freshFor = syncIntervalHours() * 3_600_000;
    if (!force && existing?.status === 'done' && existing.updatedAt &&
        (Date.now() - new Date(existing.updatedAt).getTime()) < freshFor) {
        return { status: 'done', pulled: existing.pulled, total: existing.total, capped: existing.capped };
    }

    const game = await resolveDomainForApp(appid, name, fetchFn);
    if (!game) {
        await writeDeep(appid, { appid, domainName: null, status: 'done', total: 0, pulled: 0, capped: false, cap: DEEP_CAP, mods: [], updatedAt: new Date().toISOString() });
        return { status: 'done', total: 0 };
    }

    _deepRunning.add(appid);
    _crawlDeep(appid, game, fetchFn)
        .catch(err => logger.error('[nexus] deep crawl failed', { appid, err: err.message }))
        .finally(() => _deepRunning.delete(appid));
    return { status: 'running' };
}

async function _crawlDeep(appid, game, fetchFn = fetch) {
    const base = {
        appid, domainName: game.domainName, nexusName: game.nexusName,
        gameUrl: `${SITE_BASE}/${game.domainName}`, cap: DEEP_CAP,
        startedAt: new Date().toISOString(),
    };
    const seen = new Set();
    let mods = [], total = 0, offset = 0, page = 0;

    try {
        while (mods.length < DEEP_CAP) {
            const { nodes, totalCount } = await queryMods({
                filter: { gameDomainName: { value: game.domainName, op: 'EQUALS' } }, // no adult filter → include all
                sort:   buildSort('endorsements'),
                count:  DEEP_PAGE,
                offset,
            }, fetchFn);
            total = totalCount;
            if (!nodes.length) break;

            const fresh = nodes.map(n => shapeMod(n, game.domainName)).filter(m => !seen.has(m.modId));
            fresh.forEach(m => seen.add(m.modId));
            // Mirror thumbnails for this page (bounded concurrency); failures keep the CDN url.
            await mapChunked(fresh, async (m) => {
                m.localThumb = await cacheModImage(appid, m.modId, m.thumbUrl, { thumb: true, fetchFn }).catch(() => null);
            });
            mods = mods.concat(fresh);
            offset += DEEP_PAGE;
            page++;

            const snap = { ...base, total, pulled: mods.length, capped: false, status: 'running', updatedAt: new Date().toISOString(), mods };
            _deepMem.set(appid, snap);                              // memory every page → GET polls stay live
            if (page % DEEP_FLUSH_EVERY === 0) await writeDeep(appid, snap);   // throttle disk writes
            if (nodes.length < DEEP_PAGE) break;   // reached the end of the catalogue
            await sleep(DEEP_PAGE_DELAY);
        }

        mods = mods.slice(0, DEEP_CAP);
        const capped = mods.length >= DEEP_CAP && mods.length < total;
        await writeDeep(appid, { ...base, total, pulled: mods.length, capped, status: 'done', updatedAt: new Date().toISOString(), mods });
        logger.info('[nexus] deep crawl complete', { appid, pulled: mods.length, total, capped });
    } catch (err) {
        await writeDeep(appid, { ...base, total, pulled: mods.length, capped: false, status: 'error', error: err.message, updatedAt: new Date().toISOString(), mods });
        throw err;
    }
}

// ── Single-mod detail ────────────────────────────────────────────────────────────
function modsDir(appid)          { return path.join(nexusDir(), 'mods', String(appid)); }
function modDetailPath(appid, m) { return path.join(modsDir(appid), `${m}.json`); }

export async function getCachedModDetail(appid, modId) {
    appid = Number(appid); modId = Number(modId);
    const key = `${appid}:${modId}`;
    const hit = memGet(_detailMem, key);
    if (hit) return hit.value;
    let value = null;
    try { value = JSON.parse(await fs.readFile(modDetailPath(appid, modId), 'utf8')); }
    catch { value = null; }
    memSet(_detailMem, key, value);
    return value;
}

// ── Mod screenshot gallery ───────────────────────────────────────────────────────
// Nexus has no per-mod media query, but mods embed their screenshots in the
// description as images. We lift those out into a mirrored gallery (shown as a grid
// + lightbox on the mod page) and leave the description as text/lists/headings.
function imgHash(url) { return crypto.createHash('md5').update(String(url)).digest('hex').slice(0, 12); }

async function cacheGalleryImage(appid, url, fetchFn = fetch) {
    if (!url) return null;
    await fs.mkdir(imagesDir(appid), { recursive: true });
    const name = `g_${imgHash(url)}${imageExt(url)}`;
    const dest = path.join(imagesDir(appid), name);
    const local = `/images/nexus/${appid}/${name}`;
    try { await fs.access(dest); return local; } catch { /* fetch below */ }
    return (await cacheFile(dest, url, fetchFn)) ? local : null;
}

// Nexus has no per-mod media query, so we take the mod's own uploaded media — images
// hosted on staticdelivery.nexusmods.com — out of the description into the gallery.
// External images (imgur/afkmods banners authors sprinkle in) stay inline in the text.
function splitGallery(blocks, heroUrl) {
    const seen = new Set(heroUrl ? [heroUrl] : []);
    const text = [], gallery = [];
    for (const b of blocks) {
        if (b.type === 'image' && b.src && /staticdelivery\.nexusmods\.com/i.test(b.src) && !seen.has(b.src)) {
            seen.add(b.src); gallery.push(b.src);
        } else {
            text.push(b);
        }
    }
    return { text, gallery };
}

// Structured description (images removed) + a mirrored screenshot gallery.
async function buildDescription(appid, bbcode, heroUrl, fetchFn = fetch) {
    const { text, gallery } = splitGallery(descriptionToBlocks(bbcode), heroUrl);
    const shots = await mapChunked(gallery, async (url) => ({
        url, localUrl: await cacheGalleryImage(appid, url, fetchFn).catch(() => null),
    }));
    return { descriptionBlocks: text, gallery: shots };
}

// Background enrichment: scrape the mod's Author-images tab (not in the API) and merge
// the full-size images into the cached gallery. Runs at most once per mod (guarded),
// gentle + serialized by the scraper. Author images go FIRST — they're the real gallery.
const _scrapingImages = new Set();
async function enrichAuthorImages(appid, modId, domainName) {
    if (!domainName || process.env.NEXUS_SCRAPE_AUTHOR_IMAGES === 'false') return { skipped: true };
    const key = `${appid}:${modId}`;
    if (_scrapingImages.has(key)) return { skipped: true };
    _scrapingImages.add(key);
    try {
        const { ok, urls, gated } = await scrapeAuthorImages(domainName, modId);
        const detail = await getCachedModDetail(appid, modId);
        if (!detail) return { skipped: true, gated };
        let added = 0;
        if (urls.length) {
            // Author images are the real gallery — include the hero too (header is a
            // separate "featured" view). Dedupe against whatever's already there.
            const have    = new Set((detail.gallery || []).map(g => g.url));
            const newUrls = urls.filter(u => u && !have.has(u));
            const shots   = await mapChunked(newUrls, async (url) => ({
                url, localUrl: await cacheGalleryImage(appid, url).catch(() => null),
            }));
            if (shots.length) { detail.gallery = [...shots, ...(detail.gallery || [])]; added = shots.length; }
        }
        detail.authorImagesTriedAt = new Date().toISOString();   // last attempt (for retry cooldown)
        if (ok) detail.authorImagesAt = detail.authorImagesTriedAt;   // only mark "done" on a real load
        await fs.writeFile(modDetailPath(appid, modId), JSON.stringify(detail, null, 2)).catch(() => {});
        memSet(_detailMem, key, detail);
        logger.info('[nexus] author-image enrich', { appid, modId, ok, gated, added });
        return { ok, gated, added };
    } catch (err) {
        logger.warn('[nexus] author-image enrich failed', { appid, modId, err: err.message });
        return { ok: false, gated: false, added: 0, error: err.message };
    } finally {
        _scrapingImages.delete(key);
    }
}

// Backfill entry point: ensure the mod detail is cached (without kicking a competing
// background scrape), then scrape its author-images tab and report the outcome so the
// job can count progress and pause when the session dies. Returns { ok, gated, added,
// skipped } — skipped:true when already done or no domain.
export async function backfillAuthorImages(appid, modId, { name = null, domainName = null } = {}) {
    appid = Number(appid); modId = Number(modId);
    const detail = await getModDetail(appid, modId, { name, enrich: false });
    if (!detail) return { skipped: true };
    if (detail.authorImagesAt) return { skipped: true, ok: true, added: 0 };
    // shapeModDetail doesn't carry domainName — take it from the caller (backfill queue)
    // or resolve it from the game.
    let domain = domainName;
    if (!domain) { const game = await resolveDomainForApp(appid, name); domain = game?.domainName; }
    if (!domain) return { skipped: true };
    return enrichAuthorImages(appid, modId, domain);
}

// Fetch (or return cached) rich detail for one mod, mirroring its hero image + gallery.
export async function getModDetail(appid, modId, { force = false, name = null, enrich = true, fetchFn = fetch } = {}) {
    appid = Number(appid); modId = Number(modId);

    const cached = await getCachedModDetail(appid, modId);
    const freshFor = syncIntervalHours() * 3_600_000;
    if (!force && cached?.fetchedAt && (Date.now() - new Date(cached.fetchedAt).getTime()) < freshFor) {
        // Self-heal caches written before descriptionBlocks/gallery existed: rebuild from the
        // stored description so old entries render (+ mirror the gallery) without a refetch.
        if (cached.description && (!cached.descriptionBlocks?.length || cached.gallery === undefined)) {
            const built = await buildDescription(appid, cached.description, cached.imageUrl);
            cached.descriptionBlocks = built.descriptionBlocks;
            cached.gallery = built.gallery;
            await fs.writeFile(modDetailPath(appid, modId), JSON.stringify(cached, null, 2)).catch(() => {});
            memSet(_detailMem, `${appid}:${modId}`, cached);
        }
        // Scrape the author-images tab (background) for caches that haven't succeeded yet.
        // Retry failed attempts, but no more than once every 30s per mod (gentle).
        const triedRecently = cached.authorImagesTriedAt &&
            (Date.now() - new Date(cached.authorImagesTriedAt).getTime()) < 30_000;
        // Adult mods are gated behind the login and handled only by the authenticated
        // Settings backfill — never the ad-hoc on-demand scrape (which would just hammer
        // the login wall). Regular mods still enrich on view.
        if (enrich && !cached.adult && cached.domainName && !cached.authorImagesAt && !triedRecently) {
            enrichAuthorImages(appid, modId, cached.domainName);
        }
        return cached;
    }

    const game = await resolveDomainForApp(appid, name, fetchFn);
    if (!game?.gameId) return cached ?? null;

    const node = await fetchModDetail(game.gameId, modId, fetchFn);
    if (!node) return cached;   // keep any stale copy rather than lose it

    const detail = shapeModDetail(node, game.domainName);
    // Structured description (text/lists/headings) + a mirrored screenshot gallery.
    const built = await buildDescription(appid, detail.description, detail.imageUrl, fetchFn);
    detail.descriptionBlocks = built.descriptionBlocks;
    detail.gallery = built.gallery;
    // Mirror the hero image (full-size); reuses the section's <modId>.<ext> file.
    detail.localImage = await cacheModImage(appid, modId, detail.imageUrl,
        { thumb: false, prevUrl: cached?.imageUrl, fetchFn }).catch(() => null);
    detail.appid     = appid;
    detail.fetchedAt = new Date().toISOString();

    await fs.mkdir(modsDir(appid), { recursive: true });
    await fs.writeFile(modDetailPath(appid, modId), JSON.stringify(detail, null, 2));
    memSet(_detailMem, `${appid}:${modId}`, detail);   // write-through
    // Enrich with the author-images tab in the background (scrape) — page paints now.
    // Adult mods are left to the authenticated backfill; on-demand only scrapes regular mods.
    if (enrich && !detail.adult) enrichAuthorImages(appid, modId, game.domainName);
    return detail;
}

// ── File I/O ──────────────────────────────────────────────────────────────────

export async function getEntry(appid) {
    appid = Number(appid);
    const hit = memGet(_entryMem, appid);
    if (hit) return hit.value;
    let value = null;
    try { value = JSON.parse(await fs.readFile(entryPath(appid), 'utf8')); }
    catch { value = null; }
    memSet(_entryMem, appid, value);
    return value;
}

export async function getIndex() {
    try { return JSON.parse(await fs.readFile(indexPath(), 'utf8')); }
    catch { return []; }
}

async function rebuildIndex() {
    let files;
    try { files = await fs.readdir(nexusDir()); } catch { return []; }

    const eligible = files.filter(f => f.endsWith('.json') &&
        !['index.json', 'games.json', 'overrides.json'].includes(f));
    const raws = await mapChunked(eligible, f => fs.readFile(path.join(nexusDir(), f), 'utf8').catch(() => null));

    const index = [];
    for (const raw of raws) {
        if (!raw) continue;
        try {
            const entry = JSON.parse(raw);
            index.push({
                appid:      entry.appid,
                steamName:  entry.steamName,
                domainName: entry.domainName,
                nexusName:  entry.nexusName ?? null,
                totalMods:  entry.totalMods ?? 0,
                modCount:   entry.mods?.length ?? 0,
                fetchedAt:  entry.fetchedAt,
            });
        } catch { /* skip malformed */ }
    }
    await fs.writeFile(indexPath(), JSON.stringify(index, null, 2));
    return index;
}

// ── Core sync ──────────────────────────────────────────────────────────────────

// Fetch (or refresh) one game's mods and persist the entry. When the game can't
// be matched to Nexus, a sentinel (domainName: null, mods: []) is written so the
// section renders "no mods" instantly and we don't re-resolve on every view.
export async function syncOne(appid, steamName, { force = false, domain = null, fetchFn = fetch } = {}) {
    appid = Number(appid);
    await fs.mkdir(nexusDir(), { recursive: true });

    const existing = await getEntry(appid);
    const freshFor = syncIntervalHours() * 3_600_000;
    if (!force && !domain && existing?.fetchedAt &&
        (Date.now() - new Date(existing.fetchedAt).getTime()) < freshFor) {
        return { skipped: 1, total: 1, entry: existing };
    }

    const name = steamName ?? existing?.steamName ?? null;
    const { domainName, gameId, nexusName } = await resolveGame(appid, name, { domain, fetchFn });
    if (domain) await saveOverride(appid, domain);

    if (!domainName) {
        const sentinel = {
            appid, steamName: name, domainName: null, gameId: null, nexusName: null,
            gameUrl: null, totalMods: 0, fetchedAt: new Date().toISOString(), mods: [],
        };
        await fs.writeFile(entryPath(appid), JSON.stringify(sentinel, null, 2));
        memSet(_entryMem, appid, sentinel);
        await rebuildIndex();
        logger.info('[nexus] No Nexus match — sentinel written', { appid, name });
        return { skipped: 1, total: 1, entry: sentinel };
    }

    const { nodes, totalCount } = await fetchMods(domainName, MOD_COUNT, fetchFn);
    const entry = {
        appid,
        steamName:  name,
        domainName,
        gameId,
        nexusName,
        gameUrl:    `${SITE_BASE}/${domainName}`,
        totalMods:  totalCount,
        fetchedAt:  new Date().toISOString(),
        mods:       nodes.map(n => shapeMod(n, domainName)),
    };

    // Write the entry FIRST (with CDN image URLs) so the game page's poll gets data
    // within a couple of seconds and renders the section without a refresh — the
    // browser hot-links the Nexus CDN until the local mirror lands. Then mirror the
    // images (mutating localThumb/localImage) and re-persist.
    await fs.writeFile(entryPath(appid), JSON.stringify(entry, null, 2));
    memSet(_entryMem, appid, entry);   // write-through so queries skip the NAS
    await rebuildIndex();

    await cacheModImages(appid, entry.mods, existing?.mods ?? [], fetchFn);
    await fs.writeFile(entryPath(appid), JSON.stringify(entry, null, 2));

    const created = existing ? 0 : 1;
    logger.info('[nexus] Synced', { appid, domainName, mods: entry.mods.length, totalMods: totalCount });
    return { fetched: 1, created, updated: existing ? 1 : 0, total: 1, entry };
}

// Polite refresh: only re-fetch games that are ALREADY cached (i.e. the operator
// has actually viewed) and whose entry is past its TTL. We never proactively pull
// the whole library from Nexus.
export async function refreshStale({ force = false, fetchFn = fetch } = {}) {
    let files;
    try { files = await fs.readdir(nexusDir()); } catch { return { fetched: 0, skipped: 0, total: 0 }; }

    const appids = files
        .filter(f => f.endsWith('.json') && !['index.json', 'games.json', 'overrides.json'].includes(f))
        .map(f => parseInt(f, 10))
        .filter(Number.isFinite);

    const freshFor = syncIntervalHours() * 3_600_000;
    let fetched = 0, skipped = 0, first = true;

    for (const appid of appids) {
        const entry = await getEntry(appid);
        const stale = force || !entry?.fetchedAt ||
            (Date.now() - new Date(entry.fetchedAt).getTime()) >= freshFor;
        if (!stale) { skipped++; continue; }

        if (!first) await sleep(jitter(MIN_DELAY_MS, MAX_DELAY_MS));
        first = false;

        try {
            await syncOne(appid, entry?.steamName ?? null, { force: true, fetchFn });
            fetched++;
        } catch (err) {
            logger.warn('[nexus] Refresh failed', { appid, err: err.message });
            skipped++;
        }
    }
    logger.info('[nexus] Refresh complete', { fetched, skipped, total: appids.length });
    return { fetched, skipped, total: appids.length };
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

export function startNexusSyncScheduler() {
    const hours = syncIntervalHours();
    logger.info('[nexus] Sync scheduler started', { intervalHours: hours });
    setInterval(() => {
        tracked('nexus', () => refreshStale()).catch(err => logger.error('[nexus] Scheduled refresh failed', err));
    }, hours * 3_600_000);
}
