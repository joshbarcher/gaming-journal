// Ported verbatim from relay-server src/services/steam/adult-content.service.js
// (docs/relay-fold-in.md §6 — logic byte-identical; only imports + data-dir
// helpers rewritten). Data stays under $RELAY_DATA_ROOT/steam — same on-disk
// paths as the relay.
import path from 'node:path';
import fs from 'node:fs/promises';
import logger from '../../logger.js';
import { steamFetch } from '../shared/steam-fetch.js';
import { featureDir } from '../shared/data-root.js';
import { getAllAppids } from './applist.service.js';

const STORE_API = 'https://store.steampowered.com';

// Valve's official content_descriptors ids (Steamworks docs): 1 = Some Nudity or Sexual
// Content, 2 = Frequent Violence or Gore, 3 = Adult Only Sexual Content, 4 = Frequent
// Nudity or Sexual Content, 5 = General Mature Content. We only treat 3 as disqualifying —
// verified against real store data that this is precisely the line between e.g. Cyberpunk
// 2077 (ids [1,2,5], stays visible) and actual adult-only titles like Subverse/House Party
// (ids include 3). Widening to include 4 would start catching titles like NEKOPARA too.
const ADULT_DESCRIPTOR_IDS = new Set([3]);

const WRITE_EVERY = 200;

// Sustained crawling on this endpoint got the relay's IP 403'd by Steam after a
// few minutes at 1 req/s (confirmed live — took the anonymous appdetails endpoint
// down for every other feature using it too). Crawl slower, and back off hard the
// moment Steam starts blocking instead of hammering through it.
const BACKFILL_REQUESTS_PER_SEC = 0.3;
const BLOCK_THRESHOLD           = 3;
const BLOCK_COOLDOWN_MS         = 20 * 60 * 1_000;

// Shared across all callers (backfill loop and lazy per-request checks alike) — the
// instant any request sees a 403, skip the network entirely for a short window so
// live search/featured traffic doesn't keep re-hitting a block that's already active.
const SHORT_BLOCK_COOLDOWN_MS = 2 * 60 * 1_000;
let _blockedUntil = 0;

let _cache  = new Map(); // appid -> { ids: number[] | null, checkedAt: string }
let _loaded = false;
let _loadPromise = null;

function cachePath() {
    return path.join(featureDir('steam'), 'adult-appids.json');
}

async function load() {
    if (_loaded) return;
    if (!_loadPromise) {
        _loadPromise = (async () => {
            try {
                const raw = JSON.parse(await fs.readFile(cachePath(), 'utf8'));
                _cache = new Map(Object.entries(raw).map(([k, v]) => [Number(k), v]));
            } catch { /* first run — no cache yet */ }
            _loaded = true;
            logger.info('[adult-content] Cache loaded', { count: _cache.size });
        })();
    }
    await _loadPromise;
}

async function save() {
    const obj = Object.fromEntries(_cache);
    await fs.mkdir(path.dirname(cachePath()), { recursive: true });
    await fs.writeFile(cachePath(), JSON.stringify(obj));
}

function isAdultIds(ids) {
    return Array.isArray(ids) && ids.some(id => ADULT_DESCRIPTOR_IDS.has(id));
}

// Returns { ids, blocked }. `blocked` means Steam refused the request outright (403) —
// distinct from a normal "no data for this appid" response, so callers can avoid
// permanently caching a false negative caused by rate-limiting rather than reality.
async function fetchDescriptors(appid) {
    if (Date.now() < _blockedUntil) return { ids: null, blocked: true };

    try {
        const url = new URL(`${STORE_API}/api/appdetails`);
        url.searchParams.set('appids', appid);
        url.searchParams.set('filters', 'content_descriptors');
        const res  = await steamFetch(url.toString());
        const body = await res.json();
        const entry = body[String(appid)];
        return { ids: entry?.success ? (entry.data?.content_descriptors?.ids ?? []) : [], blocked: false };
    } catch (err) {
        const blocked = /Steam API 403/.test(err.message);
        if (blocked) _blockedUntil = Date.now() + SHORT_BLOCK_COOLDOWN_MS;
        logger.warn('[adult-content] Descriptor fetch failed', { appid, err: err.message, blocked });
        return { ids: null, blocked };
    }
}

// Cheap in-memory check — safe to call per discover/search result. Unknown appids
// fail open (return false) so nothing is hidden before it's actually been checked.
export async function isAdultAppid(appid) {
    await load();
    const entry = _cache.get(Number(appid));
    return entry ? isAdultIds(entry.ids) : false;
}

export async function isKnown(appid) {
    await load();
    return _cache.has(Number(appid));
}

export async function checkAppid(appid) {
    await load();
    const id = Number(appid);
    const { ids, blocked } = await fetchDescriptors(id);
    if (blocked) return false; // don't poison the cache — leave unknown for retry later
    _cache.set(id, { ids, checkedAt: new Date().toISOString() });
    await save();
    return isAdultIds(ids);
}

// Fire-and-forget: top up the cache for an appid seen in search/featured results that
// the full backfill hasn't reached yet. Never blocks the caller.
export function ensureChecked(appid) {
    load()
        .then(() => {
            if (!_cache.has(Number(appid))) return checkAppid(appid);
        })
        .catch(err => logger.warn('[adult-content] ensureChecked failed', { appid, err: err.message }));
}

// One-time (resumable) crawl of the full Steam catalog, tagging every appid with its
// content_descriptors. Steam's public appdetails endpoint is rate-limited, so this runs
// in the background at a conservative rate and can take days on first run — safe to
// interrupt and restart since already-checked appids are skipped. If Steam starts
// returning 403s (we've seen this happen), the crawl pauses for a long cooldown instead
// of continuing to hammer a block that's already in effect.
export async function backfillAll({ onProgress } = {}) {
    await load();
    const all = getAllAppids();
    const intervalMs = 1_000 / BACKFILL_REQUESTS_PER_SEC;

    logger.info('[adult-content] Starting backfill', { total: all.length, remaining: all.length - _cache.size });

    let done = 0;

    for (;;) {
        const todo = all.filter(id => !_cache.has(id));
        if (!todo.length) break;

        let consecutiveBlocks = 0;

        for (const appid of todo) {
            const start = Date.now();
            const { ids, blocked } = await fetchDescriptors(appid);

            if (blocked) {
                consecutiveBlocks++;
                if (consecutiveBlocks >= BLOCK_THRESHOLD) {
                    await save();
                    logger.warn('[adult-content] Steam appears to be blocking us — pausing backfill', {
                        cooldownMin: BLOCK_COOLDOWN_MS / 60_000,
                    });
                    consecutiveBlocks = 0;
                    await new Promise(r => setTimeout(r, BLOCK_COOLDOWN_MS));
                }
                continue; // not cached — retried on this or the next pass
            }
            consecutiveBlocks = 0;

            _cache.set(appid, { ids, checkedAt: new Date().toISOString() });
            done++;
            if (done % WRITE_EVERY === 0) await save();
            if (onProgress) onProgress(done, all.length);

            const wait = intervalMs - (Date.now() - start);
            if (wait > 0) await new Promise(r => setTimeout(r, wait));
        }

        await save();
        logger.info('[adult-content] Backfill pass complete', { checked: done, remaining: all.length - _cache.size });
    }

    logger.info('[adult-content] Backfill complete', { checked: done, total: all.length });
}

export async function getStats() {
    await load();
    let adult = 0;
    for (const entry of _cache.values()) if (isAdultIds(entry.ids)) adult++;
    return { checked: _cache.size, adult };
}
