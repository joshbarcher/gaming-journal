import path from 'node:path';
import fs from 'node:fs/promises';
import logger from '../../logger.js';
import { mapChunked } from '../shared/map-chunked.js';
import { getAllGames } from '../shared/getAllGames.js';
import { featureDir } from '../shared/data-root.js';
import { tracked } from '../metrics/tracked.js';

const PROTONDB_BASE = 'https://www.protondb.com/api/v1/reports/summaries';

// Tiers considered stable — not worth re-polling frequently
const SETTLED_TIERS = new Set(['native', 'platinum']);

// Default TTL: 7 days for normal entries, 30 days for settled ones
const DEFAULT_TTL_DAYS   = 7;
const SETTLED_TTL_DAYS   = 30;

const MIN_DELAY_MS = 100;
const MAX_DELAY_MS = 300;

function protondbDir()      { return featureDir('protondb'); }
function entryPath(appid)   { return path.join(protondbDir(), `${appid}.json`); }
function indexPath()        { return path.join(protondbDir(), 'index.json'); }

function jitter(min, max) { return min + Math.random() * (max - min); }
function sleep(ms)        { return new Promise(r => setTimeout(r, ms)); }

function syncIntervalHours() {
    return parseInt(process.env.PROTONDB_SYNC_INTERVAL_HOURS ?? String(DEFAULT_TTL_DAYS * 24), 10);
}

// ── API ───────────────────────────────────────────────────────────────────────

// Returns { raw } on a real hit, { notFound: true } on a CONFIRMED not-found,
// and THROWS on a transient failure (429/5xx/network). Distinguishing the two is
// the whole point: a transient error must never be written as a notFound sentinel
// over a good tier (that would freeze the wipe in for the 7/30-day TTL).
async function fetchSummary(appid, fetchFn = fetch) {
    const res = await fetchFn(`${PROTONDB_BASE}/${appid}.json`);
    if (!res.ok) {
        // 429 (rate-limited) and 5xx are transient — signal failure so the caller
        // keeps any good cached entry. A 404 (or other 4xx) is a real unknown appid.
        if (res.status === 429 || res.status >= 500) throw new Error(`ProtonDB HTTP ${res.status}`);
        return { notFound: true };
    }
    const ct = res.headers.get('content-type') ?? '';
    // ProtonDB serves an HTML page (not JSON) for unknown appids — a confirmed 404.
    if (!ct.includes('application/json')) return { notFound: true };
    return { raw: await res.json() };
}

// ── Shape ─────────────────────────────────────────────────────────────────────

export function shapeEntry(appid, raw) {
    if (!raw) return null;
    return {
        appid:             Number(appid),
        tier:              raw.tier              ?? null,
        bestReportedTier:  raw.bestReportedTier  ?? null,
        trendingTier:      raw.trendingTier       ?? null,
        confidence:        raw.confidence         ?? null,
        score:             raw.score              ?? null,
        total:             raw.total              ?? null,
        fetchedAt:         new Date().toISOString(),
    };
}

/**
 * A fingerprint of an entry's compatibility verdict.
 *
 * Only the tiers count as new information. `score` and `total` drift every week
 * as reports trickle in, so treating them as changes would report an "update"
 * for nearly every game on every sync — thousands of records that tell you
 * nothing. A game moving gold → platinum is the thing worth charting.
 */
export function tierSignature(entry) {
    if (!entry) return null;
    return `${entry.tier ?? '-'}|${entry.bestReportedTier ?? '-'}|${entry.trendingTier ?? '-'}`;
}

// ── File I/O ──────────────────────────────────────────────────────────────────

export async function getEntry(appid) {
    try { return JSON.parse(await fs.readFile(entryPath(appid), 'utf8')); }
    catch { return null; }
}

export async function getIndex() {
    try { return JSON.parse(await fs.readFile(indexPath(), 'utf8')); }
    catch { return []; }
}

async function rebuildIndex() {
    let files;
    try { files = await fs.readdir(protondbDir()); } catch { return []; }

    const eligible = files.filter(f => f !== 'index.json' && f.endsWith('.json'));
    const raws     = await mapChunked(eligible, f => fs.readFile(path.join(protondbDir(), f), 'utf8').catch(() => null));

    const index = [];
    for (const raw of raws) {
        if (!raw) continue;
        try {
            const entry = JSON.parse(raw);
            if (entry.tier) {
                index.push({
                    appid:            entry.appid,
                    tier:             entry.tier,
                    bestReportedTier: entry.bestReportedTier,
                    trendingTier:     entry.trendingTier,
                    confidence:       entry.confidence,
                    score:            entry.score,
                    total:            entry.total,
                });
            }
        } catch { /* skip malformed */ }
    }

    await fs.writeFile(indexPath(), JSON.stringify(index, null, 2));
    return index;
}

// ── Core sync ─────────────────────────────────────────────────────────────────

export async function syncOne(appid, { force = false, fetchFn = fetch } = {}) {
    await fs.mkdir(protondbDir(), { recursive: true });

    if (!force) {
        const existing = await getEntry(appid);
        if (existing) {
            const isSettled = SETTLED_TIERS.has(existing.tier);
            const ttlMs     = (isSettled ? SETTLED_TTL_DAYS : DEFAULT_TTL_DAYS) * 24 * 3_600_000;
            const age       = Date.now() - new Date(existing.fetchedAt).getTime();
            if (age < ttlMs) return { skipped: true, entry: existing };
        }
    }

    let result;
    try {
        result = await fetchSummary(appid, fetchFn);
    } catch (err) {
        // Transient upstream failure — keep any existing entry rather than
        // overwriting a good tier with a notFound sentinel.
        logger.warn('[protondb] Fetch failed — keeping cached entry', { appid, err: err.message });
        return { skipped: false, entry: await getEntry(appid) };
    }
    const entry = result.raw
        ? shapeEntry(appid, result.raw)
        : { appid: Number(appid), tier: null, fetchedAt: new Date().toISOString(), notFound: true };

    await fs.writeFile(entryPath(appid), JSON.stringify(entry, null, 2));
    return { skipped: false, entry };
}

export async function syncAll({ force = false, onProgress, fetchFn = fetch } = {}) {
    logger.info('[protondb] Full sync started');
    const games = await getAllGames();
    if (games.length === 0) throw new Error('No games found — run Steam sync first');
    await fs.mkdir(protondbDir(), { recursive: true });

    const intervalMs = syncIntervalHours() * 3_600_000;
    const settledMs  = SETTLED_TTL_DAYS * 24 * 3_600_000;
    let fetched = 0, skipped = 0, notFound = 0, created = 0, updated = 0;

    for (let i = 0; i < games.length; i++) {
        const { appid } = games[i];

        // Read the existing entry unconditionally: the TTL check needs it, and
        // so does the created/updated comparison on a forced sync.
        const existing = await getEntry(appid);

        if (!force && existing) {
            const age       = Date.now() - new Date(existing.fetchedAt).getTime();
            const isSettled = SETTLED_TIERS.has(existing.tier);
            const ttlMs     = isSettled ? settledMs : intervalMs;
            if (age < ttlMs) {
                skipped++;
                if (onProgress) onProgress(i + 1, games.length);
                continue;
            }
        }

        try {
            const result = await fetchSummary(appid, fetchFn);
            if (result.raw) {
                const entry = shapeEntry(appid, result.raw);
                if (!existing || existing.notFound) created++;
                else if (tierSignature(existing) !== tierSignature(entry)) updated++;

                await fs.writeFile(entryPath(appid), JSON.stringify(entry, null, 2));
                fetched++;
            } else {
                // Confirmed not-found (404 / HTML page) — safe to write the sentinel.
                await fs.writeFile(entryPath(appid), JSON.stringify({ appid, tier: null, fetchedAt: new Date().toISOString(), notFound: true }, null, 2));
                notFound++;
            }
        } catch (err) {
            // Transient (429/5xx/network) — DON'T overwrite a good entry with a
            // notFound sentinel; leave the cache untouched so the next sync retries.
            logger.warn('[protondb] Fetch failed — keeping cached entry', { appid, err: err.message });
        }

        if (onProgress) onProgress(i + 1, games.length);
        if (i < games.length - 1) await sleep(jitter(MIN_DELAY_MS, MAX_DELAY_MS));
    }

    await rebuildIndex();
    logger.info('[protondb] Full sync complete', { fetched, created, updated, skipped, notFound, total: games.length });
    return { fetched, created, updated, skipped, notFound, total: games.length };
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

export function startProtonDbScheduler() {
    const hours = syncIntervalHours();
    const ms    = hours * 3_600_000;
    logger.info('[protondb] Sync scheduler started', { intervalHours: hours });

    setInterval(() => {
        tracked('protondb', () => syncAll()).catch(err => logger.error('[protondb] Scheduled sync failed', err));
    }, ms);
}
