// Ported verbatim from relay-server src/services/steam/stats.service.js
// (docs/relay-fold-in.md §6). Import rewrites only: utility/* → ../shared/*,
// data paths via featureDir('steam'). getGames comes from steam.service.js
// (ported in the same wave — Wave 3 Batch A).
import path from 'node:path';
import logger from '../../logger.js';
import { ManagedFile } from '../shared/managed-file.js';
import { steamFetch, processBatch } from '../shared/steam-fetch.js';
import { featureDir } from '../shared/data-root.js';
import { getGames } from './steam.service.js';

const STEAM_API = 'https://api.steampowered.com';

const STATS_TTL_MS = 6 * 60 * 60 * 1_000;
const MIN_PLAYTIME = 1;

function dataDir() {
    return featureDir('steam');
}

function makeFile(name, defaultValue) {
    return new ManagedFile({
        filePath: path.join(dataDir(), `${name}.json`),
        name: `steam-${name}`,
        defaultValue,
    });
}

function cacheIsFresh(fetchedAt, ttlMs) {
    if (!fetchedAt) return false;
    return Date.now() - new Date(fetchedAt).getTime() < ttlMs;
}

let _statsFile = null;

async function _loadStatsFile() {
    if (!_statsFile) {
        _statsFile = makeFile('player-stats', () => ({}));
        await _statsFile.load();
    }
    return _statsFile;
}

async function fetchUserStats(apiKey, steamId, appId) {
    const url = new URL(`${STEAM_API}/ISteamUserStats/GetUserStatsForGame/v2/`);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('steamid', steamId);
    url.searchParams.set('appid', appId);
    url.searchParams.set('format', 'json');

    const res  = await steamFetch(url.toString());
    const body = await res.json();
    return body.playerstats ?? {};
}

/** @param {{ force?: boolean, onProgress?: (done: number, total: number) => void }} [opts] */
export async function syncPlayerStats({ force = false, onProgress } = {}) {
    const apiKey  = process.env.STEAM_API_KEY;
    const steamId = process.env.STEAM_ID;
    if (!apiKey)  throw new Error('STEAM_API_KEY is not set');
    if (!steamId) throw new Error('STEAM_ID is not set');

    const gamesData = await getGames();

    const playedGames = (gamesData.games ?? []).filter(
        (g) => g.playtime_forever >= MIN_PLAYTIME
    );

    if (playedGames.length === 0) {
        logger.info('[steam-stats] No played games — stats sync skipped');
        return { synced: 0, skipped: 0, noStats: 0 };
    }

    const statsFile = await _loadStatsFile();
    const cache = statsFile.get();

    const toFetch = force
        ? playedGames
        : playedGames.filter((g) => {
            const entry = cache[g.appid];
            if (!entry?.fetchedAt) return true;
            if (cacheIsFresh(entry.fetchedAt, STATS_TTL_MS)) return false;
            const lastPlayed  = g.rtime_last_played * 1_000;
            const lastFetched = new Date(entry.fetchedAt).getTime();
            return lastPlayed > lastFetched;
        });

    logger.info('[steam-stats] Player stats sync queued', {
        played:  playedGames.length,
        queued:  toFetch.length,
        skipped: playedGames.length - toFetch.length,
    });

    let synced  = 0;
    let noStats = 0;
    let failed  = 0;
    const updates = {};

    await processBatch(
        toFetch,
        async (game) => {
            try {
                const raw   = await fetchUserStats(apiKey, steamId, game.appid);
                // A 200 with empty stats (temporarily private profile / server load) must not blank
                // a game's previously-cached stat values — keep the prior non-empty set.
                const prior = statsFile.get()[game.appid]?.stats;
                const stats = raw.stats?.length ? raw.stats : (prior ?? []);

                updates[game.appid] = {
                    fetchedAt: new Date().toISOString(),
                    gameName:  game.name ?? raw.gameName ?? String(game.appid),
                    stats,
                };

                stats.length ? synced++ : noStats++;
            } catch (err) {
                logger.debug('[steam-stats] Stats unavailable', {
                    appid: game.appid, name: game.name, err: err.message,
                });
                failed++;
            }
        },
        { requestsPerSecond: 1, onProgress }
    );

    if (Object.keys(updates).length > 0) {
        await statsFile.set({ ...statsFile.get(), ...updates });
        await statsFile.flush();
    }

    logger.info('[steam-stats] Player stats sync complete', {
        synced, noStats, failed, skipped: playedGames.length - toFetch.length,
    });
    return { synced, noStats, failed, skipped: playedGames.length - toFetch.length };
}

export async function getPlayerStats() {
    return (await _loadStatsFile()).get();
}
