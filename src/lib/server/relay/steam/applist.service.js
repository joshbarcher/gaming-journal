// Ported verbatim from relay-server src/services/steam/applist.service.js
// (docs/relay-fold-in.md §6 — logic byte-identical; only imports + data-dir
// helpers rewritten). Data stays under $RELAY_DATA_ROOT/steam — same on-disk
// paths as the relay.
import path from 'node:path';
import fs from 'node:fs/promises';
import logger from '../../logger.js';
import { featureDir } from '../shared/data-root.js';

const APPLIST_API     = 'https://api.steampowered.com/IStoreService/GetAppList/v1/';
const CACHE_MAX_AGE   = 7 * 24 * 60 * 60 * 1_000; // 7 days

// In-memory search index: [{ appid, name, _lower }]
let _index = [];
let _built = false;

function _cachePath() {
    return path.join(featureDir('steam'), 'applist.json');
}

const NOISE = [
    /soundtrack/i, /\bost\b/i, /\bdemo\b/i, /dedicated server/i,
    /\btrailer\b/i, /test app/i, /playtest/i, /\bbeta\b/i,
];

function _isNoise(name) {
    return NOISE.some(re => re.test(name));
}

async function _download() {
    const key = process.env.STEAM_API_KEY;
    if (!key) throw new Error('STEAM_API_KEY not set');

    const all = [];
    let lastAppid;

    for (;;) {
        const url = new URL(APPLIST_API);
        url.searchParams.set('key', key);
        url.searchParams.set('include_games', 'true');
        url.searchParams.set('include_dlc', 'false');
        url.searchParams.set('include_software', 'false');
        url.searchParams.set('include_videos', 'false');
        url.searchParams.set('include_hardware', 'false');
        url.searchParams.set('max_results', '50000');
        if (lastAppid !== undefined) url.searchParams.set('last_appid', String(lastAppid));

        const res = await fetch(url.toString());
        if (!res.ok) throw new Error(`GetAppList ${res.status} ${res.statusText}`);
        const body = await res.json();

        const response = body.response ?? {};
        const batch    = response.apps ?? [];
        all.push(...batch);
        logger.info('[applist] Batch downloaded', { batch: batch.length, total: all.length });

        if (!response.have_more_results) break;
        lastAppid = response.last_appid;
    }

    return all;
}

export async function buildApplist({ force = false } = {}) {
    const cachePath = _cachePath();
    let apps = null;

    if (!force) {
        try {
            const stat = await fs.stat(cachePath);
            if (Date.now() - stat.mtimeMs < CACHE_MAX_AGE) {
                apps = JSON.parse(await fs.readFile(cachePath, 'utf8'));
                logger.info('[applist] Loaded from disk', { count: apps.length });
            }
        } catch { /* cache miss */ }
    }

    if (!apps) {
        logger.info('[applist] Downloading from Steam API...');
        const downloaded = await _download();
        // A 200 with an empty/truncated app list is a known Steam hiccup — don't overwrite the good
        // ~100k-entry cache (and blank the search index) with it. Keep the existing file if present.
        if (!downloaded.length) {
            logger.warn('[applist] Download returned no apps — keeping existing cache');
            apps = JSON.parse(await fs.readFile(cachePath, 'utf8').catch(() => '[]'));
        } else {
            apps = downloaded;
            await fs.mkdir(path.dirname(cachePath), { recursive: true });
            await fs.writeFile(cachePath, JSON.stringify(apps));
            logger.info('[applist] Saved to disk', { count: apps.length });
        }
    }

    _index = apps
        .filter(a => a.name && !_isNoise(a.name))
        .map(a => ({ appid: a.appid, name: a.name, _lower: a.name.toLowerCase() }));
    _built = true;

    logger.info('[applist] Index ready', { total: apps.length, indexed: _index.length });
}

export function search(query, { limit = 50, offset = 0 } = {}) {
    if (!_built) return { results: [], total: 0, offset, limit };
    const q = query.toLowerCase().trim();
    if (!q)   return { results: [], total: 0, offset, limit };

    const startsWith = [];
    const contains   = [];

    for (const entry of _index) {
        if (entry._lower.startsWith(q)) {
            startsWith.push(entry);
        } else if (entry._lower.includes(q)) {
            contains.push(entry);
        }
    }

    startsWith.sort((a, b) => a.name.length - b.name.length);
    contains.sort((a, b) => a.name.length - b.name.length);

    const all = [...startsWith, ...contains];
    const results = all.slice(offset, offset + limit).map(({ appid, name }) => ({
        appid,
        name,
        // Akamai CDN: works for legacy titles. Newer games migrated to the Fastly CDN
        // (shared.fastly.steamstatic.com) which requires a per-asset content hash not
        // available in the GetAppList payload. The client falls back to the capsule image
        // then hides on error. See docs/steam-cdn.md for the full migration context.
        headerImage: `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`,
    }));

    return { results, total: all.length, offset, limit };
}

export function isReady() { return _built; }

export function getAllAppids() {
    return _index.map(e => e.appid);
}
