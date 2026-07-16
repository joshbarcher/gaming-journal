// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/pcgw/pcgw.test.js and the fixture-free
// suites of src/tests/pcgw/pcgw.parser.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified).
//
// The relay's remaining parser suites exercise six saved full-page fixtures
// (~1.2 MB of HTML under src/tests/pcgw/files/) — not ported here; see the
// fold-in wave notes if that corpus is wanted later.
//
// DATA_DIR must point at a temp dir, never the NAS (.env's DATA_DIR). The
// service reads env at call time via featureDir(), so module-scope assignment
// is safe despite import hoisting. No Puppeteer browser is ever launched:
// every sync call injects fetchFn/htmlFn (PUPPETEER_SKIP_DOWNLOAD environments
// stay green).
//
// NOTE: syncAll sleeps a real 2–4s jitter between network games (byte-identical
// port; the pause does not go through shared/rate-limit.js) — the two tests
// that hit the network path carry an explicit 20s timeout.
import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

process.env.DISABLE_RATE_LIMIT = '1';
process.env.DATA_DIR = path.join(os.tmpdir(), `gj-relay-test-pcgw-${process.pid}`);
delete process.env.RELAY_DATA_ROOT;   // featureDir() must derive from DATA_DIR

import { syncAll, getEntry, getIndex } from '../../lib/server/relay/pcgw/pcgw.service.js';
import { htmlToText, parseGameDataTable } from '../../lib/server/relay/pcgw/pcgw.parser.js';

const tmpDir = process.env.DATA_DIR;

const FAKE_GAMES = [
    { appid: 220, name: 'Half-Life 2',   playtime_forever: 300 },
    { appid: 999, name: 'No Wiki Entry', playtime_forever: 10 },
];

// Pre-populate Steam games cache before any sync runs.
beforeAll(async () => {
    const steamDir = path.join(tmpDir, 'relay', 'steam');
    await fs.mkdir(steamDir, { recursive: true });
    await fs.writeFile(
        path.join(steamDir, 'games.json'),
        JSON.stringify({ gameCount: FAKE_GAMES.length, games: FAKE_GAMES, fetchedAt: new Date().toISOString() })
    );
});

afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Mock fetch ────────────────────────────────────────────────────────────────
// Minimal mock HTML with just enough structure to exercise all parsers.

const MOCK_HTML = `<!DOCTYPE html>
<html>
<head><title>Half-Life 2 - PCGamingWiki</title></head>
<body>
<h2><span class="mw-headline" id="Availability">Availability</span></h2>
<table class="pcgwikitable sortable template-infotable" id="table-availability">
<tbody>
<tr class="template-infotable-head table-availability-head-row">
  <th class="table-availability-head-source unsortable">Source</th>
  <th class="unsortable table-availability-head-DRM">DRM</th>
</tr>
<tr class="template-infotable-body table-availability-body-row" style="">
  <th scope="row" class="table-availability-body-source">Steam</th>
  <td class="table-availability-body-DRM"><div class="svg-25 svg-icon store-steam"><a href="/wiki/Steam">Steam</a></div></td>
</tr>
<tr class="template-infotable-body table-availability-body-row" style="">
  <th scope="row" class="table-availability-body-source"><a href="https://gog.com">GOG.com</a></th>
  <td class="table-availability-body-DRM"><div class="svg-25 svg-icon drm-drmfree" title="DRM-free"><a href="/wiki/DRM-free">icon</a></div></td>
</tr>
</tbody></table>

<h2><span class="mw-headline" id="Video">Video</span></h2>
<table class="pcgwikitable template-infotable" id="table-settings-video">
<tbody>
<tr class="template-infotable-body table-settings-video-body-row">
  <th scope="row" class="table-settings-video-body-parameter">Widescreen resolution</th>
  <td class="table-settings-video-body-rating"><div title="Native support" class="svg-icon svg-25 tickcross-true"></div></td>
</tr>
<tr class="template-infotable-body table-settings-video-body-row">
  <th scope="row" class="table-settings-video-body-parameter">Ultra-widescreen</th>
  <td class="table-settings-video-body-rating"><div title="No native support" class="svg-icon svg-25 tickcross-false"></div></td>
</tr>
<tr class="template-infotable-body table-settings-video-body-row">
  <th scope="row" class="table-settings-video-body-parameter">60 FPS</th>
  <td class="table-settings-video-body-rating"><div title="Native support" class="svg-icon svg-25 tickcross-true"></div></td>
</tr>
</tbody></table>

<h2><span class="mw-headline" id="Input">Input</span></h2>
<table class="pcgwikitable template-infotable" id="table-settings-input">
<tbody>
<tr class="template-infotable-body table-settings-input-body-row">
  <th scope="row" class="table-settings-input-body-parameter">Remapping</th>
  <td class="table-settings-input-body-rating"><div title="Native support" class="svg-icon svg-25 tickcross-true"></div></td>
</tr>
<tr class="template-infotable-body table-settings-input-body-row">
  <th scope="row" class="table-settings-input-body-parameter">Controller support</th>
  <td class="table-settings-input-body-rating"><div title="Limited native support" class="svg-icon svg-25 tickcross-limited"></div></td>
</tr>
<tr class="template-infotable-body table-settings-input-body-row">
  <th scope="row" class="table-settings-input-body-parameter">Full controller support</th>
  <td class="table-settings-input-body-rating"><div title="No native support" class="svg-icon svg-25 tickcross-false"></div></td>
</tr>
</tbody></table>

<h2><span class="mw-headline" id="Game_data">Game data</span></h2>
<h3><span class="mw-headline" id="Configuration_file.28s.29_location">Configuration file(s) location</span></h3>
<table class="pcgwikitable template-infotable" id="table-gamedata">
<tbody>
<tr class="template-infotable-body table-gamedata-body-row">
  <th scope="row" class="table-gamedata-body-system">Windows</th>
  <td class="table-gamedata-body-location">%USERPROFILE%\\Documents\\Half-Life 2\\cfg\\</td>
</tr>
<tr class="template-infotable-body table-gamedata-body-row">
  <th scope="row" class="table-gamedata-body-system"><abbr title="Proton">Steam Play (Linux)</abbr></th>
  <td class="table-gamedata-body-location">&lt;SteamLibrary-folder&gt;/steamapps/compatdata/220/pfx/</td>
</tr>
</tbody></table>

<h3><span class="mw-headline" id="Save_game_data_location">Save game data location</span></h3>
<table class="pcgwikitable template-infotable" id="table-gamedata">
<tbody>
<tr class="template-infotable-body table-gamedata-body-row">
  <th scope="row" class="table-gamedata-body-system">Windows</th>
  <td class="table-gamedata-body-location">%USERPROFILE%\\Documents\\Half-Life 2\\SAVE\\</td>
</tr>
</tbody></table>

<table class="pcgwikitable template-infotable template-gamedata" id="table-cloudsync">
<tbody>
<tr class="template-infotable-body table-cloudsync-body-row">
  <th scope="row" class="table-cloudsync-body-system"><a href="/wiki/Steam">Steam Cloud</a></th>
  <td class="table-cloudsync-body-rating"><div title="Native support" class="svg-icon svg-25 tickcross-true"></div></td>
</tr>
<tr class="template-infotable-body table-cloudsync-body-row">
  <th scope="row" class="table-cloudsync-body-system">GOG Galaxy</th>
  <td class="table-cloudsync-body-rating"><div title="No native support" class="svg-icon svg-25 tickcross-false"></div></td>
</tr>
</tbody></table>

<h2><span class="mw-headline" id="Issues_fixed">Issues fixed</span></h2>
<h3><span class="mw-headline" id="Some_crash_fix">Some crash fix</span></h3>
<table class="pcgwikitable fixbox">
  <tbody><tr><th class="fixbox-title"><div class="svg-icon fixbox-icon"></div>Fix the crash</th></tr>
  <tr><td class="fixbox-body"><ol><li>Do the thing.</li></ol></td></tr></tbody>
</table>
</body></html>`;

// Cargo API calls only — HTML fetching is now handled separately via htmlFn
function mockFetch(url: unknown, _opts?: unknown) {
    const u = String(url);
    if (u.includes('Infobox_game') && u.includes('220'))
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ cargoquery: [{ title: { pageTitle: 'Half-Life 2' } }] }) });
    if (u.includes('Infobox_game') && u.includes('999'))
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ cargoquery: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ cargoquery: [] }) });
}

// Replaces Puppeteer page fetch in tests
const mockHtmlFn = async () => MOCK_HTML;

// ── syncAll ───────────────────────────────────────────────────────────────────

describe('pcgw service — syncAll', () => {
    it('fetches PCGW data for all games using the injected fetch', async () => {
        const result = await syncAll({ force: true, fetchFn: mockFetch, htmlFn: mockHtmlFn });
        assert.equal(result.total,   2);
        assert.equal(result.fetched, 1);
        assert.equal(result.noPage,  1);
        assert.equal(result.skipped, 0);
        assert.equal(result.failed,  0);
    }, 20_000);

    it('stores pageTitle and pageUrl for a found game', async () => {
        const entry = await getEntry(220);
        assert.ok(entry);
        assert.equal(entry.found,     true);
        assert.equal(entry.steamName, 'Half-Life 2');
        assert.equal(entry.pageTitle, 'Half-Life 2');
        assert.ok(entry.pageUrl.includes('Half-Life'));
    });

    it('stores video data parsed from HTML', async () => {
        const entry = await getEntry(220);
        assert.ok(entry.video);
        assert.equal(entry.video.widescreen, 'true');
        assert.equal(entry.video.ultrawide,  'false');
        assert.equal(entry.video.fps60,      'true');
        assert.equal(entry.video.hdr,        null);
    });

    it('stores input data parsed from HTML', async () => {
        const entry = await getEntry(220);
        assert.ok(entry.input);
        assert.equal(entry.input.keyboard?.remapping,        'true');
        assert.equal(entry.input.controller?.support,        'limited');
        assert.equal(entry.input.controller?.fullSupport,    'false');
    });

    it('stores cloud data parsed from HTML', async () => {
        const entry = await getEntry(220);
        assert.ok(entry.cloud);
        assert.equal(entry.cloud.steam,    'true');
        assert.equal(entry.cloud.gogGalaxy, 'false');
    });

    it('stores availability/DRM data parsed from HTML', async () => {
        const entry = await getEntry(220);
        assert.ok(entry.availability);
        assert.ok(Array.isArray(entry.availability.drm));
        assert.ok(entry.availability.drm.includes('DRM-free'));
        assert.ok(entry.availability.drm.includes('Steam'));
        assert.equal(entry.availability.steamDrm, 'Steam');
        assert.equal(entry.availability.gogDrm,   'DRM-free');
    });

    it('stores paths data parsed from HTML', async () => {
        const entry = await getEntry(220);
        assert.ok(entry.paths);
        assert.ok(entry.paths.config['Windows']);
        assert.ok(entry.paths.config['Steam Play (Linux)']);
        assert.equal(entry.paths.config['Steam Play (Linux)'], '<SteamLibrary-folder>/steamapps/compatdata/220/pfx/');
    });

    it('stores fixes parsed from HTML', async () => {
        const entry = await getEntry(220);
        assert.ok(Array.isArray(entry.fixes));
        assert.ok(entry.fixes.length >= 1);
        assert.equal(entry.fixes[0].title, 'Some crash fix');
    });

    it('stores found=false when no PCGW page exists', async () => {
        const entry = await getEntry(999);
        assert.ok(entry);
        assert.equal(entry.found, false);
    });

    it('skips already-cached games when force=false', async () => {
        let calls = 0;
        const counting = (url: unknown, opts?: unknown) => { calls++; return mockFetch(url, opts); };
        const result = await syncAll({ force: false, fetchFn: counting, htmlFn: mockHtmlFn });
        assert.equal(result.skipped, 2);
        assert.equal(result.fetched, 0);
        assert.equal(calls, 0);
    });

    it('re-fetches everything when force=true', async () => {
        const result = await syncAll({ force: true, fetchFn: mockFetch, htmlFn: mockHtmlFn });
        assert.equal(result.fetched + result.noPage, 2);
    }, 20_000);

    it('does not write legacy flat fields to the entry', async () => {
        const entry = await getEntry(220);
        const legacyFields = ['ultrawide', 'widescreen', 'controllerSupport', 'drm', 'steamDrm'];
        for (const f of legacyFields) {
            assert.ok(!Object.prototype.hasOwnProperty.call(entry, f), `legacy field "${f}" should not exist`);
        }
    });
});

// ── getIndex ──────────────────────────────────────────────────────────────────

describe('pcgw service — getIndex', () => {
    it('returns only found pages in the index', async () => {
        const index = await getIndex();
        assert.equal(index.length, 1);
        assert.equal(index[0].appid,     220);
        assert.equal(index[0].pageTitle, 'Half-Life 2');
    });

    it('index entry has flattened fields for display', async () => {
        const index = await getIndex();
        const entry = index[0];
        assert.ok(Array.isArray(entry.drm));
        assert.equal(entry.steamCloud,        'true');
        assert.equal(entry.controllerSupport, 'limited');
    });
});

// ── getEntry ──────────────────────────────────────────────────────────────────

describe('pcgw service — getEntry', () => {
    it('returns null for an uncached appid', async () => {
        assert.equal(await getEntry(99999), null);
    });

    it('returns the full entry for a cached appid', async () => {
        const entry = await getEntry(220);
        assert.ok(entry);
        assert.equal(entry.appid, 220);
    });
});

// ═══ Parser unit suites (from pcgw.parser.test.js — fixture-free portion) ═════

// ── htmlToText ────────────────────────────────────────────────────────────────

describe('htmlToText', () => {
    it('returns plain text unchanged', () => {
        assert.equal(htmlToText('hello world'), 'hello world');
    });

    it('strips simple HTML tags', () => {
        assert.equal(htmlToText('<span>foo</span>'), 'foo');
    });

    it('extracts content from <abbr>, not the title attribute', () => {
        assert.equal(
            htmlToText('<abbr title="Windows: copy this path...">%USERPROFILE%</abbr>'),
            '%USERPROFILE%'
        );
    });

    it('extracts content from nested <abbr> inside <a>', () => {
        assert.equal(
            htmlToText('<a href="/wiki/foo"><abbr title="tooltip">&lt;Steam-folder&gt;</abbr></a>'),
            '<Steam-folder>'
        );
    });

    it('decodes &lt; and &gt;', () => {
        assert.equal(htmlToText('&lt;SteamLibrary-folder&gt;'), '<SteamLibrary-folder>');
    });

    it('decodes &amp;', () => {
        assert.equal(htmlToText('foo &amp; bar'), 'foo & bar');
    });

    it('decodes &quot; and &#39;', () => {
        assert.equal(htmlToText('&quot;quoted&quot; it&#39;s'), '"quoted" it\'s');
    });

    it('decodes &#91; and &#93; (square brackets)', () => {
        assert.equal(htmlToText('&#91;Note 3&#93;'), '[Note 3]');
    });

    it('removes <sup> reference footnotes entirely', () => {
        assert.equal(
            htmlToText('path/to/game/<sup id="cite_ref-1" class="reference"><a href="#n">&#91;1&#93;</a></sup>'),
            'path/to/game/'
        );
    });

    it('collapses runs of whitespace to a single space', () => {
        assert.equal(htmlToText('  foo   bar  '), 'foo bar');
    });

    it('trims leading and trailing whitespace', () => {
        assert.equal(htmlToText('  hello  '), 'hello');
    });

    it('handles an empty string', () => {
        assert.equal(htmlToText(''), '');
    });

    it('handles a string that is only tags', () => {
        assert.equal(htmlToText('<span></span>'), '');
    });
});

// ── parseGameDataTable ────────────────────────────────────────────────────────

describe('parseGameDataTable', () => {
    it('returns empty object when no gamedata rows are present', () => {
        assert.deepEqual(parseGameDataTable('<table></table>'), {});
    });

    it('extracts a plain system / single path row', () => {
        const html = `
            <tr class="template-infotable-body table-gamedata-body-row">
                <th scope="row" class="table-gamedata-body-system">Windows</th>
                <td class="table-gamedata-body-location">C:\\Games\\foo</td>
            </tr>`;
        const result = parseGameDataTable(html);
        assert.equal(result['Windows'], 'C:\\Games\\foo');
    });

    it('extracts system name wrapped in <abbr>', () => {
        const html = `
            <tr class="template-infotable-body table-gamedata-body-row">
                <th scope="row" class="table-gamedata-body-system">
                    <abbr title="Windows version on Steam running through Proton">Steam Play (Linux)</abbr>
                </th>
                <td class="table-gamedata-body-location">/path/to/pfx/</td>
            </tr>`;
        const result = parseGameDataTable(html);
        assert.ok(Object.prototype.hasOwnProperty.call(result, 'Steam Play (Linux)'), 'key "Steam Play (Linux)" must exist');
        assert.equal(result['Steam Play (Linux)'], '/path/to/pfx/');
    });

    it('splits multiple paths on <br /> into an array', () => {
        const html = `
            <tr class="template-infotable-body table-gamedata-body-row">
                <th scope="row" class="table-gamedata-body-system">Windows</th>
                <td class="table-gamedata-body-location">C:\\path\\one<br />C:\\path\\two</td>
            </tr>`;
        const result = parseGameDataTable(html);
        assert.ok(Array.isArray(result['Windows']), 'should be an array');
        assert.equal(result['Windows'].length, 2);
        assert.equal(result['Windows'][0], 'C:\\path\\one');
        assert.equal(result['Windows'][1], 'C:\\path\\two');
    });

    it('returns a string (not array) when there is exactly one path', () => {
        const html = `
            <tr class="template-infotable-body table-gamedata-body-row">
                <th scope="row" class="table-gamedata-body-system">Windows</th>
                <td class="table-gamedata-body-location">C:\\one\\path</td>
            </tr>`;
        const result = parseGameDataTable(html);
        assert.equal(typeof result['Windows'], 'string');
    });

    it('skips rows whose location <td> is empty', () => {
        const html = `
            <tr class="template-infotable-body table-gamedata-body-row">
                <th scope="row" class="table-gamedata-body-system">macOS (OS X)</th>
                <td class="table-gamedata-body-location"></td>
            </tr>`;
        const result = parseGameDataTable(html);
        assert.equal(Object.keys(result).length, 0);
    });

    it('strips <sup> footnote references from path text', () => {
        const html = `
            <tr class="template-infotable-body table-gamedata-body-row">
                <th scope="row" class="table-gamedata-body-system">Windows</th>
                <td class="table-gamedata-body-location">C:\\path\\here<sup class="reference"><a href="#n">&#91;Note 1&#93;</a></sup></td>
            </tr>`;
        const result = parseGameDataTable(html);
        assert.equal(result['Windows'], 'C:\\path\\here');
    });

    it('decodes HTML entities in paths', () => {
        const html = `
            <tr class="template-infotable-body table-gamedata-body-row">
                <th scope="row" class="table-gamedata-body-system">Steam</th>
                <td class="table-gamedata-body-location">&lt;Steam-folder&gt;/userdata/</td>
            </tr>`;
        const result = parseGameDataTable(html);
        assert.equal(result['Steam'], '<Steam-folder>/userdata/');
    });

    it('handles extra whitespace/indentation in row (Steam Play pattern)', () => {
        const html = `
            <tr class="template-infotable-body table-gamedata-body-row">
                    <th scope="row" class="table-gamedata-body-system"><abbr title="tooltip">Steam Play (Linux)</abbr></th>
                    <td class="table-gamedata-body-location"><span>&lt;SteamLibrary-folder&gt;/steamapps/compatdata/123/pfx/</span></td>
                </tr>`;
        const result = parseGameDataTable(html);
        assert.ok(Object.prototype.hasOwnProperty.call(result, 'Steam Play (Linux)'));
        assert.equal(result['Steam Play (Linux)'], '<SteamLibrary-folder>/steamapps/compatdata/123/pfx/');
    });

    it('handles multiple rows correctly', () => {
        const html = `
            <tr class="template-infotable-body table-gamedata-body-row">
                <th scope="row" class="table-gamedata-body-system">Windows</th>
                <td class="table-gamedata-body-location">C:\\win</td>
            </tr>
            <tr class="template-infotable-body table-gamedata-body-row">
                <th scope="row" class="table-gamedata-body-system">macOS (OS X)</th>
                <td class="table-gamedata-body-location"></td>
            </tr>
            <tr class="template-infotable-body table-gamedata-body-row">
                    <th scope="row" class="table-gamedata-body-system"><abbr title="tip">Steam Play (Linux)</abbr></th>
                    <td class="table-gamedata-body-location">/linux/path</td>
                </tr>`;
        const result = parseGameDataTable(html);
        assert.equal(result['Windows'], 'C:\\win');
        assert.ok(!Object.prototype.hasOwnProperty.call(result, 'macOS (OS X)'));
        assert.equal(result['Steam Play (Linux)'], '/linux/path');
    });
});
