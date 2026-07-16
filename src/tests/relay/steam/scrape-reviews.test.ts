// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/steam/scrape-reviews.test.js (node:test → vitest).
// Contract tests — pure HTML-parser coverage over byte-identical copies of the
// relay's real-page fixtures (fixtures/scrape-reviews-p1.html, -p2.html).
//
// The original never touches disk (parsers only), but the module under test
// imports steam.service — point DATA_DIR at a temp dir anyway so nothing can
// ever reach the NAS (.env's DATA_DIR), per the ported-test conventions.
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'gj-relay-scrape-reviews-test-'));
delete process.env.RELAY_DATA_ROOT;

const {
    parseTotalEntries,
    parseReviewsPage,
    parseReviewBlock,
    detectDrift,
} = await import('../../../lib/server/relay/steam/scrape-reviews.service.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, 'fixtures');

const p1Html = await fs.readFile(path.join(fixtureDir, 'scrape-reviews-p1.html'), 'utf8');
const p2Html = await fs.readFile(path.join(fixtureDir, 'scrape-reviews-p2.html'), 'utf8');

// ── parseTotalEntries ─────────────────────────────────────────────────────────

describe('parseTotalEntries', () => {
    it('extracts the total review count from a real page', () => {
        assert.equal(parseTotalEntries(p1Html), 153);
    });

    it('returns null when the "Showing X-Y of Z entries" text is absent', () => {
        assert.equal(parseTotalEntries('<html>no entries here</html>'), null);
    });

    it('returns null on an empty string', () => {
        assert.equal(parseTotalEntries(''), null);
    });
});

// ── parseReviewsPage ──────────────────────────────────────────────────────────

describe('parseReviewsPage', () => {
    it('parses exactly 10 reviews from page 1', () => {
        const reviews = parseReviewsPage(p1Html);
        assert.equal(reviews.length, 10);
    });

    it('parses exactly 10 reviews from page 2', () => {
        const reviews = parseReviewsPage(p2Html);
        assert.equal(reviews.length, 10);
    });

    it('returns an empty array for a page with no review_box elements', () => {
        assert.deepEqual(parseReviewsPage('<html>nothing</html>'), []);
    });

    it('every review has a numeric appid', () => {
        for (const r of parseReviewsPage(p1Html)) {
            assert.ok(Number.isInteger(r.appid) && r.appid > 0, `bad appid: ${r.appid}`);
        }
    });

    it('every review has a voted_up boolean', () => {
        for (const r of parseReviewsPage(p1Html)) {
            assert.equal(typeof r.review.voted_up, 'boolean');
        }
    });

    it('page 1 has 8 thumbs-up and 2 thumbs-down', () => {
        const reviews = parseReviewsPage(p1Html);
        const ups   = reviews.filter(r => r.review.voted_up).length;
        const downs = reviews.filter(r => !r.review.voted_up).length;
        assert.equal(ups,   8);
        assert.equal(downs, 2);
    });

    it('all appids on page 1 are distinct', () => {
        const reviews = parseReviewsPage(p1Html);
        const ids     = reviews.map(r => r.appid);
        assert.equal(new Set(ids).size, ids.length);
    });
});

// ── parseReviewBlock — first review (appid 3321460) ───────────────────────────

describe('parseReviewBlock — first review on page 1', () => {
    // Slice out the first review_box block from the fixture
    const marker = 'class="review_box"';
    const start  = p1Html.indexOf(marker);
    const next   = p1Html.indexOf(marker, start + marker.length);
    const block  = p1Html.slice(start, next);

    it('extracts appid 3321460', () => {
        const r = parseReviewBlock(block);
        assert.equal(r.appid, 3321460);
    });

    it('extracts voted_up = true (thumbs up)', () => {
        const r = parseReviewBlock(block);
        assert.equal(r.review.voted_up, true);
    });

    it('extracts hours at review (2.5 hrs → 150 min)', () => {
        const r = parseReviewBlock(block);
        assert.equal(r.review.author.playtime_at_review, 150);
    });

    it('extracts review text and strips HTML tags', () => {
        const r = parseReviewBlock(block);
        assert.ok(r.review.review.includes("Picked up a cat"));
        assert.ok(!r.review.review.includes('<br>'), 'should not contain raw <br> tags');
    });

    it('converts <br> tags to newlines in review text', () => {
        const r = parseReviewBlock(block);
        assert.ok(r.review.review.includes('\n'));
    });

    it('produces a numeric unix timestamp for the posted date', () => {
        const r = parseReviewBlock(block);
        assert.ok(Number.isInteger(r.review.timestamp_created));
        assert.ok(r.review.timestamp_created > 0);
    });

    it('votes_up is 0 (no one rated this review helpful)', () => {
        const r = parseReviewBlock(block);
        assert.equal(r.review.votes_up, 0);
    });

    it('written_during_early_access defaults to false', () => {
        const r = parseReviewBlock(block);
        assert.equal(r.review.written_during_early_access, false);
    });
});

// ── parseReviewBlock — thumbs-down review (appid 2868840) ────────────────────

describe('parseReviewBlock — second review on page 1 (thumbs down)', () => {
    const marker  = 'class="review_box"';
    const starts  = [];
    let   pos     = 0;
    while (true) {
        const idx = p1Html.indexOf(marker, pos);
        if (idx === -1) break;
        starts.push(idx);
        pos = idx + marker.length;
    }
    // Second block
    const block = p1Html.slice(starts[1], starts[2]);

    it('extracts appid 2868840', () => {
        const r = parseReviewBlock(block);
        assert.equal(r.appid, 2868840);
    });

    it('extracts voted_up = false (thumbs down)', () => {
        const r = parseReviewBlock(block);
        assert.equal(r.review.voted_up, false);
    });
});

// ── parseReviewBlock — dated review with a year (appid 1285190) ──────────────

describe('parseReviewBlock — review with explicit year in date', () => {
    const marker = 'class="review_box"';
    const starts = [];
    let   pos    = 0;
    while (true) {
        const idx = p1Html.indexOf(marker, pos);
        if (idx === -1) break;
        starts.push(idx);
        pos = idx + marker.length;
    }
    // Third block — "September 30, 2025"
    const block = p1Html.slice(starts[2], starts[3]);

    it('extracts appid 1285190', () => {
        assert.equal(parseReviewBlock(block).appid, 1285190);
    });

    it('parses year-qualified date to correct unix timestamp', () => {
        const r         = parseReviewBlock(block);
        const asDate    = new Date(r.review.timestamp_created * 1000);
        assert.equal(asDate.getFullYear(), 2025);
        assert.equal(asDate.getMonth(),    8); // 0-indexed → September
    });
});

// ── parseReviewBlock — edge cases ─────────────────────────────────────────────

describe('parseReviewBlock — edge cases', () => {
    it('returns null when no appid link is present', () => {
        assert.equal(parseReviewBlock('<div class="review_box">no app link here</div>'), null);
    });

    it('handles "< 1 hrs at review time" without NaN', () => {
        const fakeBlock = `
            class="review_box"
            <a href="https://steamcommunity.com/app/12345">
            <img src="icon_thumbsUp.png">
            <div class="content ">Short game</div>
            <div class="hours">(< 1 hrs at review time)</div>
            <div class="posted">Posted January 1, 2022.</div>
        `;
        const r = parseReviewBlock(fakeBlock);
        assert.ok(r !== null);
        assert.ok(r.review.author.playtime_at_review != null);
        assert.ok(!isNaN(r.review.author.playtime_at_review));
    });

    it('decodes HTML entities in review text', () => {
        const fakeBlock = `
            class="review_box"
            <a href="https://steamcommunity.com/app/99999">
            <img src="icon_thumbsUp.png">
            <div class="content ">It&#39;s great &amp; fun &lt;3</div>
            <div class="posted">Posted June 1, 2023.</div>
        `;
        const r = parseReviewBlock(fakeBlock);
        assert.equal(r.review.review, "It's great & fun <3");
    });

    it('parses helpful vote count correctly', () => {
        const fakeBlock = `
            class="review_box"
            <a href="https://steamcommunity.com/app/77777">
            <img src="icon_thumbsUp.png">
            <div class="content ">Good</div>
            <div class="posted">Posted March 1, 2023.</div>
            <div class="header">26 people found this review helpful</div>
        `;
        const r = parseReviewBlock(fakeBlock);
        assert.equal(r.review.votes_up, 26);
    });
});

// ── detectDrift ───────────────────────────────────────────────────────────────

describe('detectDrift', () => {
    const goodReviews = parseReviewsPage(p1Html);

    it('returns no warnings for a clean page-1 parse', () => {
        assert.deepEqual(detectDrift(goodReviews, 10), []);
    });

    it('warns when a review block has no appid', () => {
        const broken = [{ appid: 0, review: { voted_up: true, review: 'text', author: { playtime_at_review: 60 }, timestamp_created: 1700000000, votes_up: 0, written_during_early_access: false } }];
        const warnings = detectDrift(broken, 1);
        assert.ok(warnings.some(w => w.includes('no appid')));
    });

    it('warns when all reviews are missing timestamps', () => {
        const noDate = goodReviews.map(r => ({
            ...r,
            review: { ...r.review, timestamp_created: null },
        }));
        const warnings = detectDrift(noDate, 10);
        assert.ok(warnings.some(w => w.includes('no parseable date')));
    });

    it('warns when all reviews have empty text', () => {
        const noText = goodReviews.map(r => ({
            ...r,
            review: { ...r.review, review: '' },
        }));
        const warnings = detectDrift(noText, 10);
        assert.ok(warnings.some(w => w.includes('empty text')));
    });

    it('warns when all reviews are missing hours (possible selector change)', () => {
        const noHours = goodReviews.map(r => ({
            ...r,
            review: { ...r.review, author: { playtime_at_review: null } },
        }));
        const warnings = detectDrift(noHours, 10);
        assert.ok(warnings.some(w => w.includes('hours-at-review')));
    });

    it('returns no warnings for an empty review list (graceful empty page)', () => {
        assert.deepEqual(detectDrift([], null), []);
    });
});
