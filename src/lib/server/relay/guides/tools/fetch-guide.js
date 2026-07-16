/**
 * fetch-guide.js — Download all pages of a guide to a local raw HTML cache.
 *
 * Usage (from relay-server root):
 *   node --env-file .env src/tools/fetch-guide.js \
 *     --url https://gamefaqs.gamespot.com/ps5/503564-trails-in-the-sky-1st-chapter/faqs/82117/introduction \
 *     --steam-id 251150 \
 *     [--source gamefaqs|ign|steam]  (default: gamefaqs)
 *     [--force]                       (re-fetch pages already on disk)
 *
 * Output:
 *   $DATA_DIR/relay/guides/{steamId}/{source}/{guideId}/_raw/
 *     _manifest.json    — page list + metadata
 *     introduction.html
 *     chapter-1.html
 *     ...
 *
 * Guide ID:
 *   gamefaqs — numeric faqId extracted from URL (e.g. 82117)
 *   ign      — wiki slug extracted from URL     (e.g. pragmata)
 */

import { join } from 'node:path';
import { defaults, applyCliOverrides } from '../config.js';
import { featureDir } from '../../shared/data-root.js';

const DATA_DIR = process.env.DATA_DIR;
const argv     = process.argv.slice(2);

function arg(name) {
    const i = argv.indexOf(name);
    return i !== -1 ? argv[i + 1] : null;
}

function flag(name) { return argv.includes(name); }

// ── Validate args ─────────────────────────────────────────────────────────────

if (!DATA_DIR) {
    console.error('DATA_DIR not set — run with: node --env-file .env src/tools/fetch-guide.js');
    process.exit(1);
}

const url     = arg('--url');
const steamId = arg('--steam-id');
const source  = arg('--source') ?? 'gamefaqs';
const force   = flag('--force');

// guideId: extracted from URL per source, or supplied explicitly
function guideIdFromUrl(u, src) {
    if (!u) return null;
    if (src === 'ign') {
        // https://www.ign.com/wikis/{wikiSlug}[/{page}]
        const m = u.match(/ign\.com\/wikis\/([^/?#]+)/i);
        return m ? m[1].toLowerCase() : null;
    }
    if (src === 'steam') {
        // https://steamcommunity.com/sharedfiles/filedetails/?id=12345
        return new URL(u).searchParams.get('id') ?? null;
    }
    if (src === 'game8') {
        // https://game8.co/games/{gameSlug}[/archives/{id}]
        return u.match(/game8\.co\/games\/([A-Za-z0-9-]+)/i)?.[1] ?? null;
    }
    if (src === 'gamerguides') {
        // https://www.gamerguides.com/{slug}/guide
        return u.match(/gamerguides\.com\/([^/?#]+)/i)?.[1] ?? null;
    }
    if (src === 'fandom') {
        // https://{subdomain}.fandom.com/wiki/{ArticleTitle}
        const m = u.match(/^https?:\/\/([a-z0-9-]+)\.fandom\.com\/wiki\/([^?#]+)/i);
        if (!m) return null;
        return `${m[1]}--${decodeURIComponent(m[2]).replace(/ /g, '_')}`;
    }
    if (src === 'neoseeker') {
        // https://www.neoseeker.com/{gameSlug}/walkthrough
        return u.match(/neoseeker\.com\/([a-z0-9-]+)\/walkthrough/i)?.[1] ?? null;
    }
    // gamefaqs default: numeric faqId
    return u.match(/\/faqs\/(\d+)/)?.[1] ?? null;
}

const guideId = arg('--guide-id') ?? guideIdFromUrl(url, source);

if (!url) {
    console.error('Usage: fetch-guide.js --url <guide-url> --steam-id <steamId> [--source gamefaqs|ign|game8|gamerguides|fandom] [--guide-id <id>] [--force]');
    process.exit(1);
}

if (!steamId) {
    console.error('--steam-id is required (e.g. --steam-id 251150)');
    process.exit(1);
}

if (!guideId) {
    console.error('Could not determine guide ID from URL. Pass --guide-id explicitly.');
    process.exit(1);
}

// ── Load source fetcher ───────────────────────────────────────────────────────

const { fetchGuide } = source === 'ign'
    ? await import('../ign/fetcher.js')
    : source === 'steam'
        ? await import('../steam/fetcher.js')
        : source === 'game8'
            ? await import('../game8/fetcher.js')
            : source === 'gamerguides'
                ? await import('../gamerguides/fetcher.js')
                : source === 'fandom'
                    ? await import('../fandom/fetcher.js')
                    : source === 'neoseeker'
                        ? await import('../neoseeker/fetcher.js')
                        : source === 'thegamer'
                            ? await import('../thegamer/fetcher.js')
                            : await import('../gamefaqs/fetcher.js');

// ── Run ───────────────────────────────────────────────────────────────────────

const cfg    = applyCliOverrides(structuredClone(defaults), argv);
const rawDir = join(featureDir('guides'), steamId, source, guideId, '_raw');

console.log('Guide Fetcher');
console.log('══════════════════════════════════════');
console.log(`  Source:   ${source}`);
console.log(`  Steam ID: ${steamId}`);
console.log(`  Guide ID: ${guideId}`);
console.log(`  URL:      ${url}`);
console.log(`  Output:   ${rawDir}`);
if (force) console.log('  Flags:    --force (re-fetching cached pages)');
console.log();

try {
    const manifest = await fetchGuide(url, rawDir, cfg, { force });
    console.log('\n══════════════════════════════════════');
    console.log(`  Pages fetched: ${manifest.pages.length}`);
    console.log(`  Sections:      ${manifest.pages.map(p => p.slug).join(', ')}`);
    console.log('\nNext step:');
    console.log(`  node --env-file .env src/tools/parse-guide.js --steam-id ${steamId} --source ${source} --guide-id ${guideId}`);
} catch (err) {
    console.error('\n[fetch-guide] Fatal error:', err.message);
    process.exit(1);
}

// Force a clean exit so the parent job-queue's child 'close' fires promptly,
// regardless of any lingering handles (browser sockets, keep-alive connections).
await new Promise(resolve => process.stdout.write('', resolve));
process.exit(0);
