/**
 * fetch-map.js — Download an IGN interactive map for fully-offline use.
 *
 * Usage:
 *   node --env-file .env src/lib/server/relay/guides/tools/fetch-map.js \
 *     --url https://www.ign.com/maps/palworld/palpagos-islands \
 *     --steam-id 1623730 \
 *     [--guide-id palworld]     (default: the map's objectSlug)
 *     [--all-maps]              (also fetch this game's sibling maps)
 *     [--max-zoom 15]           (cap the pyramid; default = the map's own maxZoom)
 *     [--concurrency 6]         (parallel tile downloads; default from config.js)
 *     [--skip-tiles]            (metadata + sprite only)
 *     [--reparse]               (re-normalise from cached _raw/_next.json, no network)
 *     [--reindex]               (republish tiles.json/map.json from disk, no network)
 *     [--force]                 (re-download tiles already on disk)
 *
 * Output:
 *   $DATA_DIR/relay/guides/{steamId}/ign/{guideId}/_maps/{mapSlug}/
 *     _raw/_next.json  map.json  sprite.png  tiles/{z}/{x}/{y}.jpg
 *   $DATA_DIR/relay/guides/{steamId}/ign/{guideId}/_maps/_index.json
 *
 * The map lives under the wiki guide for the same game because IGN keys both off
 * one slug (map.object.wikiSlug === objectSlug), so a downloaded guide always
 * knows where to find its map without a lookup.
 */

import { join } from 'node:path';
import { defaults, applyCliOverrides } from '../config.js';
import { featureDir } from '../../shared/data-root.js';
import { fetchMap, discoverMaps, reindexFromDisk } from '../ign/map-fetcher.js';

const DATA_DIR = process.env.DATA_DIR;
const argv     = process.argv.slice(2);

function arg(name) {
    const i = argv.indexOf(name);
    return i !== -1 ? argv[i + 1] : null;
}
function flag(name) { return argv.includes(name); }
function num(name) {
    const v = arg(name);
    if (v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) {
        console.error(`${name} must be a number (got "${v}")`);
        process.exit(1);
    }
    return n;
}

// ── Validate args ─────────────────────────────────────────────────────────────

if (!DATA_DIR) {
    console.error('DATA_DIR not set — run with: node --env-file .env …/fetch-map.js');
    process.exit(1);
}

const url     = arg('--url');
const steamId = arg('--steam-id');

if (!url || !steamId) {
    console.error('Usage: fetch-map.js --url <ign-map-url> --steam-id <steamId> [--guide-id <slug>] [--all-maps] [--max-zoom N] [--skip-tiles] [--reparse] [--force]');
    process.exit(1);
}

/** Which source a map URL belongs to. */
function detectSource(u) {
    try {
        const host = new URL(u).hostname.replace(/^www\./, '');
        if (host === 'game8.co') return 'game8';
        if (host === 'ign.com')  return 'ign';
    } catch { /* fall through */ }
    return null;
}

/**
 * Parse https://www.ign.com/maps/{objectSlug}[/{mapSlug}] .
 * The map slug is optional — without one we resolve the game's first map.
 */
function parseMapUrl(u) {
    let parsed;
    try { parsed = new URL(u); } catch { return null; }
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'maps' || parts.length < 2) return null;
    return { objectSlug: parts[1], mapSlug: parts[2] ?? null, origin: parsed.origin };
}

/**
 * Parse https://game8.co/games/{Game-Slug}/archives/{articleId} .
 * Game8 keys its maps off an article, so the guide id defaults to the game slug.
 */
function parseGame8Url(u) {
    let parsed;
    try { parsed = new URL(u); } catch { return null; }
    const parts = parsed.pathname.split('/').filter(Boolean);
    // ["games", "{Game}", "archives", "{id}"]
    if (parts[0] !== 'games' || parts.length < 2) return null;
    return { gameSlug: parts[1], articleId: parts[3] ?? null, origin: parsed.origin };
}

const detectedSource = arg('--source') ?? detectSource(url);
if (!detectedSource) {
    console.error(`Unrecognised map URL: ${url}`);
    console.error('Expected https://www.ign.com/maps/{game}[/{map}] or https://game8.co/games/{Game}/archives/{id}');
    process.exit(1);
}

const target = detectedSource === 'ign' ? parseMapUrl(url) : parseGame8Url(url);
if (!target) {
    console.error(`Could not parse ${detectedSource} map URL: ${url}`);
    process.exit(1);
}

// The guide this map belongs to. For IGN that's the object slug, which is also
// the wiki slug — so a map lands inside the wiki guide already downloaded for
// it. For Game8 it's the game slug from the article URL.
const guideId  = arg('--guide-id') ?? (detectedSource === 'ign' ? target.objectSlug : target.gameSlug);
const mapsRoot = join(featureDir('guides'), steamId, detectedSource, guideId, '_maps');

const cfg = applyCliOverrides(structuredClone(defaults), argv);

const opts = {
    force:       flag('--force'),
    reparse:     flag('--reparse'),
    skipTiles:   flag('--skip-tiles'),
    maxZoom:     num('--max-zoom'),
    concurrency: num('--concurrency'),
    // Set when running as a phase of a guide download, so tile progress lands on
    // the job's Map bar instead of overwriting its Fetch bar.
    progressBar: arg('--progress-bar'),
};

console.log('Guide Map Fetcher');
console.log('══════════════════════════════════════');
console.log(`  Source:   ${detectedSource}`);
console.log(`  Steam ID: ${steamId}`);
console.log(`  Guide ID: ${guideId}`);
console.log(`  Game:     ${detectedSource === 'ign' ? target.objectSlug : target.gameSlug}`);
if (detectedSource === 'ign') console.log(`  Map:      ${target.mapSlug ?? '(first available)'}`);
else                          console.log(`  Article:  ${target.articleId ?? '(none)'}`);
console.log(`  Output:   ${mapsRoot}`);
const flags = Object.entries(opts).filter(([, v]) => v).map(([k, v]) => v === true ? `--${k}` : `--${k} ${v}`);
if (flags.length) console.log(`  Flags:    ${flags.join(' ')}`);
console.log();

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

try {
    // ── Game8 ────────────────────────────────────────────────────────────────
    // A Game8 map is one payload plus an image per area, so there is no pyramid
    // to resume, no --all-maps (every area is fetched) and no --max-zoom.
    if (detectedSource === 'game8') {
        const { fetchGame8Map } = await import('../game8/map-fetcher.js');
        const result = await fetchGame8Map(url, mapsRoot, cfg, {
            force:    opts.force,
            guideId,
            gameName: arg('--game-name') ?? '',
        });
        console.log('\n══════════════════════════════════════');
        console.log(`  Maps written: ${result.maps.join(', ')}`);
        console.log(`  Markers:      ${result.totalMarkers.toLocaleString()}`);
        console.log(`  Index:        ${join(mapsRoot, '_index.json')}`);
        await new Promise(resolve => process.stdout.write('', resolve));
        process.exit(0);
    }

    // ── Reindex: publish what's already on disk, no network ──────────────────
    if (flag('--reindex')) {
        if (!target.mapSlug) {
            console.error('--reindex needs a specific map URL (…/maps/{game}/{map})');
            process.exit(1);
        }
        await reindexFromDisk(join(mapsRoot, target.mapSlug));
        await new Promise(resolve => process.stdout.write('', resolve));
        process.exit(0);
    }

    // ── Resolve the target map ───────────────────────────────────────────────
    // /maps/{game} is an INDEX page listing the game's maps — it is not a map
    // itself and has no tilesets. So a URL without a map slug is answered by
    // reading that index, which also tells us when a game simply has no map.
    let mapSlug   = target.mapSlug;
    let discovered = null;
    if (!mapSlug) {
        discovered = await discoverMaps(target.objectSlug, cfg, target.origin);
        if (!discovered.length) {
            // The ordinary outcome for most games. Not a failure — a guide download
            // runs this speculatively for every IGN guide.
            console.log(`[fetch-map] No IGN interactive map for "${target.objectSlug}" — nothing to download.`);
            await new Promise(resolve => process.stdout.write('', resolve));
            process.exit(0);
        }
        mapSlug = discovered[0].mapSlug;
        console.log(
            `[fetch-map] ${target.objectSlug} has ${discovered.length} map(s): ` +
            `${discovered.map(m => m.mapSlug).join(', ')}\n`
        );
    }

    const first = await fetchMap(
        `${target.origin}/maps/${target.objectSlug}/${mapSlug}`,
        join(mapsRoot, mapSlug), cfg, opts,
    );
    const done = [first.map.mapSlug];

    // ── Sibling maps ─────────────────────────────────────────────────────────
    if (flag('--all-maps')) {
        // Prefer the index listing when we have it; a map page's own `page.maps`
        // is the same set, so either source enumerates the siblings.
        const all = discovered ?? first.siblings;
        const others = all.filter(s => !done.includes(s.mapSlug));
        if (others.length) {
            console.log(`\n[fetch-map] ${others.length} sibling map(s) to follow: ${others.map(o => o.mapSlug).join(', ')}`);
        }
        for (const sib of others) {
            // Pace between map pages exactly like the wiki crawler paces pages.
            const delay = (cfg.map?.pageDelayMinMs ?? 1500)
                + Math.floor(Math.random() * ((cfg.map?.pageDelayMaxMs ?? 3800) - (cfg.map?.pageDelayMinMs ?? 1500)));
            console.log(`\n[fetch-map] waiting ${delay}ms before ${sib.mapSlug}`);
            await sleep(delay);

            console.log(`\n─── ${sib.mapName} (${sib.mapSlug}) ───`);
            await fetchMap(
                `${target.origin}/maps/${target.objectSlug}/${sib.mapSlug}`,
                join(mapsRoot, sib.mapSlug), cfg, opts,
            );
            done.push(sib.mapSlug);
        }
    }

    console.log('\n══════════════════════════════════════');
    console.log(`  Maps written: ${done.join(', ')}`);
    console.log(`  Index:        ${join(mapsRoot, '_index.json')}`);
} catch (err) {
    // Most games have no interactive map. When this runs as a phase of a guide
    // download that is the ordinary case, not a failure — exiting non-zero would
    // fail the whole guide job over a map that was never expected to exist.
    if (err?.noMap) {
        console.log(`[fetch-map] No IGN map for "${target.objectSlug}" — nothing to download.`);
        await new Promise(resolve => process.stdout.write('', resolve));
        process.exit(0);
    }
    // A map on IGN's own backend rather than Map Genie. Recognised and skipped
    // rather than treated as breakage — the guide itself downloaded fine.
    if (err?.unsupported) {
        console.log(`[fetch-map] Skipping "${target.objectSlug}": ${err.message}`);
        await new Promise(resolve => process.stdout.write('', resolve));
        process.exit(0);
    }
    console.error('\n[fetch-map] Fatal error:', err.message);
    process.exit(1);
}

// Match the other guide tools: force a clean exit so a spawning job-queue sees
// 'close' promptly regardless of lingering keep-alive sockets.
await new Promise(resolve => process.stdout.write('', resolve));
process.exit(0);
