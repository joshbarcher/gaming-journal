/**
 * Game8 interactive-map fetcher.
 *
 * Downloads one Game8 map for fully-offline use. Cheap compared to IGN: a Game8
 * map is one JSON payload, one base image per area and one icon per
 * classification — Crimson Desert is 6 images + 107 icons, against Palworld's
 * 87,381 tiles.
 *
 * Output layout matches the IGN fetcher exactly, so one viewer and one static
 * route serve both. Each AREA becomes its own map directory, which is how the
 * existing map switcher and per-map filter persistence pick them up for free:
 *
 *   {steamId}/game8/{guideId}/_maps/{areaSlug}/
 *     map.json        normalized — contracts/ignMap.ts
 *     base.<ext>      the area's base image
 *     icons/<slug>.png  one per classification present in this area
 *   {steamId}/game8/{guideId}/_maps/_index.json
 *
 * The tool id is NOT derivable from the article URL, so discovery means loading
 * the page in a browser and watching for its own API call. Game8 answers a bare
 * fetch with 403, so the browser is required regardless.
 */

import { mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname }                             from 'node:path';
import * as cheerio                                  from 'cheerio';
import { recordWrite }                               from '../../../../../../activity.js';

import {
    normalizeGame8Map, collectIconUrls, slugify, extFromUrl,
    UnsupportedGame8MapError, GAME8_GRID,
} from './map-adapter.js';

const MAPPING_RE = /tool_structural_mappings\/(\d+)\.json/;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitter(a, b) { return a + Math.floor(Math.random() * Math.max(1, b - a)); }

function emitProgress(bar, pct) {
    process.stdout.write(`[PROGRESS] ${JSON.stringify({ bar, pct })}\n`);
}

// ── Popup HTML sanitising ─────────────────────────────────────────────────────

// Game8 ships rich markup on every marker (tables of drops, links, images).
// cleanInlineHtml() is the wrong tool — it unwraps everything that isn't an
// inline tag, which would flatten those tables into a run of text. So this is a
// block-level allowlist instead.
//
// This is a security boundary, not just tidying: the markup is third-party and
// ends up rendered in a page that also holds the user's journal. Everything not
// explicitly allowed is dropped, including every event handler and any
// javascript: URL.
const ALLOWED_TAGS = new Set([
    'p', 'br', 'strong', 'em', 'code', 'a', 'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'span', 'img', 'b', 'i',
]);
const ALLOWED_ATTRS = {
    a:   new Set(['href', 'title']),
    img: new Set(['src', 'alt']),
    td:  new Set(['colspan', 'rowspan']),
    th:  new Set(['colspan', 'rowspan']),
};

function safeUrl(value) {
    const v = String(value ?? '').trim();
    // Anything that isn't plainly http(s) or protocol-relative is dropped —
    // javascript:, data:, vbscript: and friends all fail this.
    return /^(https?:\/\/|\/\/|\/)/i.test(v) ? v : null;
}

export function sanitizePopupHtml(raw) {
    if (!raw) return null;
    const $ = cheerio.load(`<div id="__root">${raw}</div>`, { decodeEntities: false });
    const root = $('#__root');

    // Drop these outright, contents included.
    root.find('script, style, iframe, object, embed, form, input, button, link, meta').remove();

    root.find('*').each((_, el) => {
        const tag = el.tagName?.toLowerCase();
        if (!tag) return;
        if (!ALLOWED_TAGS.has(tag)) {
            // Unwrap rather than remove, so text inside an unknown wrapper survives.
            $(el).replaceWith($(el).html() ?? '');
            return;
        }
        const allowed = ALLOWED_ATTRS[tag] ?? new Set();
        for (const name of Object.keys(el.attribs ?? {})) {
            if (!allowed.has(name.toLowerCase())) { $(el).removeAttr(name); continue; }
            if (name === 'href' || name === 'src') {
                const safe = safeUrl(el.attribs[name]);
                if (safe) $(el).attr(name, safe);
                else $(el).removeAttr(name);
            }
        }
        // Links leave the app; make that explicit and deny referrer/opener.
        if (tag === 'a' && $(el).attr('href')) {
            $(el).attr('target', '_blank');
            $(el).attr('rel', 'noopener noreferrer');
        }
    });

    const html = root.html()?.trim() ?? '';
    return html.length ? html : null;
}

// ── Network ───────────────────────────────────────────────────────────────────

async function launch(cfg) {
    const { default: puppeteerExtra } = await import('puppeteer-extra');
    const { default: StealthPlugin }  = await import('puppeteer-extra-plugin-stealth');
    puppeteerExtra.use(StealthPlugin());
    return puppeteerExtra.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
}

/**
 * Load a Game8 article and capture its map payload.
 *
 * The map mounts lazily well below the fold, so the element has to be scrolled
 * into view before its API call fires.
 *
 * @returns {Promise<{toolId: string, payload: object}>}
 */
export async function discoverMapping(pageUrl, cfg) {
    const browser = await launch(cfg);
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: cfg.fetch.viewportWidth, height: cfg.fetch.viewportHeight });
        await page.setUserAgent(cfg.fetch.userAgent);

        let toolId = null;
        let body   = null;
        page.on('response', async res => {
            const m = res.url().match(MAPPING_RE);
            if (!m || body) return;
            toolId = m[1];
            try { body = await res.text(); } catch { /* raced a navigation */ }
        });

        const resp = await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: cfg.fetch.timeout });
        if (!resp || !resp.ok()) throw new Error(`HTTP ${resp?.status() ?? '?'} for ${pageUrl}`);
        await sleep(2500);

        await page.evaluate(() => {
            document.querySelector('[class*="markerListContainer"], [class*="leaflet"], [class*="mapContainer"]')
                ?.scrollIntoView({ block: 'center' });
        });

        // Poll rather than a fixed sleep — the payload is up to 1.6mb.
        for (let i = 0; i < 40 && !body; i++) await sleep(500);
        if (!body) {
            throw new UnsupportedGame8MapError(
                `No Game8 map payload on ${pageUrl} — the article has no interactive map.`
            );
        }
        return { toolId, payload: JSON.parse(body) };
    } finally {
        await browser.close().catch(() => {});
    }
}

/** Fetch binary asset with retries. Game8's CDN serves these without a referer check. */
async function fetchBinary(url, { retries = 3, backoffMs = 700 } = {}) {
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                    'Referer': 'https://game8.co/',
                },
            });
            if (res.status === 403 || res.status === 404) { await res.body?.cancel().catch(() => {}); return null; }
            if (!res.ok) { await res.body?.cancel().catch(() => {}); lastErr = new Error(`HTTP ${res.status}`); }
            else return Buffer.from(await res.arrayBuffer());
        } catch (err) { lastErr = err; }
        if (attempt < retries) await sleep(backoffMs * 2 ** attempt + Math.random() * 200);
    }
    throw lastErr ?? new Error(`Failed: ${url}`);
}

/** Natural pixel size of an image buffer, via sharp (already a dependency). */
async function imageSize(buf) {
    try {
        const { default: sharp } = await import('sharp');
        const meta = await sharp(buf).metadata();
        return { width: meta.width ?? 0, height: meta.height ?? 0 };
    } catch {
        return { width: 0, height: 0 };   // dimensions are a hint; the viewer can cope
    }
}

// ── Index ─────────────────────────────────────────────────────────────────────

async function rebuildIndex(mapsRoot) {
    let entries;
    try { entries = await readdir(mapsRoot, { withFileTypes: true }); } catch { return []; }
    const index = [];
    for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('_')) continue;
        const dir = join(mapsRoot, e.name);
        try {
            const raw = await readFile(join(dir, 'map.json'), 'utf8');
            const m   = JSON.parse(raw);
            let sizeBytes = (m.tiles?.bytes ?? 0) + raw.length;
            if (m.image?.file) {
                try { sizeBytes += (await stat(join(dir, m.image.file))).size; } catch { /* missing */ }
            }
            index.push({
                mapSlug: m.mapSlug, mapName: m.mapName,
                markerCount: m.markers.length,
                tileCount: m.tiles?.count ?? 0,
                sizeBytes, fetchedAt: m.fetchedAt,
            });
        } catch { /* not a finished map dir */ }
    }
    index.sort((a, b) => a.mapName.localeCompare(b.mapName));
    await writeFile(join(mapsRoot, '_index.json'), JSON.stringify(index, null, 2));
    return index;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch every area of one Game8 map into `mapsRoot`.
 *
 * @param {string} pageUrl  https://game8.co/games/{Game}/archives/{id}
 * @param {string} mapsRoot …/{steamId}/game8/{guideId}/_maps
 * @param {object} cfg      guides/config.js defaults
 * @param {object} [opts]   { force, guideId, gameName }
 */
export async function fetchGame8Map(pageUrl, mapsRoot, cfg, opts = {}) {
    const { force = false, guideId = '', gameName = '' } = opts;

    console.log(`[fetcher:game8-map] Discovering map payload: ${pageUrl}`);
    const { toolId, payload } = await discoverMapping(pageUrl, cfg);
    console.log(`[fetcher:game8-map] tool id ${toolId} (${(JSON.stringify(payload).length / 1024).toFixed(0)}kb)`);
    emitProgress('pages', 15);

    const areas = normalizeGame8Map(payload, { sourceUrl: pageUrl, toolId });
    const totalMarkers = areas.reduce((a, m) => a + m.markers.length, 0);
    const totalSkipped = areas.reduce((a, m) => a + m.skipped.length, 0);

    console.log(`[fetcher:game8-map] ${payload.headingText ?? guideId}`);
    console.log(`  areas:   ${areas.length} (${areas.map(a => a.mapSlug).join(', ')})`);
    console.log(`  markers: ${totalMarkers.toLocaleString()}${totalSkipped ? ` (+${totalSkipped} unplottable, skipped)` : ''}`);
    console.log(`  mode:    ${areas[0].tiled ? 'tiled' : 'single image'} | grid ${GAME8_GRID}`);
    if (totalSkipped) {
        for (const a of areas) {
            for (const s of a.skipped) console.log(`    [skip] ${a.mapSlug}: ${s.id} "${s.title}" — no coordinate`);
        }
    }

    if (areas[0].tiled) {
        // The tiled path needs the tile host and directory layout, which neither
        // sampled map exercises. Refusing beats writing a map whose base layer
        // silently 404s on every request.
        throw new UnsupportedGame8MapError(
            `Game8 map "${payload.headingText}" uses tileLayerMode — the tiled Game8 layout is not implemented yet.`
        );
    }

    await mkdir(mapsRoot, { recursive: true });
    const iconUrls = collectIconUrls(areas);
    console.log(`  icons:   ${iconUrls.length} distinct`);

    // Download each icon once, reused across areas.
    const iconBuffers = new Map();
    let iconIdx = 0;
    for (const url of iconUrls) {
        iconIdx++;
        try {
            const buf = await fetchBinary(url);
            if (buf) iconBuffers.set(url, { buf, ext: extFromUrl(url, '.png') });
        } catch (err) {
            console.log(`    [icon] ${url.slice(0, 70)} failed: ${err.message}`);
        }
        emitProgress('subtask', Math.round((iconIdx / Math.max(1, iconUrls.length)) * 100));
        await sleep(jitter(60, 160));
    }
    console.log(`  icons downloaded: ${iconBuffers.size}/${iconUrls.length}`);

    // ── Per-area maps ────────────────────────────────────────────────────────
    const written = [];
    for (let i = 0; i < areas.length; i++) {
        const area   = areas[i];
        const mapDir = join(mapsRoot, area.mapSlug);
        await mkdir(join(mapDir, 'icons'), { recursive: true });

        // Base image
        const baseFile = `base${area.imageExt}`;
        const basePath = join(mapDir, baseFile);
        let dims = { width: 0, height: 0 };
        let haveBase = false;
        if (!force) {
            try { await stat(basePath); haveBase = true; } catch { /* not yet */ }
        }
        if (haveBase) {
            dims = await imageSize(await readFile(basePath));
        } else if (area.remoteImageUrl) {
            const buf = await fetchBinary(area.remoteImageUrl);
            if (!buf) throw new Error(`Base image unavailable for "${area.mapSlug}"`);
            await writeFile(basePath, buf);
            recordWrite(buf.length, basePath);
            dims = await imageSize(buf);
            console.log(`  [${i + 1}/${areas.length}] ${area.mapSlug}: base ${Math.round(buf.length / 1024)}kb ${dims.width}x${dims.height}`);
            await sleep(jitter(cfg.map?.tileDelayMinMs ?? 120, cfg.map?.tileDelayMaxMs ?? 320));
        } else {
            throw new Error(`Area "${area.mapSlug}" has no base image url`);
        }

        // Icons used by this area only.
        const types = [];
        for (const t of area.types) {
            let iconFile = null;
            if (t.iconUrl && iconBuffers.has(t.iconUrl)) {
                const { buf, ext } = iconBuffers.get(t.iconUrl);
                iconFile = `icons/${t.typeSlug}${ext}`;
                await writeFile(join(mapDir, iconFile), buf);
            }
            types.push({
                typeSlug: t.typeSlug, typeName: t.typeName, parentTypeSlug: t.parentTypeSlug,
                icon: null, legend: null, iconFile,
                markerCount: t.markerCount, children: t.children, defaultOn: t.defaultOn,
            });
        }

        const map = {
            schemaVersion: 1,
            id:         `${guideId}:${area.mapSlug}`,
            mapSlug:    area.mapSlug,
            mapName:    area.mapName,
            objectSlug: guideId,
            objectName: gameName || payload.headingText || guideId,
            wikiSlug:   guideId,
            sourceUrl:  pageUrl,
            fetchedAt:  new Date().toISOString(),
            source:     'game8',
            projection: 'Simple',
            grid:       area.grid,
            view: {
                // CRS.Simple: zoom is a pure scale factor, not a slippy level.
                minZoom: -2, maxZoom: 4, initialZoom: 0,
                // Centre of the virtual grid.
                initialLat: area.grid / 2, initialLng: area.grid / 2,
                backgroundColor: null,
            },
            image: {
                file: baseFile, remoteUrl: area.remoteImageUrl,
                width: dims.width, height: dims.height,
            },
            types,
            markers: area.markers.map(m => ({
                ...m,
                // Sanitised here, once, rather than trusting it at render time.
                html: sanitizePopupHtml(m.html),
            })),
        };

        await writeFile(join(mapDir, 'map.json'), JSON.stringify(map));
        written.push(area.mapSlug);
        emitProgress('download', Math.round(((i + 1) / areas.length) * 100));
    }

    const index = await rebuildIndex(mapsRoot);
    emitProgress('pages', 100);
    emitProgress('subtask', 100);
    console.log(`\n[fetcher:game8-map] Done — ${written.length} area map(s): ${written.join(', ')}`);
    return { maps: written, index, totalMarkers, totalSkipped };
}
