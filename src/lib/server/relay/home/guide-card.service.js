// Ported verbatim from relay-server src/services/home/guide-card.service.js
// (docs/relay-fold-in.md §6 — logic byte-identical; guides root resolved via
// featureDir('guides') instead of a hardcoded DATA_DIR/relay join, per the
// single data-root rule).
import path from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import { featureDir } from '../shared/data-root.js';

// Resolves, for one game (appid), the "best" downloaded guide and a representative
// screenshot for the home page's guide card. This mirrors the title/id logic in
// guides/guides.controller.js so the card matches the guide index page.

function gameRoot(appid)   { return path.join(featureDir('guides'), String(appid)); }

async function isDir(p) {
    try { return (await stat(p)).isDirectory(); } catch { return false; }
}

async function readJson(p) {
    try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; }
}

// Strip " by Author", "(PC)", etc. from raw guide titles (same as the controller).
function cleanTitle(raw) {
    return String(raw ?? '')
        .replace(/\s+by\s+.+$/i, '')
        .replace(/\s*\([^)]*\)\s*$/, '')
        .trim();
}

// Map a source-specific guide URL back to the guideId used as the on-disk folder.
function guideIdFromUrl(source, url) {
    if (!url) return null;
    if (source === 'ign')         return url.match(/ign\.com\/wikis\/([^/?#]+)/i)?.[1]?.toLowerCase() ?? null;
    if (source === 'steam')       { try { return new URL(url).searchParams.get('id') ?? null; } catch { return null; } }
    if (source === 'game8')       return url.match(/game8\.co\/games\/([A-Za-z0-9-]+)/i)?.[1] ?? null;
    if (source === 'gamerguides') return url.match(/gamerguides\.com\/([^/?#]+)/i)?.[1] ?? null;
    if (source === 'fandom') {
        const m = url.match(/^https?:\/\/([a-z0-9-]+)\.fandom\.com\/wiki\/([^?#]+)/i);
        if (!m) return null;
        return `${m[1]}--${decodeURIComponent(m[2]).replace(/ /g, '_')}`;
    }
    if (source === 'neoseeker') return url.match(/neoseeker\.com\/([a-z0-9-]+)\/walkthrough/i)?.[1] ?? null;
    return url.match(/\/faqs\/(\d+)/)?.[1] ?? null;
}

async function buildTitleMap(appid) {
    const search = await readJson(path.join(gameRoot(appid), '_search.json'));
    const map = {};
    for (const [src, srcData] of Object.entries(search?.sources ?? {})) {
        for (const g of srcData.guides ?? []) {
            const id = guideIdFromUrl(src, g.url);
            if (id) map[id] = cleanTitle(g.title);
        }
    }
    return map;
}

// Build the served .webp URL for a cover image (mirrors GuideLanding.imgUrl).
function screenshotUrl(appid, source, guideId, cover) {
    if (!cover?.src) return null;
    const filename = cover.src.replace(/^img\//, '').replace(/\.[^.]+$/, '.webp');
    return `/relay/guides-img/${appid}/${source}/${guideId}/${encodeURIComponent(cover.section)}/img/${filename}`;
}

// ── Memo ──────────────────────────────────────────────────────────────────────
// Resolving one card walks the game's guides tree: a readdir per source, then a
// stat + two readFiles per guide. On the NAS mount that is dozens of round-trips,
// and the home payload resolves six games' worth every rebuild. Nothing here
// changes unless a guide is downloaded, re-parsed, or opened — all of which call
// invalidateGuideCard — so memoize aggressively and treat the TTL purely as a
// backstop for out-of-band edits to the tree.
const MEM_TTL_MS = 30 * 60 * 1_000;

const _memo = new Map();   // appid → { value, at }

/**
 * Drop the memo for one game (or all of it) so the next read re-walks the tree.
 * @param {number|string|null} [appid] omit to clear every game
 */
export function invalidateGuideCard(appid = null) {
    if (appid === null) _memo.clear();
    else _memo.delete(Number(appid));
}

/**
 * Returns the best guide card for a game, or null if it has no downloaded guides.
 * "Best" = most-recently-used, else the one with the most cover images (richest),
 * else the first found. Shape:
 *   { source, guideId, title, sourceUrl, screenshot, screenshots, pageCount }
 */
export async function getGuideCard(appid) {
    const key = Number(appid);
    const hit = _memo.get(key);
    if (hit && (Date.now() - hit.at) < MEM_TTL_MS) return hit.value;

    const value = await resolveGuideCard(appid);
    // Cache misses too (null = "this game has no guides"): that answer costs a
    // readdir to reach and is the common case across a large library.
    _memo.set(key, { value, at: Date.now() });
    return value;
}

async function resolveGuideCard(appid) {
    const root = gameRoot(appid);
    let sources;
    try { sources = await readdir(root); } catch { return null; }

    const titleMap = await buildTitleMap(appid);
    const candidates = [];

    for (const source of sources) {
        if (source.startsWith('_')) continue;
        const srcDir = path.join(root, source);
        if (!await isDir(srcDir)) continue;

        let guideIds;
        try { guideIds = await readdir(srcDir); } catch { continue; }

        for (const guideId of guideIds) {
            if (guideId.startsWith('_')) continue;
            const gDir = path.join(srcDir, guideId);
            if (!await isDir(gDir)) continue;

            const [meta, usage] = await Promise.all([
                readJson(path.join(gDir, '_meta.json')),
                readJson(path.join(gDir, '_usage.json')),
            ]);

            const covers = meta?.coverImages ?? [];
            candidates.push({
                source,
                guideId,
                title:       titleMap[guideId] ?? cleanTitle(meta?.title) ?? 'Guide',
                sourceUrl:   meta?.sourceUrl ?? null,
                pageCount:   meta?.pages?.length ?? 0,
                lastUsedAt:  usage?.lastUsedAt ?? null,
                screenshots: covers.slice(0, 6).map(c => screenshotUrl(appid, source, guideId, c)).filter(Boolean),
            });
        }
    }

    if (!candidates.length) return null;

    candidates.sort((a, b) => {
        const ta = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
        const tb = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
        if (tb !== ta) return tb - ta;                       // most recently used first
        return b.screenshots.length - a.screenshots.length;  // then richest (has screenshots)
    });

    const best = candidates[0];
    return {
        source:      best.source,
        guideId:     best.guideId,
        title:       best.title,
        sourceUrl:   best.sourceUrl,
        pageCount:   best.pageCount,
        screenshot:  best.screenshots[0] ?? null,
        screenshots: best.screenshots,
    };
}
