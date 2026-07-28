/**
 * IGN interactive-map fetcher.
 *
 * Downloads one IGN map (/maps/{objectSlug}/{mapSlug}) for fully-offline use:
 * the map definition, the marker sprite sheet, and the complete tile pyramid.
 *
 * Output layout, under the guide it belongs to:
 *   {steamId}/ign/{guideId}/_maps/{mapSlug}/
 *     _raw/_next.json     raw __NEXT_DATA__ payload (re-normalise without refetching)
 *     map.json            normalized — contracts/ignMap.ts
 *     sprite.png          single marker sprite sheet
 *     tiles/{z}/{x}/{y}.jpg
 *   {steamId}/ign/{guideId}/_maps/_index.json
 *
 * Unlike the wiki fetcher this needs no browser: the map page is plain SSR HTML
 * and a single GET carries every marker. Puppeteer is kept only as a fallback
 * for when IGN answers a bare fetch with a bot interstitial.
 *
 * Tile discovery is a quadtree descent rather than a bounding-box scan. The
 * pyramid is a solid rectangle at every level and each existing tile's four
 * children exist one level down, so descending from the tiles found at minZoom
 * visits exactly the tiles that exist — no wasted probes into empty space, and
 * it adapts to any map's extent without hardcoding bounds. (Palworld: 1 tile at
 * z8 descending to 65,536 at z16, 87,381 total.)
 *
 * Usage: called by tools/fetch-map.js
 */

import { mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname }                             from 'node:path';
import { recordWrite }                               from '../../../../../../activity.js';

import {
    extractNextData, normalizeMap, listMaps, mapNodeFrom, extractMapIndex,
    tileForLatLng, tileUrl, childTiles, tileExt, boundsForTiles,
} from './map-adapter.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const BROWSER_HEADERS = {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'DNT':             '1',
};

const TILE_HEADERS = {
    'User-Agent':      BROWSER_HEADERS['User-Agent'],
    'Accept':          'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer':         'https://www.ign.com/',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Thrown when IGN has no map for a game. Distinct from a fetch failure so a
 * discovery probe can answer "no map" without treating it as an error.
 */
export class NoMapError extends Error {
    constructor(url) {
        super(`No IGN map at ${url}`);
        this.name = 'NoMapError';
        this.noMap = true;
    }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitter(minMs, maxMs) { return minMs + Math.floor(Math.random() * Math.max(1, maxMs - minMs)); }

// Progress lines are emitted every Nth one-second tick. Frequent enough that the
// status text never looks stuck, sparse enough that a 75-minute run doesn't push
// thousands of SSE broadcasts at the browser.
const LOG_EVERY_TICKS = 4;

/** Compact "1h 12m" / "12m 30s" / "45s" for a duration in seconds. */
function formatEta(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '—';
    const s = Math.round(seconds);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

// When a map runs as a phase of a guide download it shares the job's progress
// object, so its emits must land on their own bar instead of overwriting the
// guide's Fetch/Parse bars. Set via fetchMap's `progressBar` option; null means
// standalone, where the natural bar names apply.
let _progressBar = null;

function emitProgress(bar, pct) {
    if (_progressBar) {
        // Only the tile download is worth a bar — the metadata steps are instant
        // and would just make the bar jump backwards.
        if (bar !== 'download') return;
        process.stdout.write(`[PROGRESS] ${JSON.stringify({ bar: _progressBar, pct })}\n`);
        return;
    }
    process.stdout.write(`[PROGRESS] ${JSON.stringify({ bar, pct })}\n`);
}

/** Seconds to wait per a Retry-After header (delta-seconds or HTTP date). */
function retryAfterMs(res) {
    const h = res.headers.get('retry-after');
    if (!h) return null;
    const secs = Number(h);
    if (Number.isFinite(secs)) return Math.min(secs * 1000, 60_000);
    const when = Date.parse(h);
    return Number.isFinite(when) ? Math.min(Math.max(0, when - Date.now()), 60_000) : null;
}

/**
 * Fetch with retries. Distinguishes "does not exist" from "try again":
 * the tile CDN is an S3 bucket without ListBucket permission, so a MISSING tile
 * answers 403 AccessDenied rather than 404 — both mean stop asking, and neither
 * is worth a retry. Only 5xx / 429 / transport errors back off and repeat, and
 * a Retry-After on the response wins over our own backoff curve.
 *
 * @returns {Promise<Buffer|null>} null when the resource does not exist
 */
async function fetchBuffer(url, { retries = 3, backoffMs = 800, headers = TILE_HEADERS } = {}) {
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        let wait = backoffMs * 2 ** attempt + Math.random() * 250;
        try {
            const res = await fetch(url, { headers });
            if (res.status === 403 || res.status === 404) {
                await res.body?.cancel().catch(() => {});
                return null;                       // genuinely absent
            }
            if (!res.ok) {                          // 5xx / 429 — worth retrying
                await res.body?.cancel().catch(() => {});
                lastErr = new Error(`HTTP ${res.status}`);
                // Being told to slow down is the one signal we always obey.
                const ra = retryAfterMs(res);
                if (ra !== null) wait = Math.max(wait, ra);
            } else {
                return Buffer.from(await res.arrayBuffer());
            }
        } catch (err) {
            lastErr = err;
        }
        if (attempt < retries) await sleep(wait);
    }
    throw lastErr ?? new Error(`Failed: ${url}`);
}

/**
 * Run `tasks` with at most `limit` in flight, preserving result order.
 *
 * Each worker pauses `paceMs()` between its own requests, so the sustained rate
 * is limit / (pace + latency) rather than an unthrottled burst. Tasks that
 * resolve from cache skip the pause by returning `PACE_SKIP` — a resumed run
 * shouldn't crawl through tiles it isn't fetching.
 */
const PACE_SKIP = Symbol('pace-skip');

async function pool(tasks, limit, paceMs = null) {
    const out = new Array(tasks.length);
    let next  = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, tasks.length) }, async () => {
            while (next < tasks.length) {
                const i   = next++;
                const res = await tasks[i]();
                const skipPace = res?.[PACE_SKIP] === true;
                out[i] = skipPace ? res.value : res;
                if (paceMs && !skipPace && next < tasks.length) await sleep(paceMs());
            }
        })
    );
    return out;
}

/** Mark a pool result as cache-served, so the worker doesn't pause after it. */
function unpaced(value) { return { [PACE_SKIP]: true, value }; }

// mkdir is the expensive call against a NAS share — remember what we've made.
const _madeDirs = new Set();
async function ensureDir(dir) {
    if (_madeDirs.has(dir)) return;
    await mkdir(dir, { recursive: true });
    _madeDirs.add(dir);
}

// ── Page fetch ────────────────────────────────────────────────────────────────

/**
 * Load a map page's HTML. Plain fetch first; Puppeteer only if that comes back
 * without a __NEXT_DATA__ blob (bot interstitial or a challenge page).
 */
async function fetchMapPageHtml(url, cfg) {
    try {
        const res = await fetch(url, { headers: BROWSER_HEADERS });
        if (res.ok) {
            const html = await res.text();
            if (html.includes('__NEXT_DATA__')) {
                console.log(`[fetcher:ign-map] Fetched page (${Math.round(html.length / 1024)}kb, no browser needed)`);
                return html;
            }
            console.log('[fetcher:ign-map] Response lacked __NEXT_DATA__ — retrying with browser');
        } else {
            await res.body?.cancel().catch(() => {});
            // A 404 is a definitive "this game has no map" — not a bot block, so
            // spinning up a browser to be told the same thing is pure waste.
            // Discovery probes rely on this being cheap.
            if (res.status === 404) throw new NoMapError(url);
            console.log(`[fetcher:ign-map] HTTP ${res.status} on plain fetch — retrying with browser`);
        }
    } catch (err) {
        console.log(`[fetcher:ign-map] Plain fetch failed (${err.message}) — retrying with browser`);
    }

    const { default: puppeteerExtra } = await import('puppeteer-extra');
    const { default: StealthPlugin }  = await import('puppeteer-extra-plugin-stealth');
    puppeteerExtra.use(StealthPlugin());

    const browser = await puppeteerExtra.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    try {
        const page = await browser.newPage();
        await page.setUserAgent(cfg.fetch.userAgent);
        await page.setViewport({ width: cfg.fetch.viewportWidth, height: cfg.fetch.viewportHeight });
        // The payload is in the SSR'd HTML — no need to pay for map tiles/JS here.
        await page.setRequestInterception(true);
        page.on('request', req => {
            if (['media', 'font', 'image'].includes(req.resourceType())) req.abort();
            else req.continue();
        });
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: cfg.fetch.timeout });
        if (!res || !res.ok()) throw new Error(`HTTP ${res?.status() ?? '?'} for ${url}`);
        await sleep(1200);
        return await page.content();
    } finally {
        await browser.close().catch(() => {});
    }
}

// ── Tile pyramid ──────────────────────────────────────────────────────────────

/**
 * Index the tiles already written for one zoom level, so a resumed run skips
 * them without a stat() per tile (87k stats over SMB is minutes of nothing).
 * One readdir per x-directory instead — 256 at the deepest Palworld level.
 *
 * @returns {Promise<Map<number, Set<number>>>} x → set of y
 */
async function scanLevel(tilesDir, z) {
    const level = new Map();
    let xDirs;
    try {
        xDirs = await readdir(join(tilesDir, String(z)), { withFileTypes: true });
    } catch {
        return level;                              // level not started
    }
    for (const xd of xDirs) {
        if (!xd.isDirectory()) continue;
        const x = Number(xd.name);
        if (!Number.isFinite(x)) continue;
        try {
            const files = await readdir(join(tilesDir, String(z), xd.name));
            const ys = new Set();
            for (const f of files) {
                const y = Number(f.replace(/\.[^.]+$/, ''));
                if (Number.isFinite(y)) ys.add(y);
            }
            if (ys.size) level.set(x, ys);
        } catch { /* unreadable — treat as absent */ }
    }
    return level;
}

/**
 * Find the tiles that exist at minZoom.
 *
 * The seed is the tile containing the map's centre; a small ring around it is
 * probed to catch maps wider than one tile at their minimum zoom, growing while
 * the outermost ring keeps returning hits so a large minZoom extent isn't
 * truncated.
 */
async function seedLevel(remoteTemplate, z, centerLat, centerLng, net) {
    const c = tileForLatLng(centerLat, centerLng, z);
    const found = new Set();
    let radius = 1;

    for (;;) {
        const candidates = [];
        for (let x = c.x - radius; x <= c.x + radius; x++) {
            for (let y = c.y - radius; y <= c.y + radius; y++) {
                if (x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) continue;
                if (found.has(`${x}/${y}`)) continue;
                candidates.push([x, y]);
            }
        }
        if (!candidates.length) break;

        const results = await pool(
            candidates.map(([x, y]) => async () => {
                const buf = await fetchBuffer(tileUrl(remoteTemplate, z, x, y), net.opts);
                return buf ? [x, y] : null;
            }),
            net.concurrency,
            net.pace
        );

        let newHits = 0;
        let edgeHit = false;
        for (const r of results) {
            if (!r) continue;
            found.add(`${r[0]}/${r[1]}`);
            newHits++;
            if (Math.abs(r[0] - c.x) === radius || Math.abs(r[1] - c.y) === radius) edgeHit = true;
        }
        // Only keep growing while the ring we just added was itself productive.
        if (!newHits || !edgeHit || radius > 8) break;
        radius++;
    }

    return [...found].map(k => k.split('/').map(Number));
}

/**
 * Write the small tile-availability sidecar the viewer polls while a download
 * runs. Kept separate from map.json (2.4mb for Palworld, nearly all markers)
 * because it is rewritten after every zoom level and read repeatedly — polling
 * the full payload to learn one number would be absurd.
 */
async function writeTileStatus(mapDir, tiles) {
    await writeFile(join(mapDir, 'tiles.json'), JSON.stringify({ ...tiles, updatedAt: new Date().toISOString() }));
}

/**
 * Download the full tile pyramid by quadtree descent from minZoom to maxZoom.
 *
 * Each completed level is published immediately via tiles.json, so the map is
 * usable at whatever depth exists so far rather than only when all 87k tiles
 * land. The first six levels are ~1,300 tiles — about a minute — so a map goes
 * from nothing to genuinely usable long before the deep levels finish.
 *
 * @returns {Promise<{byZoom: object, count: number, bytes: number, complete: boolean}>}
 */
async function downloadTiles(remoteTemplate, tilesDir, view, opts) {
    const { force, maxZoom, net, mapDir, publish } = opts;
    const ext      = tileExt(remoteTemplate);
    const minZoom  = view.minZoom;
    const topZoom  = Math.min(maxZoom ?? view.maxZoom, view.maxZoom);

    console.log(
        `[fetcher:ign-map] Tile pyramid z${minZoom}–z${topZoom} — ${net.concurrency} workers, ` +
        `${net.paceLabel} between requests (≤${net.estRps} req/s to tiles.mapgenie.io; ign.com is one page load)`
    );

    let parents = await seedLevel(remoteTemplate, minZoom, view.initialLat, view.initialLng, net);
    if (!parents.length) {
        throw new Error(
            `No tiles found at minZoom ${minZoom} for ${remoteTemplate}. ` +
            `Map Genie may have re-versioned the tileset path.`
        );
    }

    // With the base level known the pyramid is fully determined (each level
    // quadruples), so overall progress is exact from here rather than a guess.
    const levels      = topZoom - minZoom;
    const grandTotal  = parents.length * (4 ** (levels + 1) - 1) / 3;
    console.log(`[fetcher:ign-map] Base level has ${parents.length} tile(s) → ${grandTotal.toLocaleString()} tiles total`);

    const byZoom  = {};
    let   done    = 0;
    let   bytes   = 0;
    let   failed  = 0;
    let   cached  = 0;
    // Bounds come from the base level: it is the smallest tile set that still
    // covers the whole map, so the rectangle is exact and cheap to derive.
    const bounds  = boundsForTiles(parents, minZoom);

    // Set when a level turns out not to exist remotely — see the probe below.
    let truncatedAt = null;

    for (let z = minZoom; z <= topZoom; z++) {
        // Level minZoom is the seed itself; deeper levels are the children of
        // whatever actually existed one level up.
        const candidates = z === minZoom
            ? parents
            : parents.flatMap(([x, y]) => childTiles(x, y));

        // A map's declared maxZoom is not always rendered. Lego Batman advertises
        // maxZoom 16 while its tileset stops at 15 — every z16 tile 403s. Without
        // a check that costs 65,536 pointless requests to the CDN and a progress
        // bar that climbs through a level producing nothing.
        //
        // The pyramid is a strict quadtree, so one parent's four children settle
        // it: if none of them exist, the level does not exist. Four requests
        // instead of tens of thousands. Skipped when the level is already on disk
        // (a resumed run), and skipped at the base level, which seedLevel proved.
        if (z > minZoom && candidates.length > 8) {
            const probeParent = parents[0];
            const probes = childTiles(probeParent[0], probeParent[1]);
            const onDisk = force ? new Map() : await scanLevel(tilesDir, z);
            const anyCached = probes.some(([px, py]) => onDisk.get(px)?.has(py));
            if (!anyCached) {
                const found = await pool(
                    probes.map(([px, py]) => async () => {
                        try { return await fetchBuffer(tileUrl(remoteTemplate, z, px, py), net.opts); }
                        catch { return null; }   // transport error — treat as inconclusive below
                    }),
                    Math.min(4, net.concurrency), net.pace
                );
                if (found.every(b => b === null)) {
                    console.log(`  z${z}: not rendered by the source — stopping at z${z - 1} (saved ${candidates.length.toLocaleString()} requests)`);
                    truncatedAt = z;
                    break;
                }
            }
        }

        const existing = force ? new Map() : await scanLevel(tilesDir, z);
        const present  = [];
        let   levelCached = 0;
        let   levelBytes  = 0;
        // Fetched vs cached are tracked apart so the ETA is built from real
        // network throughput — see the ticker below.
        let   fetchedThisLevel = 0;
        const levelStarted     = Date.now();

        const tasks = candidates.map(([x, y]) => async () => {
            if (existing.get(x)?.has(y)) {
                levelCached++;
                cached++;
                done++;
                // Already on disk — no request was made, so don't pace after it.
                return unpaced([x, y]);
            }
            let buf;
            try {
                buf = await fetchBuffer(tileUrl(remoteTemplate, z, x, y), net.opts);
            } catch (err) {
                failed++;
                done++;
                console.log(`    [tile] ${z}/${x}/${y} failed: ${err.message}`);
                return null;
            }
            done++;
            fetchedThisLevel++;
            if (!buf) return null;                  // tile genuinely absent
            const dir = join(tilesDir, String(z), String(x));
            await ensureDir(dir);
            await writeFile(join(dir, `${y}${ext}`), buf);
            levelBytes += buf.length;
            return [x, y];
        });

        // Emit progress on a timer rather than per tile — 87k stdout lines would
        // swamp the job-queue's line reader.
        //
        // Two separate cadences, because they answer different questions:
        //   - the BAR every second, to one decimal. The pyramid is back-loaded
        //     (z16 alone is 65,536 of 87,381 tiles), so whole-percent steps mean
        //     ~45s of a motionless bar; 0.1% moves roughly every 4 seconds.
        //   - a LOG line every few seconds, because the per-level summary below
        //     only prints when a level FINISHES. On the deepest level that left
        //     the status text frozen for the better part of an hour while the
        //     bar climbed — the run looked hung when it was working fine.
        let ticks = 0;
        const ticker = setInterval(() => {
            const pct = Math.min(99.9, (done / grandTotal) * 100);
            emitProgress('download', Math.round(pct * 10) / 10);

            if (++ticks % LOG_EVERY_TICKS !== 0) return;
            const levelDone  = levelCached + fetchedThisLevel;
            const levelTotal = candidates.length;
            const elapsed    = (Date.now() - levelStarted) / 1000;
            // Rate from newly-fetched tiles only: cached ones return instantly and
            // would inflate it into a uselessly optimistic ETA on a resumed run.
            const rate       = fetchedThisLevel > 0 ? fetchedThisLevel / elapsed : 0;
            const remaining  = grandTotal - done;
            const eta        = rate > 0 ? formatEta(remaining / rate) : '—';
            console.log(
                `  z${z}: ${levelDone.toLocaleString()}/${levelTotal.toLocaleString()} ` +
                `(${(levelBytes / 1024 / 1024).toFixed(1)}mb) — ` +
                `${done.toLocaleString()}/${grandTotal.toLocaleString()} overall ` +
                `· ${pct.toFixed(1)}% · ${rate ? rate.toFixed(1) : '—'}/s · ETA ${eta}`
            );
        }, 1000);
        try {
            const results = await pool(tasks, net.concurrency, net.pace);
            for (const r of results) if (r) present.push(r);
        } finally {
            clearInterval(ticker);
        }

        bytes += levelBytes;
        byZoom[String(z)] = present.length;
        parents = present;

        // One aggregate NAS tally per level — a per-tile recordWrite would push
        // 87k entries through the bounded recent-writes ring and bury everything else.
        if (levelBytes) recordWrite(levelBytes, join(tilesDir, String(z)));

        const mb = (levelBytes / 1024 / 1024).toFixed(1);
        console.log(
            `  z${z}: ${present.length} tiles (${levelCached} cached, ${present.length - levelCached} new, ${mb}mb) ` +
            `— ${done.toLocaleString()}/${grandTotal.toLocaleString()} overall`
        );

        // Publish this level the moment it lands so the viewer can zoom into it
        // while the deeper levels are still downloading.
        if (publish && present.length) {
            await publish({
                minZoom, maxZoom: z, count: Object.values(byZoom).reduce((a, b) => a + b, 0),
                byZoom: { ...byZoom }, bounds, bytes, complete: false,
                targetMaxZoom: topZoom, tilesExpected: grandTotal, tilesDone: done,
            }).catch(() => { /* a status write must never abort the download */ });
        }

        if (!present.length) {
            console.log(`  z${z}: no tiles — stopping descent`);
            break;
        }
    }

    const count = Object.values(byZoom).reduce((a, b) => a + b, 0);
    emitProgress('download', 100);
    return {
        byZoom,
        count,
        bytes,
        cached,
        bounds,
        // Having every level the SOURCE renders counts as complete. A map whose
        // tileset stops short of its declared maxZoom (Lego Batman: declares 16,
        // renders 15) would otherwise sit forever showing "Download rest" and
        // re-probe the missing level on every run.
        complete: failed === 0 && (topZoom === view.maxZoom || truncatedAt !== null),
        truncatedAt,
        maxZoomReached: Math.max(...Object.keys(byZoom).map(Number)),
        failed,
    };
}

// ── Index ─────────────────────────────────────────────────────────────────────

/**
 * Rewrite _maps/_index.json from whatever map dirs are on disk.
 *
 * `sizeBytes` is taken from each map's own recorded tile total plus its sprite
 * and map.json, NOT from walking the tree: a full pyramid is ~87k files, and a
 * recursive stat over SMB would add minutes to the end of every run — including
 * runs that downloaded nothing because everything was already cached.
 */
async function rebuildIndex(mapsRoot) {
    let entries;
    try {
        entries = await readdir(mapsRoot, { withFileTypes: true });
    } catch {
        return [];
    }
    const index = [];
    for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('_')) continue;
        const dir = join(mapsRoot, e.name);
        try {
            const raw = await readFile(join(dir, 'map.json'), 'utf8');
            const m   = JSON.parse(raw);
            let sizeBytes = (m.tiles?.bytes ?? 0) + raw.length;
            try { sizeBytes += (await stat(join(dir, 'sprite.png'))).size; } catch { /* no sprite */ }
            index.push({
                mapSlug:     m.mapSlug,
                mapName:     m.mapName,
                markerCount: m.markers.length,
                tileCount:   m.tiles?.count ?? 0,
                sizeBytes,
                fetchedAt:   m.fetchedAt,
            });
        } catch { /* not a finished map dir */ }
    }
    index.sort((a, b) => a.mapName.localeCompare(b.mapName));
    await writeFile(join(mapsRoot, '_index.json'), JSON.stringify(index, null, 2));
    return index;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Rebuild tiles.json (and map.json's tile block) purely from what is on disk.
 *
 * Touches no network at all. Two uses:
 *   - recovering after an interrupted run, where the pyramid is largely present
 *     but the metadata still describes an earlier state;
 *   - publishing depth for a download that predates progressive publishing.
 *
 * Levels are walked upward from the map's own minZoom until one comes back empty,
 * which is exactly how the pyramid is laid down, so the first gap is the end.
 *
 * `bytes` is carried from whatever was previously recorded rather than recomputed —
 * summing 87k file sizes over SMB would take minutes and the figure is only ever
 * used for a size display.
 */
export async function reindexFromDisk(mapDir) {
    const map      = JSON.parse(await readFile(join(mapDir, 'map.json'), 'utf8'));
    const tilesDir = join(mapDir, 'tiles');
    const { minZoom, maxZoom: viewMax } = map.view;

    const byZoom = {};
    let baseTiles = null;
    let reached   = minZoom - 1;

    for (let z = minZoom; z <= viewMax; z++) {
        const level = await scanLevel(tilesDir, z);
        const count = [...level.values()].reduce((a, s) => a + s.size, 0);
        if (!count) break;                          // first gap ends the pyramid
        byZoom[String(z)] = count;
        reached = z;
        if (z === minZoom) {
            baseTiles = [...level.entries()].flatMap(([x, ys]) => [...ys].map(y => [x, y]));
        }
        console.log(`  z${z}: ${count} tiles on disk`);
    }

    const count  = Object.values(byZoom).reduce((a, b) => a + b, 0);
    const bounds = baseTiles?.length ? boundsForTiles(baseTiles, minZoom) : (map.tiles?.bounds ?? null);

    // Reaching maxZoom is NOT the same as having filled it — an interrupted run
    // leaves a partial deepest level. The pyramid is a strict quadtree, so each
    // level's expected size is base x 4^k; only a level that matches is finished,
    // and `maxZoom` must report the deepest COMPLETE level or the viewer will let
    // you zoom into holes.
    const base     = byZoom[String(minZoom)] ?? 0;
    const expected = z => base * 4 ** (z - minZoom);
    let deepestFull = minZoom - 1;
    for (let z = minZoom; z <= reached; z++) {
        if ((byZoom[String(z)] ?? 0) < expected(z)) break;
        deepestFull = z;
    }
    const tilesExpected = base ? (base * (4 ** (viewMax - minZoom + 1) - 1)) / 3 : 0;

    const tiles = {
        ...map.tiles,
        minZoom,
        maxZoom:  deepestFull,
        count,
        byZoom,
        bounds,
        bytes:    map.tiles?.bytes ?? 0,
        complete: deepestFull === viewMax,
        targetMaxZoom: viewMax,
        tilesExpected,
        tilesDone: count,
    };

    if (deepestFull < reached) {
        console.log(
            `  z${reached} is partial (${byZoom[String(reached)]}/${expected(reached)}) — ` +
            `reporting z${deepestFull} as the usable depth`
        );
    }

    map.tiles = tiles;
    await writeFile(join(mapDir, 'map.json'), JSON.stringify(map));
    await writeTileStatus(mapDir, tiles);
    await rebuildIndex(dirname(mapDir));

    console.log(
        `[reindex] ${map.mapName}: z${minZoom}-${reached} of ${viewMax}, ` +
        `${count.toLocaleString()} tiles${tiles.complete ? ' (complete)' : ''}`
    );
    return tiles;
}

/**
 * Resolve which map a URL actually refers to, without downloading anything.
 *
 * IGN redirects a bare /maps/{game} to the game's primary map, so the slug is
 * only knowable after the page loads. Callers need it up front to pick the
 * output directory — otherwise a bare URL would write into a placeholder dir
 * and have to be moved afterwards.
 *
 * @returns {Promise<{mapSlug: string, mapName: string, objectSlug: string, siblings: Array}>}
 */
export async function resolveMapTarget(url, cfg) {
    const html     = await fetchMapPageHtml(url, cfg);
    const nextData = extractNextData(html);
    const { map }  = mapNodeFrom(nextData);
    return {
        mapSlug:    map.mapSlug,
        mapName:    map.mapName,
        objectSlug: map.objectSlug,
        siblings:   listMaps(nextData),
    };
}

/**
 * Ask IGN whether a downloaded wiki guide has an interactive map, and which.
 *
 * Discovery is a pure string substitution rather than a lookup: IGN keys a
 * game's wiki and its maps off the same slug (`map.object.wikiSlug === objectSlug`),
 * so /wikis/{slug} implies /maps/{slug}. One GET answers it, and a 404 short-
 * circuits before any browser is launched.
 *
 * @returns {Promise<Array<{mapSlug, mapName, premium}>>} empty when the game has no map
 */
export async function discoverMaps(wikiSlug, cfg, origin = 'https://www.ign.com') {
    try {
        // /maps/{slug} is an INDEX page, not a redirect to the primary map: it has
        // no `page.map` and no tilesets, and its list lives at `page.mapData.maps`.
        // Hitting it rather than a map page also keeps discovery cheap — ~140kb
        // against ~3.8mb for a map page, which inlines every marker.
        const html = await fetchMapPageHtml(`${origin}/maps/${wikiSlug}`, cfg);
        return extractMapIndex(extractNextData(html));
    } catch (err) {
        // 404, or a page with no map list at all — either way the game has no map.
        if (err?.noMap) return [];
        throw err;
    }
}

/**
 * Fetch one IGN map into `mapDir`.
 *
 * @param {string} url      - https://www.ign.com/maps/{objectSlug}/{mapSlug}
 * @param {string} mapDir   - …/_maps/{mapSlug}
 * @param {object} cfg      - guides/config.js defaults (Puppeteer fallback only)
 * @param {object} [opts]
 * @param {boolean} [opts.force=false]        - re-download tiles already on disk
 * @param {number}  [opts.concurrency]        - parallel tile downloads (default cfg.map.tileConcurrency)
 * @param {number}  [opts.maxZoom]            - cap the pyramid (default: the map's own maxZoom)
 * @param {boolean} [opts.reparse=false]      - re-normalise from _raw/_next.json, no network
 * @param {boolean} [opts.skipTiles=false]    - metadata + sprite only
 */
export async function fetchMap(url, mapDir, cfg, opts = {}) {
    const {
        force = false, concurrency = null, maxZoom = null,
        reparse = false, skipTiles = false, progressBar = null,
    } = opts;

    _progressBar = progressBar;

    // Throttle bundle shared by every network call below. Defaults live in
    // guides/config.js next to the page-crawl delays so all source pacing is
    // tunable from one place.
    const mapCfg  = cfg.map ?? {};
    const workers = concurrency ?? mapCfg.tileConcurrency ?? 6;
    const dMin    = mapCfg.tileDelayMinMs ?? 120;
    const dMax    = mapCfg.tileDelayMaxMs ?? 320;
    const net = {
        concurrency: workers,
        pace:        () => jitter(dMin, dMax),
        paceLabel:   `${dMin}-${dMax}ms`,
        // Upper bound: workers / average pace, assuming zero latency. The old
        // estimate added 100ms of assumed round-trip and so under-reported the
        // real rate (measured ~25/s against a claimed 19/s). A throttle figure
        // that reads lower than reality is worse than none, so this is the
        // ceiling the pacing can actually produce.
        estRps:      Math.ceil(workers / (((dMin + dMax) / 2) / 1000)),
        opts: {
            retries:   mapCfg.tileRetries ?? 3,
            backoffMs: mapCfg.retryBackoffMs ?? 800,
        },
    };

    const rawDir   = join(mapDir, '_raw');
    const tilesDir = join(mapDir, 'tiles');
    await ensureDir(rawDir);

    // ── Step 1: map payload ──────────────────────────────────────────────────
    let nextData;
    if (reparse) {
        console.log('[fetcher:ign-map] Reparse — reading cached _raw/_next.json');
        nextData = JSON.parse(await readFile(join(rawDir, '_next.json'), 'utf8'));
    } else {
        const html = await fetchMapPageHtml(url, cfg);
        nextData   = extractNextData(html);
        await writeFile(join(rawDir, '_next.json'), JSON.stringify(nextData));
    }

    const { map, remoteTileTemplate, spriteUrl } = normalizeMap(nextData, url);
    const siblings = listMaps(nextData);

    console.log(`[fetcher:ign-map] ${map.objectName} — ${map.mapName}`);
    console.log(`  types:   ${map.types.length} (${map.types.filter(t => t.defaultOn).length} on by default)`);
    console.log(`  markers: ${map.markers.length.toLocaleString()}`);
    console.log(`  zoom:    ${map.view.minZoom}–${map.view.maxZoom} (initial ${map.view.initialZoom})`);
    console.log(`  tiles:   ${remoteTileTemplate}`);
    if (siblings.length > 1) {
        console.log(`  sibling maps: ${siblings.map(s => s.mapSlug).join(', ')}`);
    }
    emitProgress('pages', 20);

    // ── Step 2: sprite sheet ─────────────────────────────────────────────────
    const spritePath = join(mapDir, 'sprite.png');
    let haveSprite = false;
    if (!force) {
        try { await stat(spritePath); haveSprite = true; } catch { /* not yet */ }
    }
    if (!haveSprite && !reparse) {
        const buf = await fetchBuffer(spriteUrl, net.opts);
        if (!buf) throw new Error(`Marker sprite not available: ${spriteUrl}`);
        await writeFile(spritePath, buf);
        recordWrite(buf.length, spritePath);
        console.log(`  sprite:  ${Math.round(buf.length / 1024)}kb → sprite.png`);
    } else {
        console.log('  sprite:  cached');
    }
    emitProgress('pages', 45);

    // ── Step 3: tile pyramid ─────────────────────────────────────────────────
    // Whatever a previous run recorded — used both as the reparse fallback and to
    // carry the byte total across a resumed download.
    let prevTiles = null;
    try { prevTiles = JSON.parse(await readFile(join(mapDir, 'map.json'), 'utf8')).tiles; } catch { /* first run */ }

    // ── Step 3: publish the map before its tiles ─────────────────────────────
    // map.json and the index go out now, not at the end, so the viewer can open
    // the map — markers, filters, legend — while the pyramid is still arriving.
    // `tiles` is filled in from whatever a previous run left, or an empty pyramid.
    const emptyTiles = {
        template: `tiles/{z}/{x}/{y}${tileExt(remoteTileTemplate)}`,
        ext: tileExt(remoteTileTemplate),
        minZoom: map.view.minZoom, maxZoom: map.view.minZoom - 1,   // nothing usable yet
        count: 0, bytes: 0, byZoom: {}, bounds: null,
        remoteTemplate: remoteTileTemplate, complete: false,
    };
    map.tiles = prevTiles ?? emptyTiles;
    await writeFile(join(mapDir, 'map.json'), JSON.stringify(map));
    await rebuildIndex(dirname(mapDir));
    if (!prevTiles) await writeTileStatus(mapDir, emptyTiles);

    let tiles;
    if (skipTiles || reparse) {
        // Keep whatever the previous run recorded so a reparse never reports
        // the pyramid as missing.
        tiles = prevTiles ?? emptyTiles;
        console.log(`[fetcher:ign-map] Skipping tiles (${skipTiles ? '--skip-tiles' : 'reparse'})`);
        emitProgress('download', 100);
    } else {
        const result = await downloadTiles(remoteTileTemplate, tilesDir, map.view, {
            force, maxZoom, net, mapDir,
            // Publish each completed level: the sidecar for the viewer's poll, and
            // map.json so a cold load also sees the depth available right now.
            publish: async (status) => {
                await writeTileStatus(mapDir, { ...emptyTiles, ...status });
                map.tiles = { ...emptyTiles, ...status };
                await writeFile(join(mapDir, 'map.json'), JSON.stringify(map));
            },
        });
        tiles = {
            template:       `tiles/{z}/{x}/{y}${tileExt(remoteTileTemplate)}`,
            ext:            tileExt(remoteTileTemplate),
            minZoom:        map.view.minZoom,
            maxZoom:        result.maxZoomReached,
            count:          result.count,
            // Cached tiles contribute no bytes this run, so a resumed download
            // would report far less than is on disk (and a fully-cached re-run
            // would report zero). The cached tiles are exactly the ones an
            // earlier run wrote, so its recorded total is precisely their size —
            // add it rather than stat-ing 87k files to recompute.
            bytes:          result.bytes + (result.cached ? (prevTiles?.bytes ?? 0) : 0),
            byZoom:         result.byZoom,
            bounds:         result.bounds,
            remoteTemplate: remoteTileTemplate,
            complete:       result.complete,
        };
        if (result.failed) console.log(`[fetcher:ign-map] WARNING: ${result.failed} tile(s) failed after retries`);
    }
    emitProgress('pages', 85);

    // ── Step 4: finalise map.json + status + index ───────────────────────────
    map.tiles = tiles;
    const json = JSON.stringify(map);
    await writeFile(join(mapDir, 'map.json'), json);
    await writeTileStatus(mapDir, tiles);
    recordWrite(json.length, join(mapDir, 'map.json'));

    const index = await rebuildIndex(dirname(mapDir));
    emitProgress('pages', 100);
    emitProgress('subtask', 100);

    console.log(
        `\n[fetcher:ign-map] Done — ${map.markers.length.toLocaleString()} markers, ` +
        `${tiles.count.toLocaleString()} tiles, ${(tiles.bytes / 1024 / 1024).toFixed(1)}mb` +
        `${tiles.complete ? '' : ' (INCOMPLETE)'}`
    );

    return { map, tiles, siblings, index };
}
