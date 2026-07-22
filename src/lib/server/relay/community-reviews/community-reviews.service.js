// Ported verbatim from relay-server src/services/steam/community-reviews.service.js
// (docs/relay-fold-in.md §6 — logic byte-identical; only imports + data-dir
// helpers rewritten). Data stays under the steam feature dir:
// $RELAY_DATA_ROOT/steam/community-reviews — same on-disk paths as the relay.
//
// NOTE: getIndex() serves the in-memory index that build() populates. The relay
// calls build() unconditionally in server.js's listen callback; boot.js must do
// the same or the index route serves [].
import path from 'node:path';
import fs from 'node:fs/promises';
import logger from '../../logger.js';
import { register } from '../shared/cache-manager.js';
import { mapChunked } from '../shared/map-chunked.js';
import { featureDir } from '../shared/data-root.js';
import { createPersistedIndex } from '../shared/persisted-index.js';

const TARGET_REVIEWS    = 100;
const RECHECK_NORMAL_MS = 7  * 24 * 60 * 60 * 1_000;  // 7 days  — has reviews, not yet at target
const RECHECK_SPARSE_MS = 30 * 24 * 60 * 60 * 1_000;  // 30 days — very few reviews on Steam
const RECHECK_EMPTY_MS  = 60 * 24 * 60 * 60 * 1_000;  // 60 days — no reviews at all
const SPARSE_THRESHOLD  = 10;
const API_BASE          = 'https://store.steampowered.com/appreviews';

function dir()          { return path.join(featureDir('steam'), 'community-reviews'); }
function entryPath(id)  { return path.join(dir(), `${id}.json`); }

async function readJson(p) {
    try { return JSON.parse(await fs.readFile(p, 'utf8')); }
    catch { return null; }
}

async function writeJson(p, data) {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, JSON.stringify(data), 'utf8');
}

function shouldSkip(cached, force) {
    if (force || !cached) return false;
    // Satisfied — we have what we need
    if (cached.reviewCount >= TARGET_REVIEWS) return true;
    const age = Date.now() - new Date(cached.checkedAt).getTime();
    if (cached.totalReviews === 0)              return age < RECHECK_EMPTY_MS;
    if (cached.totalReviews < SPARSE_THRESHOLD) return age < RECHECK_SPARSE_MS;
    return age < RECHECK_NORMAL_MS;
}

async function steamFetch(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (!body.success) throw new Error('Steam returned success=0');
    return body;
}

function shapeReview(r) {
    return {
        id:           r.recommendationid,
        votedUp:      r.voted_up,
        postedAt:     new Date(r.timestamp_created * 1000).toISOString(),
        hoursAtReview: Math.round((r.author?.playtime_at_review ?? 0) / 60 * 10) / 10,
        hoursTotal:   Math.round((r.author?.playtime_forever    ?? 0) / 60 * 10) / 10,
        votesUp:      r.votes_up      ?? 0,
        votesFunny:   r.votes_funny   ?? 0,
        commentCount: r.comment_count ?? 0,
        earlyAccess:  r.written_during_early_access ?? false,
        text:         r.review ?? '',
    };
}

export async function syncGame(appid, { force = false } = {}) {
    const cached = await readJson(entryPath(appid));
    if (shouldSkip(cached, force)) return { skipped: true, appid };

    const checkedAt = new Date().toISOString();

    // Call 1: unfiltered summary (num_per_page=0 — no review text, just counts)
    const summaryBody = await steamFetch(
        `${API_BASE}/${appid}?json=1&filter=all&language=all&purchase_type=all&num_per_page=0`
    );
    // A success:1 response with no query_summary is a transient/partial answer
    // (Steam occasionally omits it under load). Treating it as 0 reviews would
    // overwrite a good 100-review snapshot with an empty one — skip and keep prior.
    if (!summaryBody.query_summary) {
        logger.warn('[community-reviews] Missing query_summary — keeping cached entry', { appid });
        return { skipped: true, appid };
    }
    const qs           = summaryBody.query_summary;
    const totalReviews  = qs.total_reviews  ?? 0;
    const totalPositive = qs.total_positive ?? 0;
    const totalNegative = qs.total_negative ?? 0;
    const scoreDesc     = qs.review_score_desc ?? null;

    const base = {
        appid, checkedAt, totalReviews, reviewCount: 0,
        summary: {
            totalPositive, totalNegative, scoreDesc,
            ratio: totalReviews > 0 ? Math.round(totalPositive / totalReviews * 1000) / 10 : null,
        },
        reviews: [],
    };

    // The record here is a game's review snapshot: created when we first track
    // the game, updated when Steam's review total has actually moved. Rewriting
    // an entry whose totals are unchanged is not new information.
    const isNew     = !cached;
    const hasChanged = Boolean(cached) && cached.totalReviews !== totalReviews;

    if (totalReviews === 0) {
        await writeJson(entryPath(appid), base);
        return { appid, totalReviews: 0, reviewCount: 0, isNew, hasChanged };
    }

    // Call 2: top 100 English reviews
    const reviewsBody = await steamFetch(
        `${API_BASE}/${appid}?json=1&filter=top&language=english&purchase_type=all&num_per_page=100&filter_offtopic_activity=1`
    );
    const reviews = (reviewsBody.reviews ?? []).map(shapeReview);

    // An empty reviews array here can be a transient 200 (or a language quirk pushing English
    // reviews out of the window) — don't blank the cached review text. Refresh the summary (base)
    // but retain the prior reviews when the new pull is empty.
    const entry = (reviews.length === 0 && (cached?.reviews?.length ?? 0) > 0)
        ? { ...base, reviewCount: cached.reviewCount ?? cached.reviews.length, reviews: cached.reviews }
        : { ...base, reviewCount: reviews.length, reviews };
    await writeJson(entryPath(appid), entry);

    logger.debug('[community-reviews] Synced', { appid, totalReviews, reviewCount: reviews.length });
    return { appid, totalReviews, reviewCount: reviews.length, isNew, hasChanged };
}

/**
 * @param {object}   [opts]
 * @param {boolean}  [opts.force]      - Bypass the recheck-window skip.
 * @param {Function} [opts.onProgress] - Called as (done, total) after each game.
 */
export async function syncAll({ force = false, onProgress } = {}) {
    const [gamesData, wishData] = await Promise.all([
        readJson(path.join(featureDir('steam'), 'games.json')),
        readJson(path.join(featureDir('steam'), 'wishlist.json')),
    ]);
    const owned = Array.isArray(gamesData) ? gamesData : (gamesData?.games ?? []);
    const wish  = Object.keys(wishData?.items ?? {}).map(id => ({ appid: Number(id) }));
    const seen  = new Set(owned.map(g => g.appid));
    const games = [...owned, ...wish.filter(w => !seen.has(w.appid))];

    let done = 0, failed = 0, fetched = 0, skipped = 0, created = 0, updated = 0;

    for (const game of games) {
        try {
            const result = await syncGame(game.appid, { force });
            if (result.skipped) {
                skipped++;
            } else {
                fetched++;
                if (result.isNew)      created++;
                if (result.hasChanged) updated++;
                // 2 API calls were made — pace to ~1 req/sec per call
                await new Promise(r => setTimeout(r, 1500 + Math.random() * 500));
            }
        } catch (err) {
            failed++;
            logger.warn('[community-reviews] Failed', { appid: game.appid, err: err.message });
            await new Promise(r => setTimeout(r, 3000));
        }
        done++;
        if (onProgress) onProgress(done, games.length);
    }

    logger.info('[community-reviews] Sync complete', { total: games.length, fetched, created, updated, skipped, failed });
    return { fetched, created, updated, skipped, failed, total: games.length };
}

export async function getEntry(appid) {
    return readJson(entryPath(Number(appid)));
}

// ── In-memory index (summaries only — no review text) ────────────────────────
//
// Fast-boot: the index is persisted to a sidecar so boot() loads it in one read
// instead of re-scanning every per-game file (see shared/persisted-index.js).
// The sidecar lives OUTSIDE dir() so the scan below never picks it up.

function indexFile() { return path.join(featureDir('steam'), 'community-reviews-index.json'); }

// The slow scan — reads every cached entry and returns the summary index array.
async function scanIndex() {
    let files;
    try { files = await fs.readdir(dir()); }
    catch (err) { if (err.code === 'ENOENT') return []; throw err; }

    const eligible = files.filter(f => f.endsWith('.json'));
    const entries  = await mapChunked(eligible, async f => {
        const d = await readJson(path.join(dir(), f));
        if (!d) return null;
        return {
            appid:        d.appid,
            checkedAt:    d.checkedAt,
            totalReviews: d.totalReviews,
            reviewCount:  d.reviewCount,
            summary:      d.summary,
        };
    });
    return entries.filter(Boolean);
}

const _idx = createPersistedIndex({ name: 'community-reviews', file: indexFile, rebuild: scanIndex });

/** Fast boot: load the persisted sidecar, then refresh in the background. */
export async function boot() { await _idx.boot(); }

/** Full rebuild + persist. Registered with cache-manager (post-sync refresh). */
export async function build() { await _idx.refresh(); }

export function getIndex()     { return _idx.get(); }
export function getIndexMeta() { return _idx.meta(); }
export async function ensureIndex() { await _idx.ensureLoaded(); }

register('community-reviews', build);
