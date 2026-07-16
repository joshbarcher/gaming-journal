// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/games/games.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified).
import { describe, it, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-games-test-'));
process.env.DATA_DIR = tmpDir;
delete process.env.RELAY_DATA_ROOT;   // featureDir() must derive from DATA_DIR
// The relay ran its suite with .env.test — carry over the vars it supplied.
process.env.DISABLE_RATE_LIMIT = '1';
process.env.STEAM_API_KEY = 'test-key';
process.env.STEAM_ID = '76561198000000000';
process.env.ITAD_API_KEY = 'test-itad-key';
process.env.ITAD_COUNTRY = 'US';

const { getAll, getOne, build } = await import('../../lib/server/relay/games/games.service.js');

// ── Fixtures ───────────────────────────────────────────────────────────────────

const steamDir = path.join(tmpDir, 'relay', 'steam');
const storeDir = path.join(tmpDir, 'relay', 'steam', 'store');
const hltbDir  = path.join(tmpDir, 'relay', 'hltb');
const pcgwDir  = path.join(tmpDir, 'relay', 'pcgw');
await fs.mkdir(steamDir, { recursive: true });
await fs.mkdir(storeDir, { recursive: true });
await fs.mkdir(hltbDir,  { recursive: true });
await fs.mkdir(pcgwDir,  { recursive: true });

// Library games (220 + 400 owned, 570 wishlist-only)
await fs.writeFile(
    path.join(steamDir, 'games.json'),
    JSON.stringify({
        gameCount: 2,
        fetchedAt: new Date().toISOString(),
        games: [
            { appid: 220, name: 'Half-Life 2', playtime_forever: 300, img_icon_url: 'hl2.jpg' },
            { appid: 400, name: 'Portal',       playtime_forever: 120, img_icon_url: 'portal.jpg' },
        ],
    })
);

// Wishlist — 570 (Dota 2) is wishlist-only; 220 is in both library and wishlist
await fs.writeFile(
    path.join(steamDir, 'wishlist.json'),
    JSON.stringify({
        fetchedAt: new Date().toISOString(),
        itemCount: 2,
        items: {
            220: { priority: 0, date_added: 1700000000 },
            570: { priority: 1, date_added: 1700000001 },
        },
    })
);

// Store details for Half-Life 2
await fs.writeFile(
    path.join(storeDir, '220.json'),
    JSON.stringify({
        steam_appid: 220,
        name: 'Half-Life 2',
        type: 'game',
        is_free: false,
        short_description: 'Sequel to Half-Life.',
        developers: ['Valve'],
        publishers: ['Valve'],
        price_overview: { currency: 'USD', initial: 999, final: 999, discount_percent: 0 },
        platforms: { windows: true, mac: true, linux: true },
        metacritic: { score: 96, url: 'https://metacritic.com/hl2' },
        categories: [{ id: 1, description: 'Single-player' }],
        genres: [{ id: 1, description: 'Action' }],
        release_date: { coming_soon: false, date: 'Nov 16, 2004' },
        recommendations: { total: 200000 },
        required_age: 0,
        screenshots: [
            { id: 0, path_thumbnail: 'https://cdn.example.com/t0.jpg', path_full: 'https://cdn.example.com/f0.jpg' },
            { id: 1, path_thumbnail: 'https://cdn.example.com/t1.jpg', path_full: 'https://cdn.example.com/f1.jpg' },
        ],
    })
);

// Store details for Dota 2 (wishlist-only)
await fs.writeFile(
    path.join(storeDir, '570.json'),
    JSON.stringify({
        steam_appid: 570,
        name: 'Dota 2',
        type: 'game',
        is_free: true,
        short_description: 'A MOBA.',
        developers: ['Valve'],
        publishers: ['Valve'],
        platforms: { windows: true, mac: true, linux: true },
        categories: [{ id: 1, description: 'Multi-player' }],
        genres: [{ id: 1, description: 'Strategy' }],
        release_date: { coming_soon: false, date: 'Jul 9, 2013' },
        required_age: 0,
        screenshots: [
            { id: 0, path_thumbnail: 'https://cdn.example.com/d0.jpg', path_full: 'https://cdn.example.com/d0f.jpg' },
        ],
    })
);

// HLTB entry for Half-Life 2
await fs.writeFile(
    path.join(hltbDir, '220.json'),
    JSON.stringify({
        appid: 220, steamName: 'Half-Life 2', fetchedAt: new Date().toISOString(),
        matched: true, matchedName: 'Half-Life 2', confidence: 0.95, hltbId: 1000,
        gameplayMain: 12, gameplayMainExtra: 15, gameplayCompletionist: 20,
        imageUrl: 'https://howlongtobeat.com/games/hl2.jpg',
    })
);

// PCGW entry for Half-Life 2 — nested structure matching real service output
await fs.writeFile(
    path.join(pcgwDir, '220.json'),
    JSON.stringify({
        appid: 220, steamName: 'Half-Life 2', fetchedAt: new Date().toISOString(),
        found: true,
        pageTitle: 'Half-Life 2',
        pageUrl: 'https://www.pcgamingwiki.com/wiki/Half-Life_2',
        video: { ultrawide: true, widescreen: true, hdr: false, fps60: true, fps120: false, frameRateCap: null },
        input: { controller: { support: 'Limited', fullSupport: false, remapping: false } },
        cloud: { steam: true },
        availability: { drm: ['Steam'] },
    })
);

// PCGW entry for Portal — found=false
await fs.writeFile(
    path.join(pcgwDir, '400.json'),
    JSON.stringify({ appid: 400, steamName: 'Portal', fetchedAt: new Date().toISOString(), found: false })
);

// getAll()/getOne() are synchronous readers over an in-memory cache; build() is what
// reads the fixtures off disk and populates it. In the app, cache-manager drives this
// via register('games', build).
await build();

// ── getAll ─────────────────────────────────────────────────────────────────────

describe('games service — getAll', () => {
    it('returns library + wishlist games deduplicated', async () => {
        const games = await getAll();
        // 220 (both), 400 (library), 570 (wishlist) = 3 unique entries
        assert.equal(games.length, 3);
    });

    it('marks source correctly for library-only, wishlist-only, and both', async () => {
        const games  = await getAll();
        const hl2    = games.find((g) => g.appid === 220);
        const portal = games.find((g) => g.appid === 400);
        const dota   = games.find((g) => g.appid === 570);
        assert.equal(hl2.source,    'both');
        assert.equal(portal.source, 'library');
        assert.equal(dota.source,   'wishlist');
    });

    it('includes wishlist metadata when present', async () => {
        const games = await getAll();
        const hl2   = games.find((g) => g.appid === 220);
        const dota  = games.find((g) => g.appid === 570);
        assert.ok(hl2.wishlist);
        assert.equal(hl2.wishlist.priority, 0);
        assert.ok(dota.wishlist);
        assert.equal(dota.wishlist.priority, 1);
        assert.equal(games.find((g) => g.appid === 400).wishlist, null);
    });

    it('merges store details', async () => {
        const games = await getAll();
        const hl2   = games.find((g) => g.appid === 220);
        assert.ok(hl2.store);
        assert.equal(hl2.store.description, 'Sequel to Half-Life.');
        assert.deepEqual(hl2.store.genres, ['Action']);
        assert.deepEqual(hl2.store.categories, ['Single-player']);
        assert.equal(hl2.store.metacritic.score, 96);
    });

    // Browser-facing URLs carry the /relay reverse-proxy prefix that fronts this
    // server (the app itself mounts express.static at /images/steam).
    it('includes media URLs including screenshots from store data', async () => {
        const games = await getAll();
        const hl2   = games.find((g) => g.appid === 220);
        assert.equal(hl2.media.header, '/relay/images/steam/games/220/header.jpg');
        assert.equal(hl2.media.poster, '/relay/images/steam/games/220/poster.jpg');
        assert.deepEqual(hl2.media.screenshots, [
            '/relay/images/steam/screenshots/220/0.jpg',
            '/relay/images/steam/screenshots/220/1.jpg',
        ]);
    });

    it('merges HLTB and PCGW data for a fully cached game', async () => {
        const games = await getAll();
        const hl2   = games.find((g) => g.appid === 220);
        assert.ok(hl2.hltb);
        assert.equal(hl2.hltb.matched, true);
        assert.equal(hl2.hltb.gameplayMain, 12);
        assert.ok(hl2.pcgw);
        assert.deepEqual(hl2.pcgw.drm, ['Steam']);
        assert.equal(hl2.pcgw.controllerSupport, 'Limited');
    });

    it('returns null hltb when not cached', async () => {
        const games  = await getAll();
        const portal = games.find((g) => g.appid === 400);
        assert.equal(portal.hltb, null);
    });

    it('returns null pcgw when found=false', async () => {
        const games  = await getAll();
        const portal = games.find((g) => g.appid === 400);
        assert.equal(portal.pcgw, null);
    });
});

// ── getOne ─────────────────────────────────────────────────────────────────────

describe('games service — getOne', () => {
    it('returns null for an unknown appid', async () => {
        assert.equal(await getOne(99999), null);
    });

    it('returns a library game with full merge', async () => {
        const game = await getOne(220);
        assert.ok(game);
        assert.equal(game.appid, 220);
        assert.equal(game.source, 'both');
        assert.ok(game.hltb);
        assert.ok(game.pcgw);
        assert.ok(game.store);
        assert.ok(game.media);
    });

    it('returns a wishlist-only game', async () => {
        const game = await getOne(570);
        assert.ok(game);
        assert.equal(game.appid, 570);
        assert.equal(game.source, 'wishlist');
        assert.equal(game.playtimeMinutes, 0);
        assert.ok(game.wishlist);
        assert.equal(game.store.isFree, true);
        assert.deepEqual(game.media.screenshots, ['/relay/images/steam/screenshots/570/0.jpg']);
    });

    afterAll(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });
});
