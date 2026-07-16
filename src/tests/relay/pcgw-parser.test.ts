// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/pcgw/pcgw.parser.test.js (node:test →
// vitest) — the fixture-based suites against six saved full-page PCGW
// snapshots (byte-identical copies under ./pcgw/files/). The fixture-free
// suites (htmlToText, parseGameDataTable) already live in pcgw.test.ts.
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified).
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    htmlToText, parsePathsFromHtml, parseFixesFromHtml,
    parseVideoFromHtml, parseInputFromHtml, parseCloudFromHtml, parseAvailabilityFromHtml,
} from '../../lib/server/relay/pcgw/pcgw.parser.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pcgw', 'files');
const arkhamHtml    = await fs.readFile(path.join(FIXTURES, 'arkham.html'),     'utf8');
const cyberpunkHtml = await fs.readFile(path.join(FIXTURES, 'cyberpunk.html'),  'utf8');
const portal2Html   = await fs.readFile(path.join(FIXTURES, 'portal2.html'),    'utf8');
const eldenHtml     = await fs.readFile(path.join(FIXTURES, 'elden-ring.html'), 'utf8');
const rdr2Html      = await fs.readFile(path.join(FIXTURES, 'rdr2.html'),       'utf8');
const blackFlagHtml = await fs.readFile(path.join(FIXTURES, 'black-flag-resynced.html'), 'utf8');

// ── parsePathsFromHtml — Batman: Arkham Asylum ────────────────────────────────

describe('parsePathsFromHtml — Batman: Arkham Asylum (full browser HTML)', () => {
    let paths;
    // Parse once, share across all it() blocks in this describe
    it('locates the Game data section and returns a paths object', () => {
        paths = parsePathsFromHtml(arkhamHtml);
        assert.ok(paths, 'parsePathsFromHtml must return a truthy object');
        assert.ok(typeof paths.config   === 'object', 'paths.config must exist');
        assert.ok(typeof paths.saveGame === 'object', 'paths.saveGame must exist');
    });

    it('config — Windows has two paths (array)', () => {
        paths ??= parsePathsFromHtml(arkhamHtml);
        const win = paths.config['Windows'];
        assert.ok(Array.isArray(win), 'Windows config should be an array of paths');
        assert.equal(win.length, 2);
    });

    it('config — Windows path 1 points to Eidos folder', () => {
        paths ??= parsePathsFromHtml(arkhamHtml);
        const win = paths.config['Windows'];
        assert.ok(win[0].includes('Eidos'), `expected "Eidos" in first path, got: ${win[0]}`);
        assert.ok(win[0].startsWith('%USERPROFILE%'));
        assert.ok(win[0].endsWith('BmGame\\Config\\'));
    });

    it('config — Windows path 2 points to Square Enix GOTY folder', () => {
        paths ??= parsePathsFromHtml(arkhamHtml);
        const win = paths.config['Windows'];
        assert.ok(win[1].includes('Square Enix'), `expected "Square Enix" in second path, got: ${win[1]}`);
        assert.ok(win[1].startsWith('%USERPROFILE%'));
    });

    it('config — macOS (OS X) is absent because its td is empty', () => {
        paths ??= parsePathsFromHtml(arkhamHtml);
        assert.ok(
            !Object.prototype.hasOwnProperty.call(paths.config, 'macOS (OS X)'),
            'macOS config should be absent (empty td)'
        );
    });

    it('config — Steam Play (Linux) is present', () => {
        paths ??= parsePathsFromHtml(arkhamHtml);
        assert.ok(
            Object.prototype.hasOwnProperty.call(paths.config, 'Steam Play (Linux)'),
            'Steam Play (Linux) must appear in config paths'
        );
    });

    it('config — Steam Play (Linux) path points to compatdata/35010/pfx/', () => {
        paths ??= parsePathsFromHtml(arkhamHtml);
        const p = paths.config['Steam Play (Linux)'];
        assert.ok(typeof p === 'string', 'should be a string');
        assert.ok(p.includes('compatdata/35010/pfx/'), `got: ${p}`);
        assert.ok(p.startsWith('<SteamLibrary-folder>'));
    });

    it('saveGame — Windows has two paths (array)', () => {
        paths ??= parsePathsFromHtml(arkhamHtml);
        const win = paths.saveGame['Windows'];
        assert.ok(Array.isArray(win), 'Windows saveGame should be an array');
        assert.equal(win.length, 2);
    });

    it('saveGame — macOS (OS X) is present with a valid $HOME path', () => {
        paths ??= parsePathsFromHtml(arkhamHtml);
        const mac = paths.saveGame['macOS (OS X)'];
        assert.ok(typeof mac === 'string', 'should be a string');
        assert.ok(mac.startsWith('$HOME'), `expected $HOME prefix, got: ${mac}`);
        assert.ok(mac.includes('Feral Interactive'), `got: ${mac}`);
    });

    it('saveGame — Steam path is present', () => {
        paths ??= parsePathsFromHtml(arkhamHtml);
        assert.ok(
            Object.prototype.hasOwnProperty.call(paths.saveGame, 'Steam'),
            'Steam key must exist in saveGame'
        );
    });

    it('saveGame — Steam path contains correct appid (35140)', () => {
        paths ??= parsePathsFromHtml(arkhamHtml);
        const p = paths.saveGame['Steam'];
        assert.ok(p.includes('35140/remote/'), `got: ${p}`);
        assert.ok(p.startsWith('<Steam-folder>'));
    });

    it('saveGame — Steam Play (Linux) is present', () => {
        paths ??= parsePathsFromHtml(arkhamHtml);
        assert.ok(
            Object.prototype.hasOwnProperty.call(paths.saveGame, 'Steam Play (Linux)'),
            'Steam Play (Linux) must appear in saveGame paths'
        );
    });

    it('saveGame — Steam Play (Linux) path points to compatdata/35010/pfx/', () => {
        paths ??= parsePathsFromHtml(arkhamHtml);
        const p = paths.saveGame['Steam Play (Linux)'];
        assert.ok(p.includes('compatdata/35010/pfx/'), `got: ${p}`);
        assert.ok(p.startsWith('<SteamLibrary-folder>'));
    });
});

// ── parsePathsFromHtml — Cyberpunk 2077 ──────────────────────────────────────

describe('parsePathsFromHtml — Cyberpunk 2077 (full browser HTML)', () => {
    let paths;

    it('locates the Game data section and returns a paths object', () => {
        paths = parsePathsFromHtml(cyberpunkHtml);
        assert.ok(paths);
        assert.ok(typeof paths.config   === 'object');
        assert.ok(typeof paths.saveGame === 'object');
    });

    it('config — Windows is a single path string (not array)', () => {
        paths ??= parsePathsFromHtml(cyberpunkHtml);
        const win = paths.config['Windows'];
        assert.equal(typeof win, 'string', 'single path should be a string');
        assert.ok(win.startsWith('%LOCALAPPDATA%'), `got: ${win}`);
        assert.ok(win.includes('CD Projekt Red\\Cyberpunk 2077'), `got: ${win}`);
    });

    it('config — macOS (OS X) is present with a $HOME path', () => {
        paths ??= parsePathsFromHtml(cyberpunkHtml);
        const mac = paths.config['macOS (OS X)'];
        assert.ok(typeof mac === 'string');
        assert.ok(mac.startsWith('$HOME'));
        assert.ok(mac.includes('CD Projekt Red/Cyberpunk 2077'), `got: ${mac}`);
    });

    it('config — Steam Play (Linux) is present', () => {
        paths ??= parsePathsFromHtml(cyberpunkHtml);
        assert.ok(
            Object.prototype.hasOwnProperty.call(paths.config, 'Steam Play (Linux)'),
            'Steam Play (Linux) must appear in config paths'
        );
    });

    it('config — Steam Play (Linux) path contains compatdata/1091500/pfx/', () => {
        paths ??= parsePathsFromHtml(cyberpunkHtml);
        const p = paths.config['Steam Play (Linux)'];
        assert.ok(p.includes('compatdata/1091500/pfx/'), `got: ${p}`);
        assert.ok(p.startsWith('<SteamLibrary-folder>'));
    });

    it('saveGame — Windows is a single path string', () => {
        paths ??= parsePathsFromHtml(cyberpunkHtml);
        const win = paths.saveGame['Windows'];
        assert.equal(typeof win, 'string');
        assert.ok(win.startsWith('%USERPROFILE%'));
        assert.ok(win.includes('Saved Games\\CD Projekt Red\\Cyberpunk 2077'), `got: ${win}`);
    });

    it('saveGame — macOS (OS X) path ends in /saves', () => {
        paths ??= parsePathsFromHtml(cyberpunkHtml);
        const mac = paths.saveGame['macOS (OS X)'];
        assert.ok(typeof mac === 'string');
        assert.ok(mac.endsWith('/saves'), `got: ${mac}`);
    });

    it('saveGame — Steam Play (Linux) is present', () => {
        paths ??= parsePathsFromHtml(cyberpunkHtml);
        assert.ok(
            Object.prototype.hasOwnProperty.call(paths.saveGame, 'Steam Play (Linux)'),
            'Steam Play (Linux) must appear in saveGame paths'
        );
    });

    it('saveGame — Steam Play (Linux) path contains compatdata/1091500/pfx/', () => {
        paths ??= parsePathsFromHtml(cyberpunkHtml);
        const p = paths.saveGame['Steam Play (Linux)'];
        assert.ok(p.includes('compatdata/1091500/pfx/'), `got: ${p}`);
    });

    it('saveGame — no Steam cloud key (Cyberpunk uses GOG, not a Steam userdata path)', () => {
        paths ??= parsePathsFromHtml(cyberpunkHtml);
        // Cyberpunk save page has only Windows/macOS/Steam Play — no plain "Steam" row
        assert.ok(
            !Object.prototype.hasOwnProperty.call(paths.saveGame, 'Steam'),
            'Cyberpunk saveGame should not have a plain "Steam" row'
        );
    });
});

// ── parseFixesFromHtml — Batman: Arkham Asylum ───────────────────────────────

describe('parseFixesFromHtml — Batman: Arkham Asylum (full browser HTML)', () => {
    let fixes;

    it('returns an array', () => {
        fixes = parseFixesFromHtml(arkhamHtml);
        assert.ok(Array.isArray(fixes));
    });

    it('finds multiple fix sections', () => {
        fixes ??= parseFixesFromHtml(arkhamHtml);
        assert.ok(fixes.length >= 3, `expected >= 3 fix sections, got ${fixes.length}`);
    });

    it('each entry has a non-empty title string', () => {
        fixes ??= parseFixesFromHtml(arkhamHtml);
        for (const fix of fixes) {
            assert.equal(typeof fix.title, 'string', 'title must be a string');
            assert.ok(fix.title.trim().length > 0, `empty title found: ${JSON.stringify(fix.title)}`);
        }
    });

    it('each entry has an html string containing fixbox markup', () => {
        fixes ??= parseFixesFromHtml(arkhamHtml);
        for (const fix of fixes) {
            assert.equal(typeof fix.html, 'string', 'html must be a string');
            assert.ok(fix.html.includes('fixbox'), `"fixbox" not found in html for section "${fix.title}"`);
        }
    });

    it('includes the "Skip intro videos" fix section', () => {
        fixes ??= parseFixesFromHtml(arkhamHtml);
        const found = fixes.some(f => f.title === 'Skip intro videos');
        assert.ok(found, `"Skip intro videos" not found in fix titles: ${fixes.map(f => f.title).join(', ')}`);
    });

    it('includes the "Extreme framerate drop in second Scarecrow level" fix section', () => {
        fixes ??= parseFixesFromHtml(arkhamHtml);
        const found = fixes.some(f => f.title.includes('Extreme framerate drop'));
        assert.ok(found, `framerate drop section not found in: ${fixes.map(f => f.title).join(', ')}`);
    });

    it('fix html does not contain raw HTML comments', () => {
        fixes ??= parseFixesFromHtml(arkhamHtml);
        for (const fix of fixes) {
            assert.ok(!fix.html.includes('<!--'), `HTML comment leaked into fix "${fix.title}"`);
        }
    });
});

// ── parseFixesFromHtml — Cyberpunk 2077 ──────────────────────────────────────

describe('parseFixesFromHtml — Cyberpunk 2077 (full browser HTML)', () => {
    let fixes;

    it('returns an array', () => {
        fixes = parseFixesFromHtml(cyberpunkHtml);
        assert.ok(Array.isArray(fixes));
    });

    it('finds multiple fix sections', () => {
        fixes ??= parseFixesFromHtml(cyberpunkHtml);
        assert.ok(fixes.length >= 5, `expected >= 5 fix sections, got ${fixes.length}`);
    });

    it('has more fix sections than Arkham Asylum', () => {
        fixes ??= parseFixesFromHtml(cyberpunkHtml);
        const arkhamFixes = parseFixesFromHtml(arkhamHtml);
        assert.ok(
            fixes.length >= arkhamFixes.length,
            `expected Cyberpunk (${fixes.length}) >= Arkham (${arkhamFixes.length})`
        );
    });

    it('each entry has a non-empty title and html containing fixbox', () => {
        fixes ??= parseFixesFromHtml(cyberpunkHtml);
        for (const fix of fixes) {
            assert.ok(fix.title.trim().length > 0);
            assert.ok(fix.html.includes('fixbox'));
        }
    });
});

// ── parseVideoFromHtml ────────────────────────────────────────────────────────

describe('parseVideoFromHtml — Batman: Arkham Asylum', () => {
    let video;

    it('returns a video object', () => {
        video = parseVideoFromHtml(arkhamHtml);
        assert.ok(video && typeof video === 'object');
    });

    it('widescreen resolution is "true" (native support)', () => {
        video ??= parseVideoFromHtml(arkhamHtml);
        assert.equal(video.widescreen, 'true');
    });

    it('ultra-widescreen is "limited"', () => {
        video ??= parseVideoFromHtml(arkhamHtml);
        assert.equal(video.ultrawide, 'limited');
    });

    it('high-fidelity upscaling is "false"', () => {
        video ??= parseVideoFromHtml(arkhamHtml);
        assert.equal(video.upscaling, 'false');
    });

    it('frame generation is "false"', () => {
        video ??= parseVideoFromHtml(arkhamHtml);
        assert.equal(video.frameGen, 'false');
    });

    it('fields absent from the page default to null (not undefined)', () => {
        video ??= parseVideoFromHtml(arkhamHtml);
        // HDR / ray tracing / etc. may not appear on Arkham's old page
        for (const key of ['hdr', 'fps60', 'fps120', 'rayTracing']) {
            assert.ok(
                video[key] === null || typeof video[key] === 'string',
                `field "${key}" must be null or a string, got ${video[key]}`
            );
        }
    });
});

describe('parseVideoFromHtml — Cyberpunk 2077', () => {
    let video;

    it('returns a video object', () => {
        video = parseVideoFromHtml(cyberpunkHtml);
        assert.ok(video && typeof video === 'object');
    });

    it('widescreen resolution is present', () => {
        video ??= parseVideoFromHtml(cyberpunkHtml);
        assert.ok(video.widescreen !== undefined);
    });

    it('ray tracing is present (modern game has the row)', () => {
        video ??= parseVideoFromHtml(cyberpunkHtml);
        // Cyberpunk has ray tracing support
        assert.ok(
            video.rayTracing !== undefined,
            'rayTracing must be present for Cyberpunk 2077'
        );
    });
});

// ── parseInputFromHtml ────────────────────────────────────────────────────────

describe('parseInputFromHtml — Batman: Arkham Asylum', () => {
    let input;

    it('returns an input object with mouse/keyboard/controller/platform sub-objects', () => {
        input = parseInputFromHtml(arkhamHtml);
        assert.ok(input && typeof input === 'object');
        assert.ok(input.mouse      && typeof input.mouse      === 'object');
        assert.ok(input.keyboard   && typeof input.keyboard   === 'object');
        assert.ok(input.controller && typeof input.controller === 'object');
        assert.ok(input.platform   && typeof input.platform   === 'object');
    });

    it('keyboard.remapping is "true" (native support via "Remapping" row)', () => {
        input ??= parseInputFromHtml(arkhamHtml);
        assert.equal(input.keyboard.remapping, 'true');
    });

    it('controller.support is "true"', () => {
        input ??= parseInputFromHtml(arkhamHtml);
        assert.equal(input.controller.support, 'true');
    });

    it('controller.fullSupport is "limited"', () => {
        input ??= parseInputFromHtml(arkhamHtml);
        assert.equal(input.controller.fullSupport, 'limited');
    });

    it('controller.remapping is "false"', () => {
        input ??= parseInputFromHtml(arkhamHtml);
        assert.equal(input.controller.remapping, 'false');
    });
});

describe('parseInputFromHtml — Cyberpunk 2077', () => {
    let input;

    it('returns an input object with sub-objects', () => {
        input = parseInputFromHtml(cyberpunkHtml);
        assert.ok(input && typeof input === 'object');
        assert.ok(input.controller && typeof input.controller === 'object');
    });

    it('controller.support is present', () => {
        input ??= parseInputFromHtml(cyberpunkHtml);
        assert.ok(input.controller.support !== undefined);
    });
});

// ── parseCloudFromHtml ────────────────────────────────────────────────────────

describe('parseCloudFromHtml — Batman: Arkham Asylum', () => {
    let cloud;

    it('returns a cloud object', () => {
        cloud = parseCloudFromHtml(arkhamHtml);
        assert.ok(cloud && typeof cloud === 'object');
    });

    it('Steam Cloud is "true"', () => {
        cloud ??= parseCloudFromHtml(arkhamHtml);
        assert.equal(cloud.steam, 'true', `steam cloud should be true, got: ${cloud.steam}`);
    });

    it('GOG Galaxy is "true"', () => {
        cloud ??= parseCloudFromHtml(arkhamHtml);
        assert.equal(cloud.gogGalaxy, 'true');
    });

    it('Epic Games Launcher is "false"', () => {
        cloud ??= parseCloudFromHtml(arkhamHtml);
        assert.equal(cloud.epicGames, 'false');
    });

    it('EA app is "true"', () => {
        cloud ??= parseCloudFromHtml(arkhamHtml);
        assert.equal(cloud.eaApp, 'true');
    });

    it('absent platforms default to null', () => {
        cloud ??= parseCloudFromHtml(arkhamHtml);
        assert.equal(cloud.xbox,           null);
        assert.equal(cloud.ubisoftConnect, null);
    });
});

describe('parseCloudFromHtml — Cyberpunk 2077', () => {
    let cloud;

    it('returns a cloud object', () => {
        cloud = parseCloudFromHtml(cyberpunkHtml);
        assert.ok(cloud && typeof cloud === 'object');
    });

    it('Steam Cloud is present', () => {
        cloud ??= parseCloudFromHtml(cyberpunkHtml);
        assert.ok(cloud.steam !== undefined);
    });
});

// ── parseAvailabilityFromHtml ─────────────────────────────────────────────────

describe('parseAvailabilityFromHtml — Batman: Arkham Asylum', () => {
    let avail;

    it('returns an availability object with drm array', () => {
        avail = parseAvailabilityFromHtml(arkhamHtml);
        assert.ok(avail && typeof avail === 'object');
        assert.ok(Array.isArray(avail.drm));
    });

    it('drm array includes "DRM-free" (GOG.com row)', () => {
        avail ??= parseAvailabilityFromHtml(arkhamHtml);
        assert.ok(avail.drm.includes('DRM-free'), `drm list: ${avail.drm}`);
    });

    it('drm array includes "Steam" (third-party stores with Steam keys)', () => {
        avail ??= parseAvailabilityFromHtml(arkhamHtml);
        assert.ok(avail.drm.includes('Steam'), `drm list: ${avail.drm}`);
    });

    it('gogDrm is "DRM-free"', () => {
        avail ??= parseAvailabilityFromHtml(arkhamHtml);
        assert.equal(avail.gogDrm, 'DRM-free');
    });

    it('steamDrm is "DRM-free" (Steam row uses drm-drmfree-asterisk icon)', () => {
        avail ??= parseAvailabilityFromHtml(arkhamHtml);
        assert.equal(avail.steamDrm, 'DRM-free');
    });

    it('drm array contains no duplicates', () => {
        avail ??= parseAvailabilityFromHtml(arkhamHtml);
        const unique = new Set(avail.drm);
        assert.equal(unique.size, avail.drm.length, 'drm array should have no duplicates');
    });
});

describe('parseAvailabilityFromHtml — Cyberpunk 2077', () => {
    let avail;

    it('returns an availability object with drm array', () => {
        avail = parseAvailabilityFromHtml(cyberpunkHtml);
        assert.ok(avail && Array.isArray(avail.drm));
    });

    it('drm array is non-empty', () => {
        avail ??= parseAvailabilityFromHtml(cyberpunkHtml);
        assert.ok(avail.drm.length > 0, 'should have at least one DRM entry');
    });

    it('drm array contains no duplicates', () => {
        avail ??= parseAvailabilityFromHtml(cyberpunkHtml);
        const unique = new Set(avail.drm);
        assert.equal(unique.size, avail.drm.length, 'drm array should have no duplicates');
    });
});

// ── Portal 2 ──────────────────────────────────────────────────────────────────

describe('parseVideoFromHtml — Portal 2', () => {
    let video;

    it('returns a video object', () => {
        video = parseVideoFromHtml(portal2Html);
        assert.ok(video && typeof video === 'object');
    });

    it('widescreen resolution is "true"', () => {
        video ??= parseVideoFromHtml(portal2Html);
        assert.equal(video.widescreen, 'true');
    });

    it('ultra-widescreen is "true" (native support)', () => {
        video ??= parseVideoFromHtml(portal2Html);
        assert.equal(video.ultrawide, 'true');
    });

    it('fps60 is "true" (from combined "60 FPS and 120+ FPS" row)', () => {
        video ??= parseVideoFromHtml(portal2Html);
        assert.equal(video.fps60, 'true');
    });

    it('fps120 is "true" (from combined "60 FPS and 120+ FPS" row)', () => {
        video ??= parseVideoFromHtml(portal2Html);
        assert.equal(video.fps120, 'true');
    });

    it('ray tracing is "hackable"', () => {
        video ??= parseVideoFromHtml(portal2Html);
        assert.equal(video.rayTracing, 'hackable');
    });

    it('hdr is null (Unknown rating)', () => {
        video ??= parseVideoFromHtml(portal2Html);
        assert.equal(video.hdr, null);
    });
});

describe('parseInputFromHtml — Portal 2', () => {
    let input;

    it('returns an input object with sub-objects', () => {
        input = parseInputFromHtml(portal2Html);
        assert.ok(input && typeof input === 'object');
        assert.ok(input.keyboard   && typeof input.keyboard   === 'object');
        assert.ok(input.controller && typeof input.controller === 'object');
    });

    it('keyboard.remapping is "true"', () => {
        input ??= parseInputFromHtml(portal2Html);
        assert.equal(input.keyboard.remapping, 'true');
    });

    it('controller.support is "true"', () => {
        input ??= parseInputFromHtml(portal2Html);
        assert.equal(input.controller.support, 'true');
    });

    it('controller.fullSupport is "true"', () => {
        input ??= parseInputFromHtml(portal2Html);
        assert.equal(input.controller.fullSupport, 'true');
    });

    it('keyboard.steamInput is "true"', () => {
        input ??= parseInputFromHtml(portal2Html);
        assert.equal(input.keyboard.steamInput, 'true');
    });
});

describe('parseCloudFromHtml — Portal 2', () => {
    it('steam cloud is "true"', () => {
        const cloud = parseCloudFromHtml(portal2Html);
        assert.equal(cloud.steam, 'true');
    });

    it('gogGalaxy is null (not listed)', () => {
        const cloud = parseCloudFromHtml(portal2Html);
        assert.equal(cloud.gogGalaxy, null);
    });
});

describe('parseAvailabilityFromHtml — Portal 2', () => {
    let avail;

    it('returns an availability object', () => {
        avail = parseAvailabilityFromHtml(portal2Html);
        assert.ok(avail && Array.isArray(avail.drm));
    });

    it('steamDrm is "Steam"', () => {
        avail ??= parseAvailabilityFromHtml(portal2Html);
        assert.equal(avail.steamDrm, 'Steam');
    });

    it('gogDrm is null (no GOG listing)', () => {
        avail ??= parseAvailabilityFromHtml(portal2Html);
        assert.equal(avail.gogDrm, null);
    });
});

describe('parseFixesFromHtml — Portal 2', () => {
    it('finds multiple fix sections', () => {
        const fixes = parseFixesFromHtml(portal2Html);
        assert.ok(fixes.length >= 2, `expected ≥2 fixes, got ${fixes.length}`);
    });

    it('each fix has a title and fixbox html', () => {
        const fixes = parseFixesFromHtml(portal2Html);
        for (const f of fixes) {
            assert.ok(f.title.length > 0);
            assert.ok(f.html.includes('fixbox'));
        }
    });
});

// ── Elden Ring ────────────────────────────────────────────────────────────────

describe('parseVideoFromHtml — Elden Ring', () => {
    let video;

    it('returns a video object', () => {
        video = parseVideoFromHtml(eldenHtml);
        assert.ok(video && typeof video === 'object');
    });

    it('widescreen is "true"', () => {
        video ??= parseVideoFromHtml(eldenHtml);
        assert.equal(video.widescreen, 'true');
    });

    it('ultra-widescreen is "hackable"', () => {
        video ??= parseVideoFromHtml(eldenHtml);
        assert.equal(video.ultrawide, 'hackable');
    });

    it('hdr is "true" (native support, row named "High dynamic range display (HDR)")', () => {
        video ??= parseVideoFromHtml(eldenHtml);
        assert.equal(video.hdr, 'true');
    });

    it('ray tracing is "true" (row named "Ray tracing (RT)")', () => {
        video ??= parseVideoFromHtml(eldenHtml);
        assert.equal(video.rayTracing, 'true');
    });

    it('fps60 is "true"', () => {
        video ??= parseVideoFromHtml(eldenHtml);
        assert.equal(video.fps60, 'true');
    });

    it('fps120 is "hackable"', () => {
        video ??= parseVideoFromHtml(eldenHtml);
        assert.equal(video.fps120, 'hackable');
    });

    it('upscaling is "false"', () => {
        video ??= parseVideoFromHtml(eldenHtml);
        assert.equal(video.upscaling, 'false');
    });
});

describe('parseInputFromHtml — Elden Ring', () => {
    let input;

    it('controller.support is "true"', () => {
        input = parseInputFromHtml(eldenHtml);
        assert.equal(input.controller.support, 'true');
    });

    it('keyboard.remapping is "limited"', () => {
        input ??= parseInputFromHtml(eldenHtml);
        assert.equal(input.keyboard.remapping, 'limited');
    });

    it('controller.remapping is "true"', () => {
        input ??= parseInputFromHtml(eldenHtml);
        assert.equal(input.controller.remapping, 'true');
    });
});

describe('parsePathsFromHtml — Elden Ring', () => {
    let paths;

    it('config — Windows is present', () => {
        paths = parsePathsFromHtml(eldenHtml);
        assert.ok(paths.config['Windows'], 'Windows config path should exist');
    });

    it('config — Steam Play (Linux) is present', () => {
        paths ??= parsePathsFromHtml(eldenHtml);
        assert.ok(paths.config['Steam Play (Linux)'], 'Steam Play (Linux) config path should exist');
    });

    it('config — Steam Play (Linux) path references correct appid 1245620', () => {
        paths ??= parsePathsFromHtml(eldenHtml);
        assert.ok(paths.config['Steam Play (Linux)'].includes('1245620'));
    });
});

// ── Red Dead Redemption 2 ─────────────────────────────────────────────────────

describe('parseVideoFromHtml — Red Dead Redemption 2', () => {
    let video;

    it('returns a video object', () => {
        video = parseVideoFromHtml(rdr2Html);
        assert.ok(video && typeof video === 'object');
    });

    it('widescreen is "true"', () => {
        video ??= parseVideoFromHtml(rdr2Html);
        assert.equal(video.widescreen, 'true');
    });

    it('ultra-widescreen is "limited"', () => {
        video ??= parseVideoFromHtml(rdr2Html);
        assert.equal(video.ultrawide, 'limited');
    });

    it('hdr is "limited"', () => {
        video ??= parseVideoFromHtml(rdr2Html);
        assert.equal(video.hdr, 'limited');
    });

    it('ray tracing is "false"', () => {
        video ??= parseVideoFromHtml(rdr2Html);
        assert.equal(video.rayTracing, 'false');
    });

    it('fps60 is "true" (from combined "60 FPS and 120+ FPS" row)', () => {
        video ??= parseVideoFromHtml(rdr2Html);
        assert.equal(video.fps60, 'true');
    });

    it('upscaling is "true"', () => {
        video ??= parseVideoFromHtml(rdr2Html);
        assert.equal(video.upscaling, 'true');
    });
});

describe('parseInputFromHtml — Red Dead Redemption 2', () => {
    let input;

    it('controller.support is "true"', () => {
        input = parseInputFromHtml(rdr2Html);
        assert.equal(input.controller.support, 'true');
    });

    it('controller.remapping is "false"', () => {
        input ??= parseInputFromHtml(rdr2Html);
        assert.equal(input.controller.remapping, 'false');
    });

    it('keyboard.remapping is "true"', () => {
        input ??= parseInputFromHtml(rdr2Html);
        assert.equal(input.keyboard.remapping, 'true');
    });
});

describe('parseCloudFromHtml — Red Dead Redemption 2', () => {
    it('steam cloud is "false"', () => {
        const cloud = parseCloudFromHtml(rdr2Html);
        assert.equal(cloud.steam, 'false');
    });

    it('epicGames cloud is "false"', () => {
        const cloud = parseCloudFromHtml(rdr2Html);
        assert.equal(cloud.epicGames, 'false');
    });
});

describe('parseAvailabilityFromHtml — Red Dead Redemption 2', () => {
    let avail;

    it('drm array includes "Epic Games Launcher"', () => {
        avail = parseAvailabilityFromHtml(rdr2Html);
        assert.ok(avail.drm.includes('Epic Games Launcher'), `drm: ${avail.drm}`);
    });

    it('drm array includes "Steam"', () => {
        avail ??= parseAvailabilityFromHtml(rdr2Html);
        assert.ok(avail.drm.includes('Steam'), `drm: ${avail.drm}`);
    });

    it('steamDrm is "Steam"', () => {
        avail ??= parseAvailabilityFromHtml(rdr2Html);
        assert.equal(avail.steamDrm, 'Steam');
    });

    it('drm array contains no duplicates', () => {
        avail ??= parseAvailabilityFromHtml(rdr2Html);
        const unique = new Set(avail.drm);
        assert.equal(unique.size, avail.drm.length, 'drm array should have no duplicates');
    });
});

describe('parsePathsFromHtml — Red Dead Redemption 2', () => {
    let paths;

    it('config — Windows is present', () => {
        paths = parsePathsFromHtml(rdr2Html);
        assert.ok(paths.config['Windows'], 'Windows config path should exist');
    });

    it('config — Windows path references Rockstar Games folder', () => {
        paths ??= parsePathsFromHtml(rdr2Html);
        assert.ok(String(paths.config['Windows']).includes('Rockstar Games'));
    });

    it('config — Steam Play (Linux) is present', () => {
        paths ??= parsePathsFromHtml(rdr2Html);
        assert.ok(paths.config['Steam Play (Linux)'], 'Steam Play (Linux) config path should exist');
    });

    it('config — Steam Play (Linux) path references appid 1174180', () => {
        paths ??= parsePathsFromHtml(rdr2Html);
        assert.ok(paths.config['Steam Play (Linux)'].includes('1174180'));
    });
});

// ── Notes cells & fix grouping — Assassin's Creed: Black Flag Resynced ───────
// Regression fixture: this page's rating cells alone omit the information that
// actually matters (cutscenes locked to 30 FPS, which upscalers ship, a broken
// DLSS implementation). All of it lives in the notes cell and the
// "Issues unresolved" section.

describe('parseVideoFromHtml — notes cells (Black Flag Resynced)', () => {
    let video;
    const v = () => (video ??= parseVideoFromHtml(blackFlagHtml));

    it('exposes non-boolean ratings verbatim rather than dropping them', () => {
        assert.equal(v().fps60, 'limited');
        assert.equal(v().aa,    'always on');
    });

    it('captures the 60 FPS caveat about 30 FPS cutscenes', () => {
        assert.match(htmlToText(v().notes.fps60), /Cutscenes are 30 FPS/);
    });

    it('keeps the nexusmods fix link inside the 60 FPS note', () => {
        assert.match(v().notes.fps60, /href="https:\/\/www\.nexusmods\.com\/[^"]*mods\/7"/);
    });

    it('lists the anti-aliasing modes from the notes cell', () => {
        const aa = htmlToText(v().notes.aa);
        for (const mode of ['TAA', 'DLAA', 'FSRAA', 'XeSSAA', 'SSAA']) {
            assert.ok(aa.includes(mode), `"${mode}" missing from AA note: ${aa}`);
        }
    });

    it('lists the ray tracing presets from the notes cell', () => {
        assert.match(htmlToText(v().notes.rayTracing), /Standard.*Extended/);
    });

    it('rewrites wiki-relative links to absolute pcgamingwiki.com URLs', () => {
        assert.ok(!/href="\/wiki\//.test(v().notes.aa), 'relative /wiki/ link leaked into note');
        assert.match(v().notes.aa, /href="https:\/\/www\.pcgamingwiki\.com\/wiki\/TAA"/);
    });

    it('opens note links in a new tab exactly once', () => {
        for (const a of v().notes.fps60.match(/<a\s[^>]*>/g) ?? []) {
            assert.equal((a.match(/\btarget=/g) ?? []).length, 1, `duplicate target in ${a}`);
            assert.equal((a.match(/\brel=/g)    ?? []).length, 1, `duplicate rel in ${a}`);
        }
    });

    it('strips citation footnote markers from notes', () => {
        assert.ok(!v().notes.upscaling.includes('<sup'), 'citation <sup> leaked into note');
    });

    it('omits notes for rows that have no free text', () => {
        assert.equal(v().notes.widescreen, undefined);
    });
});

describe('parseFixesFromHtml — grouping (Black Flag Resynced)', () => {
    let fixes;
    const f = () => (fixes ??= parseFixesFromHtml(blackFlagHtml));

    it('finds the unresolved DLSS issue', () => {
        const dlss = f().find(x => x.title.startsWith('DLSS upscaling'));
        assert.ok(dlss, `DLSS issue not found in: ${f().map(x => x.title).join(', ')}`);
        assert.equal(dlss.group, 'Issues unresolved');
    });

    it('groups ordinary tweaks under Essential improvements', () => {
        const skip = f().find(x => x.title === 'Skip intro videos');
        assert.ok(skip);
        assert.equal(skip.group, 'Essential improvements');
    });

    it('strips the " • Link" self-anchor from titles', () => {
        for (const fix of f()) {
            assert.ok(!/•\s*Link/.test(fix.title), `link suffix leaked into title: ${fix.title}`);
        }
    });

    it('carries the workaround body of the unresolved issue', () => {
        const dlss = f().find(x => x.title.startsWith('DLSS upscaling'));
        assert.match(htmlToText(dlss.html), /Resolution Scale slider/);
    });
});
