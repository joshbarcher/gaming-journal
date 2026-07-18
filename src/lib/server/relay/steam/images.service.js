// Ported verbatim from relay-server src/services/steam/images.service.js
// (docs/relay-fold-in.md §6). Import rewrites only: utility/* → ../shared/*,
// root activity.js is five levels up, data paths via featureDir('steam').
import path from 'node:path';
import fs from 'node:fs/promises';
import logger from '../../logger.js';
import { recordWrite } from '../../../../../activity.js';
import { steamFetch, processBatch } from '../shared/steam-fetch.js';
import { featureDir } from '../shared/data-root.js';
import { getSourcesFile } from './image-sources.js';

const CDN  = 'https://cdn.akamai.steamstatic.com';
const CDN2 = 'https://shared.akamai.steamstatic.com/store_item_assets';

const GAME_IMAGES = [
    { name: 'header',     ext: 'jpg', urls: (id) => [`${CDN}/steam/apps/${id}/header.jpg`,              `${CDN2}/steam/apps/${id}/header.jpg`] },
    { name: 'capsule',    ext: 'jpg', urls: (id) => [`${CDN}/steam/apps/${id}/capsule_616x353.jpg`,      `${CDN2}/steam/apps/${id}/capsule_616x353.jpg`] },
    { name: 'poster',     ext: 'jpg', urls: (id) => [`${CDN}/steam/apps/${id}/library_600x900_2x.jpg`,   `${CDN2}/steam/apps/${id}/library_600x900_2x.jpg`] },
    { name: 'hero',       ext: 'jpg', urls: (id) => [`${CDN}/steam/apps/${id}/library_hero.jpg`,         `${CDN2}/steam/apps/${id}/library_hero.jpg`] },
    { name: 'background', ext: 'jpg', urls: (id) => [`${CDN}/steam/apps/${id}/background_raw.jpg`,       `${CDN}/steam/apps/${id}/page_bg_generated_v6b.jpg`, `${CDN2}/steam/apps/${id}/background_raw.jpg`] },
    { name: 'logo',       ext: 'png', urls: (id) => [`${CDN}/steam/apps/${id}/library_logo.png`,         `${CDN2}/steam/apps/${id}/library_logo.png`, `${CDN}/steam/apps/${id}/logo.png`] },
];

async function statRetry(fn, retries = 4, delayMs = 200) {
    for (let i = 0; i <= retries; i++) {
        try { return await fn(); } catch (err) {
            if (err.code !== 'EAGAIN' || i === retries) throw err;
            await new Promise(r => setTimeout(r, delayMs * (i + 1)));
        }
    }
}

function dataDir() {
    return featureDir('steam');
}

function imagesDir() {
    return path.join(dataDir(), 'images');
}

function gameImageDir(appid) {
    return path.join(imagesDir(), 'games', String(appid));
}

function achievementImageDir(appid) {
    return path.join(imagesDir(), 'achievements', String(appid));
}

function screenshotImageDir(appid) {
    return path.join(imagesDir(), 'screenshots', String(appid));
}

async function ensureDir(dir) {
    await fs.mkdir(dir, { recursive: true });
}

// Downloads from the first non-404 URL in urlList.
// Skips if the file exists and storedUrl is in urlList.
// Returns { result: 'downloaded'|'skipped'|'missing', url: string|null }
async function downloadFile(urls, destPath, { force = false, storedUrl = null } = {}) {
    const urlList = Array.isArray(urls) ? urls : [urls];

    if (!force) {
        try {
            await fs.access(destPath);
            if (storedUrl && urlList.includes(storedUrl)) return { result: 'skipped', url: storedUrl };
        } catch {
            // file doesn't exist — fall through
        }
    }

    for (const url of urlList) {
        const res = await fetch(url);
        if (res.status === 404) continue;
        if (!res.ok) throw new Error(`CDN ${res.status} ${res.statusText} — ${url}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        await fs.writeFile(destPath, buffer);
        recordWrite(buffer.length, destPath); // NAS steam image (see activity.js)
        return { result: 'downloaded', url };
    }

    return { result: 'missing', url: null };
}

// ── Per-game helpers (used by discovery pipeline) ─────────────────────────────

export async function syncOneGame(appid, { force = false } = {}) {
    const storeDataDir = path.join(dataDir(), 'store');
    const destDir      = gameImageDir(appid);
    await ensureDir(destDir);

    let storeDetail = null;
    try { storeDetail = JSON.parse(await fs.readFile(path.join(storeDataDir, `${appid}.json`), 'utf8')); } catch {}

    const STORE_URL_FIELD    = { header: 'header_image', capsule: 'capsule_image', background: 'background_raw' };
    const STORE_URL_FALLBACK = { background: 'background' };

    for (const img of GAME_IMAGES) {
        const dest = path.join(destDir, `${img.name}.${img.ext}`);
        let urlList = img.urls(appid);
        const storeField = STORE_URL_FIELD[img.name];
        if (storeField && storeDetail) {
            const storeUrl = storeDetail[storeField] ?? storeDetail[STORE_URL_FALLBACK[img.name]] ?? null;
            if (storeUrl && !urlList.includes(storeUrl)) urlList = [storeUrl, ...urlList];
        }
        try { await downloadFile(urlList, dest, { force }); } catch { /* missing is fine */ }
    }
    logger.debug('[steam-images] Single game images synced', { appid });
}

export async function syncOneScreenshots(appid, { force = false } = {}) {
    const storeDataDir = path.join(dataDir(), 'store');
    let storeDetail = null;
    try { storeDetail = JSON.parse(await fs.readFile(path.join(storeDataDir, `${appid}.json`), 'utf8')); } catch {}

    const screenshots = storeDetail?.screenshots ?? [];
    const destDir = screenshotImageDir(appid);
    await ensureDir(destDir); // always create — directory existence signals "processed"
    if (!screenshots.length) return;

    for (const shot of screenshots) {
        if (!shot.path_full) continue;
        const dest = path.join(destDir, `${shot.id}.jpg`);
        try { await downloadFile([shot.path_full], dest, { force }); } catch { /* missing is fine */ }
    }
    logger.debug('[steam-images] Single game screenshots synced', { appid, count: screenshots.length });
}

/** @param {{ force?: boolean, onProgress?: (done: number, total: number) => void }} [opts] */
export async function syncGameImages({ force = false, onProgress } = {}) {
    const gamesPath = path.join(dataDir(), 'games.json');
    let gamesData;
    try {
        gamesData = JSON.parse(await fs.readFile(gamesPath, 'utf8'));
    } catch {
        throw new Error('Games cache not found — run /api/steam/games/sync first');
    }

    const games = gamesData.games ?? [];
    try {
        const wishlistData = JSON.parse(await fs.readFile(path.join(dataDir(), 'wishlist.json'), 'utf8'));
        const ownedIds = new Set(games.map((g) => g.appid));
        for (const id of Object.keys(wishlistData.items ?? {})) {
            const appid = Number(id);
            if (!ownedIds.has(appid)) games.push({ appid });
        }
    } catch { /* wishlist not synced yet — owned games only */ }

    const sourcesFile = await getSourcesFile();
    const sources = sourcesFile.get();
    if (!sources.games) sources.games = {};

    // Pre-initialise source maps to avoid async races below
    for (const game of games) {
        if (!sources.games[String(game.appid)]) sources.games[String(game.appid)] = {};
    }

    const work  = games.flatMap((game) => GAME_IMAGES.map((img) => ({ game, img })));
    const total = work.length;
    let downloaded = 0, skipped = 0, missing = 0, done = 0;

    // ── Phase 1: in-memory skip check (zero disk I/O) ────────────────────────
    // Trust sources.json — if the URL is recorded, the file was downloaded.
    // Use ?force=true to bypass and re-download everything.
    const toDownload = [];

    for (const { game, img } of work) {
        const appidStr  = String(game.appid);
        const filename  = `${img.name}.${img.ext}`;
        const urlList   = img.urls(game.appid);
        const storedUrl = sources.games[appidStr][filename] ?? null;

        if (!force && storedUrl && urlList.includes(storedUrl)) {
            skipped++;
            done++;
            if (onProgress) onProgress(done, total);
            continue;
        }

        toDownload.push({ game, img, dest: path.join(gameImageDir(game.appid), filename), urlList, storedUrl });
    }

    // ── Phase 1.5: on-demand store fetch to resolve hash-based image URLs ───────
    // header_image, capsule_image, background_raw are hash-based on newer games
    // and can't be derived from the appid alone. Fetch store detail for any game
    // that has missing images in those categories and no cached URL yet.
    const STORE_RESOLVED = new Set(['header', 'capsule', 'background']);
    const storeDir = path.join(dataDir(), 'store');

    const gamesNeedingStore = new Map(); // appid → game object
    for (const { game, img } of toDownload) {
        if (STORE_RESOLVED.has(img.name)) gamesNeedingStore.set(game.appid, game);
    }

    if (gamesNeedingStore.size > 0) {
        const needsFetch = [];
        for (const [appid, game] of gamesNeedingStore) {
            const storePath = path.join(storeDir, `${appid}.json`);
            try {
                const cached = JSON.parse(await fs.readFile(storePath, 'utf8'));
                if (!cached.header_image && !cached.capsule_image && !cached.background_raw && !cached.background) {
                    needsFetch.push(game);
                }
            } catch {
                needsFetch.push(game);
            }
        }

        if (needsFetch.length > 0) {
            logger.info(`[steam-images] Fetching store detail for ${needsFetch.length} games to resolve image URLs`);
            await processBatch(
                needsFetch,
                async (game) => {
                    const url = `https://store.steampowered.com/api/appdetails?appids=${game.appid}&format=json`;
                    try {
                        const res  = await steamFetch(url);
                        const body = await res.json();
                        const data = body[String(game.appid)]?.data;
                        if (!data) return false;

                        const storePath = path.join(storeDir, `${game.appid}.json`);
                        let existing = {};
                        try { existing = JSON.parse(await fs.readFile(storePath, 'utf8')); } catch {}
                        for (const field of ['background_raw', 'background', 'header_image', 'capsule_image']) {
                            if (data[field]) existing[field] = data[field];
                        }
                        await fs.mkdir(storeDir, { recursive: true });
                        await fs.writeFile(storePath, JSON.stringify(existing, null, 2));
                        return true;
                    } catch { return false; }
                },
                { requestsPerSecond: 1 }
            );
        }
    }

    // store URL field for each image type that the store API provides directly
    const STORE_URL_FIELD = { header: 'header_image', capsule: 'capsule_image', background: 'background_raw' };
    const STORE_URL_FALLBACK = { background: 'background' };

    // ── Phase 2: rate-limited CDN downloads for only what's missing ───────────
    await processBatch(
        toDownload,
        async ({ game, img, dest, urlList, storedUrl }) => {
            const appidStr = String(game.appid);

            // Prepend store-cached URL when available — handles hash-based CDN paths
            let finalUrlList = urlList;
            const storeField = STORE_URL_FIELD[img.name];
            if (storeField) {
                try {
                    const storeJson = await fs.readFile(path.join(storeDir, `${game.appid}.json`), 'utf8');
                    const detail    = JSON.parse(storeJson);
                    const storeUrl  = detail[storeField] ?? detail[STORE_URL_FALLBACK[img.name]] ?? null;
                    if (storeUrl && !finalUrlList.includes(storeUrl)) {
                        finalUrlList = [storeUrl, ...finalUrlList];
                    }
                } catch { /* store not synced yet — fall through to CDN patterns */ }
            }

            await ensureDir(path.dirname(dest));
            const { result, url }  = await downloadFile(finalUrlList, dest, { force, storedUrl });

            if (result === 'downloaded') { downloaded++; sources.games[appidStr][`${img.name}.${img.ext}`] = url; }
            else missing++;

            done++;
            if (onProgress) onProgress(done, total);
            return result === 'downloaded';
        },
        { requestsPerSecond: 20 }
    );

    await sourcesFile.set({ ...sources });
    await sourcesFile.flush();

    logger.info('[steam-images] Game images sync complete', { downloaded, skipped, missing, total });
    return { downloaded, skipped, missing, total };
}

/** @param {{ force?: boolean, onProgress?: (done: number, total: number) => void }} [opts] */
export async function syncScreenshotImages({ force = false, onProgress } = {}) {
    const storeDir = path.join(dataDir(), 'store');

    let files;
    try {
        files = await fs.readdir(storeDir);
    } catch {
        throw new Error('Store cache not found — run /api/steam/store/sync first');
    }

    const work = [];
    for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
            const raw    = await fs.readFile(path.join(storeDir, file), 'utf8');
            const detail = JSON.parse(raw);
            for (const shot of detail.screenshots ?? []) {
                if (shot.path_full) work.push({ appid: detail.steam_appid, id: shot.id, url: shot.path_full });
            }
        } catch { /* skip malformed */ }
    }

    if (work.length === 0) {
        logger.info('[steam-images] No screenshots found — run store sync first');
        return { downloaded: 0, skipped: 0, missing: 0, total: 0 };
    }

    const sourcesFile = await getSourcesFile();
    const sources = sourcesFile.get();
    if (!sources.screenshots) sources.screenshots = {};

    let downloaded = 0;
    let skipped    = 0;
    let missing    = 0;
    let done       = 0;

    await processBatch(
        work,
        async ({ appid, id, url }) => {
            const appidStr = String(appid);
            if (!sources.screenshots[appidStr]) sources.screenshots[appidStr] = {};

            const dir      = screenshotImageDir(appid);
            await ensureDir(dir);

            const filename  = `${id}.jpg`;
            const dest      = path.join(dir, filename);
            const storedUrl = sources.screenshots[appidStr][filename] ?? null;
            const { result, url: usedUrl } = await downloadFile(url, dest, { force, storedUrl });

            if (result === 'downloaded') { downloaded++; sources.screenshots[appidStr][filename] = usedUrl; }
            else if (result === 'skipped') skipped++;
            else missing++;

            done++;
            if (onProgress) onProgress(done, work.length);
            return result !== 'skipped';
        },
        { requestsPerSecond: 2, jitterMs: 500 }
    );

    await sourcesFile.set({ ...sources });
    await sourcesFile.flush();

    logger.info('[steam-images] Screenshot sync complete', { downloaded, skipped, missing, total: work.length });
    return { downloaded, skipped, missing, total: work.length };
}

/**
 * @param {object}   [opts]
 * @param {boolean}  [opts.force=false]   Re-download even if the file exists.
 * @param {number[]} [opts.appids]        When provided, only process these appids.
 *                                        Useful after an incremental achievement sync
 *                                        to avoid re-scanning the entire library.
 * @param {Function} [opts.onProgress]
 */
export async function syncAchievementImages({ force = false, appids, onProgress } = {}) {
    // Achievements were sharded from a monolithic achievements.json into per-game
    // files under steam/achievements/ (steam.service _migrateAchievementsMonolith),
    // so the old monolith path is retired (…achievements.json.migrated) and reading
    // it threw "Achievements cache not found" on every steam:images tick. Read from
    // the service's in-memory cache instead. Dynamic import avoids the steam↔images
    // module cycle (steam.service dynamically imports this file in turn).
    const { getAchievements, getAchievementsForGame, loadAchievementsCache } =
        await import('./steam.service.js');

    // Read only the requested games (the incremental tick passes the just-synced
    // appids) rather than materializing all ~3k cache entries every run. An explicit
    // appids list — including an empty one — filters to exactly those; undefined
    // means "all". (Empty array → download nothing, matching the pre-shard contract.)
    const collect = () => appids
        ? appids.map(id => [String(id), getAchievementsForGame(id)]).filter(([, e]) => e)
        : Object.entries(getAchievements());

    let entries = collect();
    // Warm the cache once if it was cold (a tick raced the boot-load) AND there was
    // actually something to look for — an explicit empty appids list is legitimately
    // empty, not a cold-cache miss, so don't churn a full load for it.
    if (entries.length === 0 && appids?.length !== 0) {
        await loadAchievementsCache();
        entries = collect();
    }

    const work = [];
    for (const [appid, entry] of entries) {
        for (const ach of entry.achievements ?? []) {
            if (ach.icon)     work.push({ appid, name: ach.apiname, variant: 'color', url: ach.icon });
            if (ach.icongray) work.push({ appid, name: ach.apiname, variant: 'gray',  url: ach.icongray });
        }
    }

    if (work.length === 0) {
        logger.info('[steam-images] No achievement icons to download — run achievements sync first');
        return { downloaded: 0, skipped: 0, missing: 0, total: 0 };
    }

    const sourcesFile = await getSourcesFile();
    const sources = sourcesFile.get();
    if (!sources.achievements) sources.achievements = {};

    let downloaded = 0;
    let skipped    = 0;
    let missing    = 0;
    let done       = 0;

    await processBatch(
        work,
        async ({ appid, name, variant, url }) => {
            const appidStr = String(appid);
            if (!sources.achievements[appidStr]) sources.achievements[appidStr] = {};

            const dir = achievementImageDir(appid);
            await ensureDir(dir);

            const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
            let safeName = name
                .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
                .replace(/[. ]+$/, '_');
            if (RESERVED.test(safeName)) safeName = `_${safeName}`;
            const segment  = url.split('/').pop();
            const filename = `${safeName}_${variant}_${segment}`;
            const dest     = path.join(dir, filename);

            const storedUrl = sources.achievements[appidStr][filename] ?? null;
            const { result, url: usedUrl } = await downloadFile(url, dest, { force, storedUrl });

            if (result === 'downloaded') { downloaded++; sources.achievements[appidStr][filename] = usedUrl; }
            else if (result === 'skipped') skipped++;
            else missing++;

            done++;
            if (onProgress) onProgress(done, work.length);
            return result !== 'skipped';
        },
        { requestsPerSecond: 5 }
    );

    await sourcesFile.set({ ...sources });
    await sourcesFile.flush();

    logger.info('[steam-images] Achievement images sync complete', { downloaded, skipped, missing, total: work.length });
    return { downloaded, skipped, missing, total: work.length };
}

/**
 * Ensures poster.jpg and header.jpg are cached locally for a list of discovered games.
 * Each item may supply the actual CDN URLs (headerUrl, posterUrl) — these are tried
 * first before falling back to pattern-based CDN paths, which handles hash-based URLs.
 * Checks disk first; downloads from CDN only for what's missing.
 * Returns an array of appids confirmed to have poster.jpg after this call.
 *
 * @param {Array<{ appid: number, headerUrl?: string, posterUrl?: string }>} items
 * @param {{ onProgress?: (done: number, total: number) => void }} [opts]
 */
export async function ensureDiscoveryImages(items, { onProgress } = {}) {
    if (!items.length) return [];

    const CONCURRENCY = 8;
    const posterImg   = GAME_IMAGES.find(i => i.name === 'poster');
    const headerImg   = GAME_IMAGES.find(i => i.name === 'header');
    const withPoster  = [];
    let   done        = 0;
    let   idx         = 0;

    async function worker() {
        while (idx < items.length) {
            const { appid, headerUrl, posterUrl } = items[idx++];
            const dir        = gameImageDir(appid);
            const posterPath = path.join(dir, `poster.${posterImg.ext}`);
            const headerPath = path.join(dir, `header.${headerImg.ext}`);

            const [hasPoster, hasHeader] = await Promise.all([
                statRetry(() => fs.access(posterPath)).then(() => true).catch(() => false),
                statRetry(() => fs.access(headerPath)).then(() => true).catch(() => false),
            ]);

            if (hasPoster) withPoster.push(appid);

            if (!hasPoster || !hasHeader) {
                await ensureDir(dir);

                // Prepend the known CDN URL so we try it before pattern-based fallbacks.
                // This matters for games with hash-based header image paths.
                const posterUrls = posterUrl
                    ? [...new Set([posterUrl, ...posterImg.urls(appid)])]
                    : posterImg.urls(appid);
                const headerUrls = headerUrl
                    ? [...new Set([headerUrl, ...headerImg.urls(appid)])]
                    : headerImg.urls(appid);

                const downloads = [];
                if (!hasPoster) downloads.push(
                    downloadFile(posterUrls, posterPath)
                        .then(({ result }) => { if (result !== 'missing') withPoster.push(appid); })
                        .catch(() => {})
                );
                if (!hasHeader) downloads.push(
                    downloadFile(headerUrls, headerPath).catch(() => {})
                );
                await Promise.all(downloads);
            }

            done++;
            if (onProgress) onProgress(done, items.length);
        }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
    return withPoster;
}

// Builds sources.json from existing .src sidecar files, then deletes them.
export async function migrateSrcSidecars({ onProgress } = {}) {
    const base = imagesDir();
    const sourcesFile = await getSourcesFile();
    const sources = sourcesFile.get();
    if (!sources.games)        sources.games        = {};
    if (!sources.screenshots)  sources.screenshots  = {};
    if (!sources.achievements) sources.achievements = {};

    const srcFiles = [];
    for (const section of ['games', 'screenshots', 'achievements']) {
        const sectionDir = path.join(base, section);
        let appids;
        try { appids = await fs.readdir(sectionDir); } catch { continue; }
        for (const appid of appids) {
            const appidDir = path.join(sectionDir, appid);
            let entries;
            try { entries = await fs.readdir(appidDir); } catch { continue; }
            for (const entry of entries) {
                if (!entry.endsWith('.src')) continue;
                srcFiles.push({ section, appid, entry, fullPath: path.join(appidDir, entry) });
            }
        }
    }

    let migrated = 0;
    let done     = 0;
    for (const { section, appid, entry, fullPath } of srcFiles) {
        try {
            const url      = await fs.readFile(fullPath, 'utf8');
            const filename = entry.replace(/\.src$/, '');
            if (!sources[section][appid]) sources[section][appid] = {};
            sources[section][appid][filename] = url.trim();
            await fs.unlink(fullPath);
            migrated++;
        } catch { /* skip unreadable */ }
        done++;
        if (onProgress) onProgress(done, srcFiles.length);
    }

    await sourcesFile.set({ ...sources });
    await sourcesFile.flush();

    logger.info('[steam-images] Sidecar migration complete', { migrated, total: srcFiles.length });
    return { migrated, total: srcFiles.length };
}
