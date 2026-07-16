// Ported verbatim from relay-server src/services/steam/scrape-reviews.service.js
// (docs/relay-fold-in.md §6 — logic byte-identical; only the logger import path
// changed; steam.service import stays same-directory).
import logger from '../../logger.js';
import { getGames, getReviewsFile } from './steam.service.js';

const COMMUNITY_BASE   = 'https://steamcommunity.com';
const REVIEWS_PER_PAGE = 10;
const PAGE_DELAY_MS    = 1_500; // polite delay between pages

// ── HTML helpers ──────────────────────────────────────────────────────────────

function decodeEntities(str) {
    return str
        .replace(/&amp;/g,  '&')
        .replace(/&lt;/g,   '<')
        .replace(/&gt;/g,   '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g,  "'")
        .replace(/&nbsp;/g, ' ');
}

function cleanReviewText(html) {
    return decodeEntities(
        html
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .trim()
    );
}

// ── Parse one review_box block ────────────────────────────────────────────────
// Exported so unit tests can verify individual field parsing.

export function parseReviewBlock(block) {
    // appid from the app link e.g. steamcommunity.com/app/3321460
    const appidMatch = block.match(/steamcommunity\.com\/app\/(\d+)/);
    if (!appidMatch) return null;
    const appid = Number(appidMatch[1]);

    // voted_up
    const votedUp = block.includes('icon_thumbsUp.png');

    // review text — class is "content " (trailing space) on some entries
    const contentMatch = block.match(/<div class="content[^"]*">([\s\S]*?)<\/div>/);
    const reviewText   = contentMatch ? cleanReviewText(contentMatch[1]) : '';

    // playtime at review: "(2.5 hrs at review time)" or "(< 1 hrs at review time)"
    const hoursMatch       = block.match(/\(([<\d.,\s]+?)\s+hrs?\s+at review time\)/);
    let   playtimeAtReview = null;
    if (hoursMatch) {
        const raw = hoursMatch[1].replace(/[<,\s]/g, '');
        const hrs = parseFloat(raw);
        if (!isNaN(hrs)) playtimeAtReview = Math.round(hrs * 60);
    }

    // posted date: "Posted April 5, 2019." or "Posted March 19."
    const postedMatch = block.match(/Posted\s+([\w\s,]+?)\s*\./);
    let   timestampCreated = null;
    if (postedMatch) {
        const dateStr = postedMatch[1].trim();
        const hasYear = /\d{4}/.test(dateStr);
        const toParse = hasYear ? dateStr : `${dateStr}, ${new Date().getFullYear()}`;
        const parsed  = new Date(toParse);
        if (!isNaN(parsed.getTime())) timestampCreated = Math.floor(parsed.getTime() / 1_000);
    }

    // helpful votes: "2 people found this review helpful" (0 if absent)
    const helpfulMatch = block.match(/(\d+)\s+people?\s+found\s+this\s+review\s+helpful/);
    const votesUp      = helpfulMatch ? Number(helpfulMatch[1]) : 0;

    return {
        appid,
        review: {
            voted_up:                    votedUp,
            review:                      reviewText,
            author:                      { playtime_at_review: playtimeAtReview },
            timestamp_created:           timestampCreated,
            votes_up:                    votesUp,
            written_during_early_access: false, // not exposed on the profile page
        },
    };
}

// ── Split HTML into per-review blocks ─────────────────────────────────────────
// Exported for unit testing.

export function parseReviewsPage(html) {
    const results = [];
    const marker  = 'class="review_box"';
    let   pos     = 0;

    while (true) {
        const start = html.indexOf(marker, pos);
        if (start === -1) break;

        const next  = html.indexOf(marker, start + marker.length);
        const block = next === -1 ? html.slice(start) : html.slice(start, next);

        const parsed = parseReviewBlock(block);
        if (parsed) results.push(parsed);

        if (next === -1) break;
        pos = next;
    }

    return results;
}

// ── Parse "Showing 1-10 of 153 entries" ──────────────────────────────────────
// Exported for unit testing.

export function parseTotalEntries(html) {
    const m = html.match(/Showing\s+\d+-\d+\s+of\s+(\d+)\s+entries/);
    return m ? Number(m[1]) : null;
}

// ── Drift detection ───────────────────────────────────────────────────────────
// Checks whether parsed results look structurally complete.
// Returns a warnings array — empty means no issues detected.

export function detectDrift(reviews, expectedTotal) {
    const warnings = [];

    const missingAppid     = reviews.filter(r => !r.appid).length;
    const missingTimestamp = reviews.filter(r => r.review.timestamp_created == null).length;
    const missingHours     = reviews.filter(r => r.review.author.playtime_at_review == null).length;
    const emptyText        = reviews.filter(r => !r.review.review).length;
    const missingThumb     = reviews.filter(r => !r.review.voted_up && !r.review.review).length;

    if (missingAppid > 0)
        warnings.push(`${missingAppid} review block(s) had no appid — app link selector may have changed`);

    if (missingTimestamp > 0)
        warnings.push(`${missingTimestamp} review(s) had no parseable date — "Posted" text format may have changed`);

    // Hours at review is optional (not all reviews show it), so only warn if ALL are missing
    if (reviews.length > 0 && missingHours === reviews.length)
        warnings.push(`No reviews had hours-at-review — hours selector may have changed`);

    if (emptyText > 0)
        warnings.push(`${emptyText} review(s) had empty text — content div selector may have changed`);

    if (expectedTotal != null && reviews.length > 0) {
        const lastPageRemainder = expectedTotal % REVIEWS_PER_PAGE;
        const isLastPage        = reviews.length === (lastPageRemainder || REVIEWS_PER_PAGE);
        const fullPage          = reviews.length === REVIEWS_PER_PAGE;
        if (!fullPage && !isLastPage)
            warnings.push(`Expected ${REVIEWS_PER_PAGE} reviews per page but got ${reviews.length} — pagination may have changed`);
    }

    return warnings;
}

// ── Incremental check (runs on the 30-min tick) ───────────────────────────────
// Fetches only page 1 (most-recent reviews first) and stops as soon as it
// encounters a review that is already cached.  In steady state this costs
// exactly one HTTP request and writes nothing.

export async function incrementalScrapeReviews() {
    const vanityUrl = process.env.STEAM_VANITY_URL;
    if (!vanityUrl) return { added: 0 }; // not configured — skip silently

    const gamesData = await getGames();
    const nameMap = new Map((gamesData.games ?? []).map(g => [g.appid, g.name]));

    const reviewFile = await getReviewsFile();
    const cache   = reviewFile.get();
    const updates = {};

    let page  = 1;
    let added = 0;
    let done  = false;

    while (!done) {
        const url = `${COMMUNITY_BASE}/id/${vanityUrl}/reviews?p=${page}`;
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; gaming-journal-relay/1.0)' },
        });

        if (!res.ok) {
            logger.warn(`[steam] Incremental review scrape failed on page ${page}: HTTP ${res.status}`);
            break;
        }

        const reviews = parseReviewsPage(await res.text());

        if (reviews.length === 0) break;

        for (const { appid, review } of reviews) {
            const existing = cache[appid];

            // Reviews are sorted most-recent-first across all pages.
            // The moment we hit one already cached, everything after is older
            // and also cached — stop paginating.
            //
            // Compare against _scraperTs (day-precision timestamp stored by this
            // service) rather than the review's timestamp_created, which may have
            // been overwritten with an API-exact timestamp by syncReviews() and
            // would never match the HTML-parsed day-level value.
            const scraperTs = existing?._scraperTs ?? existing?.review?.timestamp_created;
            if (existing?.review != null
                && scraperTs           === review.timestamp_created
                && existing.review.voted_up === review.voted_up) {
                done = true;
                break;
            }

            const gameName = nameMap.get(appid) ?? existing?.gameName ?? `App ${appid}`;
            updates[appid] = {
                ...existing,
                fetchedAt:  new Date().toISOString(),
                gameName,
                review,
                _scraperTs: review.timestamp_created,
            };
            added++;
            logger.info(`[steam] New review cached: ${review.voted_up ? 'RECOMMENDED' : 'NOT RECOMMENDED'} ${gameName}`);
        }

        if (!done) {
            page++;
            await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
        }
    }

    if (added > 0) {
        await reviewFile.set({ ...reviewFile.get(), ...updates });
        await reviewFile.flush();
        logger.info(`[steam] Incremental review scrape: ${added} new review(s) added across ${page} page(s)`);
    }

    return { added, pages: page };
}

// ── Full scrape (manual trigger) ──────────────────────────────────────────────

export async function scrapeUserReviews({ force = false } = {}) {
    const vanityUrl = process.env.STEAM_VANITY_URL;
    if (!vanityUrl) throw new Error('STEAM_VANITY_URL is not set in .env');

    const gamesData = await getGames();
    const nameMap = new Map((gamesData.games ?? []).map(g => [g.appid, g.name]));

    const reviewFile = await getReviewsFile();

    let page          = 1;
    let totalEntries  = null;
    let totalPages    = null;
    let scraped       = 0;
    let updated       = 0;
    let skipped       = 0;
    const allWarnings = [];

    while (true) {
        const url = `${COMMUNITY_BASE}/id/${vanityUrl}/reviews?p=${page}`;
        logger.info(`[steam] Scraping reviews page ${page}${totalPages ? `/${totalPages}` : ''}`);

        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; gaming-journal-relay/1.0)' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching reviews page ${page}`);
        const html = await res.text();

        if (page === 1) {
            totalEntries = parseTotalEntries(html);
            if (totalEntries != null) {
                totalPages = Math.ceil(totalEntries / REVIEWS_PER_PAGE);
                logger.info(`[steam] ${totalEntries} reviews across ${totalPages} pages`);
            } else {
                logger.warn('[steam] Could not find total entries count — HTML format may have changed');
                allWarnings.push('Could not parse total entries count from page 1 — "Showing X-Y of Z entries" text missing');
            }
        }

        const reviews = parseReviewsPage(html);

        // Drift check per page
        const warnings = detectDrift(reviews, totalEntries != null ? Math.min(REVIEWS_PER_PAGE, totalEntries - (page - 1) * REVIEWS_PER_PAGE) : null);
        if (warnings.length > 0) {
            warnings.forEach(w => logger.warn(`[steam] ⚠ Format drift on page ${page}: ${w}`));
            allWarnings.push(...warnings.map(w => `page ${page}: ${w}`));
        }

        if (reviews.length === 0) {
            logger.info(`[steam] No reviews found on page ${page} — stopping`);
            break;
        }

        const current = reviewFile.get();
        const updates = { ...current };

        for (const { appid, review } of reviews) {
            scraped++;
            const existing = current[appid];

            // Skip unchanged entries unless forced.
            // Use _scraperTs (day-precision HTML value) not timestamp_created, which
            // may have been overwritten with an exact API value by syncReviews().
            const scraperTs = existing?._scraperTs ?? existing?.review?.timestamp_created;
            if (!force && existing?.review != null
                && scraperTs                === review.timestamp_created
                && existing.review.voted_up === review.voted_up) {
                skipped++;
                continue;
            }

            const gameName = nameMap.get(appid) ?? existing?.gameName ?? `App ${appid}`;
            updates[appid] = {
                fetchedAt:  new Date().toISOString(),
                gameName,
                review,
                _scraperTs: review.timestamp_created,
            };
            updated++;
            logger.info(`[steam] [${page}/${totalPages ?? '?'}] ${review.voted_up ? 'RECOMMENDED    ' : 'NOT RECOMMENDED'} ${gameName}`);
        }

        await reviewFile.set(updates);

        if (totalPages != null && page >= totalPages) break;
        page++;

        await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    }

    await reviewFile.flush();

    if (allWarnings.length > 0) {
        logger.warn('[steam] Reviews scrape finished with format warnings', { warnings: allWarnings });
    }

    logger.info('[steam] Reviews scrape complete', { scraped, updated, skipped, pages: page });
    return { scraped, updated, skipped, pages: page, warnings: allWarnings };
}
