import path from 'node:path';
import fs from 'node:fs/promises';
import { mapChunked } from './map-chunked.js';
import { featureDir } from './data-root.js';

function steamDir()       { return featureDir('steam'); }
function storePath(appid) { return path.join(steamDir(), 'store', `${appid}.json`); }

async function readJson(p) {
    try { return JSON.parse(await fs.readFile(p, 'utf8')); }
    catch { return null; }
}

/**
 * Returns a combined, deduped list of { appid, name } covering both the Steam
 * library cache and the wishlist cache. Names for wishlist-only titles are
 * resolved from the store cache (parallel reads — fast).
 *
 * Either source failing is non-fatal; the other is used alone.
 */
export async function getAllGames() {
    const [gamesData, wishlistData] = await Promise.all([
        readJson(path.join(steamDir(), 'games.json')),
        readJson(path.join(steamDir(), 'wishlist.json')),
    ]);

    const libraryGames = (gamesData?.games ?? []).map(g => ({ appid: g.appid, name: g.name }));
    const libraryIds   = new Set(libraryGames.map(g => g.appid));

    const wishlistEntries = Object.keys(wishlistData?.items ?? {})
        .map(Number)
        .filter(appid => !libraryIds.has(appid));

    // Resolve names from store cache; fall back to "App <appid>"
    const wishlistGames = await mapChunked(wishlistEntries, async appid => {
        const store = await readJson(storePath(appid));
        return { appid, name: store?.name ?? `App ${appid}` };
    });

    return [...libraryGames, ...wishlistGames];
}
