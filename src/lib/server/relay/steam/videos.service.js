// Ported verbatim from relay-server src/services/steam/videos.service.js
// (docs/relay-fold-in.md §6). Import rewrites only.
import path from 'node:path';
import fs   from 'node:fs/promises';
import { featureDir } from '../shared/data-root.js';

function steamDir()  { return featureDir('steam'); }
function moviesDir() { return path.join(steamDir(), 'movies'); }
function videosDir() { return path.join(steamDir(), 'videos'); }

async function fileExists(p) {
    try { await fs.access(p); return true } catch { return false; }
}

/**
 * Returns [{index, name, thumbnail}] for trailers that have been downloaded
 * to the local videos directory. Empty array if nothing has been synced yet.
 */
export async function getVideoMeta(appid) {
    const cachePath = path.join(moviesDir(), `${appid}.json`);
    let movies = [];
    try {
        const { movies: m = [] } = JSON.parse(await fs.readFile(cachePath, 'utf8'));
        movies = m;
    } catch {
        return [];
    }

    const sorted = [...movies.filter(m => m.highlight), ...movies.filter(m => !m.highlight)];

    const result = [];
    for (let i = 0; i < sorted.length; i++) {
        if (await fileExists(path.join(videosDir(), String(appid), `${i}.mp4`))) {
            result.push({
                index:     i,
                name:      sorted[i].name      ?? `Trailer ${i + 1}`,
                thumbnail: sorted[i].thumbnail ?? null,
            });
        }
    }
    return result;
}
