// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/steam/achievement-schema-scraper.test.js
// (node:test → vitest). Contract tests — behavior must match the relay exactly.
// Every scrape call injects htmlFn, so no real Puppeteer browser is launched.
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

const { scrapeAchievementSchema, parseAchievementHtml } =
    await import('../../../lib/server/relay/steam/achievement-schema-scraper.js');

// ── Realistic sample HTML (trimmed to the parts that matter) ──────────────────

const SAMPLE_HTML = `
<!DOCTYPE html>
<html>
<body>
<div id="mainContents">
  <div class="achieveRow   ">
    <div class="achieveImgHolder">
      <img src="https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/1245620/abc123.jpg" border="0">
    </div>
    <div class="achieveTxt">
      <h3>Roundtable Hold</h3>
      <h5>Arrived at Roundtable Hold.</h5>
      <div class="achievePercent">75.2%</div>
    </div>
  </div>
  <div class="achieveRow">
    <div class="achieveImgHolder">
      <img src="https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/1245620/def456.jpg" border="0">
    </div>
    <div class="achieveTxt">
      <h3>Margit, the Fell Omen</h3>
      <h5>Defeated Margit, the Fell Omen.</h5>
      <div class="achievePercent">71.1%</div>
    </div>
  </div>
  <div class="achieveRow">
    <div class="achieveImgHolder">
      <img src="https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/1245620/ghi789.jpg" border="0">
    </div>
    <div class="achieveTxt">
      <h3>Hidden Achievement</h3>
      <!-- no h5 — hidden achievement has no description on the global page -->
    </div>
  </div>
  <div class="achieveRow">
    <div class="achieveImgHolder">
      <img src="https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/1245620/ent999.jpg" border="0">
    </div>
    <div class="achieveTxt">
      <h3>Rocks &amp; Runes</h3>
      <h5>Used a &#39;Great Rune&#39; &amp; survived.</h5>
    </div>
  </div>
</div>
</body>
</html>
`;

const EMPTY_HTML = `
<!DOCTYPE html>
<html><body>
<div id="mainContents">
  <p>No stats available for this game.</p>
</div>
</body></html>
`;

// ── parseAchievementHtml — pure parsing, no network ───────────────────────────

describe('parseAchievementHtml', () => {
    it('returns one entry per achieveRow with name, description, and icon', () => {
        const rows = parseAchievementHtml(SAMPLE_HTML);
        assert.equal(rows.length, 4);
    });

    it('extracts display name from <h3>', () => {
        const rows = parseAchievementHtml(SAMPLE_HTML);
        assert.equal(rows[0].displayName, 'Roundtable Hold');
        assert.equal(rows[1].displayName, 'Margit, the Fell Omen');
    });

    it('extracts description from <h5>', () => {
        const rows = parseAchievementHtml(SAMPLE_HTML);
        assert.equal(rows[0].description, 'Arrived at Roundtable Hold.');
        assert.equal(rows[1].description, 'Defeated Margit, the Fell Omen.');
    });

    it('returns empty string for description when <h5> is absent (hidden achievement)', () => {
        const rows = parseAchievementHtml(SAMPLE_HTML);
        assert.equal(rows[2].displayName, 'Hidden Achievement');
        assert.equal(rows[2].description, '');
    });

    it('extracts icon URL from <img src>', () => {
        const rows = parseAchievementHtml(SAMPLE_HTML);
        assert.ok(rows[0].icon.includes('abc123.jpg'));
        assert.ok(rows[1].icon.includes('def456.jpg'));
    });

    it('decodes HTML entities in display name and description', () => {
        const rows = parseAchievementHtml(SAMPLE_HTML);
        assert.equal(rows[3].displayName, "Rocks & Runes");
        assert.equal(rows[3].description, "Used a 'Great Rune' & survived.");
    });

    it('returns empty array when HTML has no achieveRow divs', () => {
        const rows = parseAchievementHtml(EMPTY_HTML);
        assert.equal(rows.length, 0);
    });

    it('returns empty array for empty string input', () => {
        assert.equal(parseAchievementHtml('').length, 0);
    });

    it('tolerates extra whitespace/classes on achieveRow opening tag', () => {
        // First row in SAMPLE_HTML has "achieveRow   " (trailing spaces)
        const rows = parseAchievementHtml(SAMPLE_HTML);
        assert.ok(rows.length > 0, 'should parse despite extra whitespace in class');
    });
});

// ── scrapeAchievementSchema — network wrapper ─────────────────────────────────
// Uses the htmlFn injection point so no real Puppeteer browser is launched.

describe('scrapeAchievementSchema', () => {
    it('calls htmlFn with the community stats URL and returns parsed rows', async () => {
        let capturedUrl = null;
        const rows = await scrapeAchievementSchema(1245620, {
            htmlFn: async (url) => { capturedUrl = url; return SAMPLE_HTML; },
        });
        assert.equal(rows.length, 4);
        assert.equal(rows[0].displayName, 'Roundtable Hold');
        assert.ok(capturedUrl.includes('1245620'), 'URL should contain the appid');
        assert.ok(capturedUrl.includes('steamcommunity.com/stats'));
    });

    it('returns empty array when htmlFn returns null (non-200 equivalent)', async () => {
        const rows = await scrapeAchievementSchema(99999, {
            htmlFn: async () => null,
        });
        assert.equal(rows.length, 0);
    });

    it('returns empty array when htmlFn throws (network error)', async () => {
        const rows = await scrapeAchievementSchema(1245620, {
            htmlFn: async () => { throw new Error('net::ERR_CONNECTION_REFUSED'); },
        });
        assert.equal(rows.length, 0);
    });

    it('returns empty array when page has no achievement rows', async () => {
        const rows = await scrapeAchievementSchema(1245620, {
            htmlFn: async () => EMPTY_HTML,
        });
        assert.equal(rows.length, 0);
    });
});
