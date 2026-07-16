// Ported verbatim from relay-server src/services/steam/upcoming.service.js
// (docs/relay-fold-in.md §6). Import rewrites only: cache-manager → shared,
// data paths via featureDir('steam').
import path from 'node:path';
import fs from 'node:fs/promises';
import logger from '../../logger.js';
import { register } from '../shared/cache-manager.js';
import { featureDir } from '../shared/data-root.js';

function steamDir() { return featureDir('steam'); }

async function readJson(p) {
    try { return JSON.parse(await fs.readFile(p, 'utf8')); }
    catch { return null; }
}

function parseReleaseDate(str) {
    if (!str) return null;
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
}

let _cache = null;

export async function build() {
    const t0 = Date.now();

    const [gamesData, wishlistData] = await Promise.all([
        readJson(path.join(steamDir(), 'games.json')),
        readJson(path.join(steamDir(), 'wishlist.json')),
    ]);

    const libraryIds  = new Set((gamesData?.games ?? []).map(g => g.appid));
    const wishlistIds = new Set(Object.keys(wishlistData?.items ?? {}).map(Number));
    const allIds      = [...new Set([...libraryIds, ...wishlistIds])];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const storeDir = path.join(steamDir(), 'store');

    const results = (
        await Promise.all(
            allIds.map(async (appid) => {
                const detail = await readJson(path.join(storeDir, `${appid}.json`));
                if (!detail?.release_date) return null;

                const { coming_soon, date: dateStr } = detail.release_date;
                const releaseDate = parseReleaseDate(dateStr);
                if (!releaseDate && !coming_soon) return null;

                return {
                    appid,
                    name:           detail.name ?? `App ${appid}`,
                    releaseDate:    dateStr ?? null,
                    releaseDateIso: releaseDate ? releaseDate.toISOString().slice(0, 10) : null,
                    comingSoon:     coming_soon === true,
                    owned:          libraryIds.has(appid),
                    wishlisted:     wishlistIds.has(appid),
                };
            })
        )
    ).filter(Boolean);

    results.sort((a, b) => {
        const da = a.releaseDateIso ? new Date(a.releaseDateIso) : Infinity;
        const db = b.releaseDateIso ? new Date(b.releaseDateIso) : Infinity;
        return da - db;
    });

    const upcoming = results.filter(r => r.comingSoon || (r.releaseDateIso && r.releaseDateIso >= today.toISOString().slice(0, 10)));

    _cache = { upcoming, releases: results };
    logger.info('[upcoming] Cache built', { total: results.length, upcoming: upcoming.length, ms: Date.now() - t0 });
}

export function get() {
    return _cache ?? { upcoming: [] };
}

export function getAll() {
    return _cache ?? { releases: [] };
}

register('upcoming', build);
