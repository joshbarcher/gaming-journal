// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/steam/images.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified).
import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-images-test-'));
process.env.DATA_DIR = tmpDir;
delete process.env.RELAY_DATA_ROOT;   // featureDir() must derive from DATA_DIR
// The relay ran its suite with .env.test's DISABLE_RATE_LIMIT=1 — the politeness
// delays protect the Steam CDN, and tests stub fetch so there is nothing to protect.
process.env.DISABLE_RATE_LIMIT = '1';

const {
    syncGameImages,
    syncScreenshotImages,
    syncAchievementImages,
} = await import('../../../lib/server/relay/steam/images.service.js');

const steamDir = path.join(tmpDir, 'relay', 'steam');
await fs.mkdir(steamDir, { recursive: true });

const FAKE_GAMES = [
    { appid: 10, name: 'Game One', playtime_forever: 120 },
    { appid: 20, name: 'Game Two', playtime_forever: 0 },
];

await fs.writeFile(
    path.join(steamDir, 'games.json'),
    JSON.stringify({ gameCount: 2, games: FAKE_GAMES, fetchedAt: new Date().toISOString() })
);

const FAKE_ACHIEVEMENTS = {
    10: {
        fetchedAt: new Date().toISOString(),
        gameName: 'Game One',
        achievements: [
            {
                apiname: 'ACH_1',
                achieved: 1,
                unlocktime: 1700000001,
                displayName: 'First Achievement',
                description: 'Do the thing.',
                icon: 'https://cdn.example.com/apps/10/icon.jpg',
                icongray: 'https://cdn.example.com/apps/10/icon_gray.jpg',
                hidden: 0,
            },
            {
                apiname: 'Who_Let_This_Dog_Out!?',
                achieved: 0,
                unlocktime: 0,
                displayName: 'Who Let This Dog Out!?',
                description: 'Bad filename chars.',
                icon: 'https://cdn.example.com/apps/10/dog.jpg',
                icongray: 'https://cdn.example.com/apps/10/dog_gray.jpg',
                hidden: 0,
            },
            {
                apiname: 'NUL',
                achieved: 0,
                unlocktime: 0,
                displayName: 'Null Achievement',
                description: 'Reserved name.',
                icon: 'https://cdn.example.com/apps/10/nul.jpg',
                icongray: 'https://cdn.example.com/apps/10/nul_gray.jpg',
                hidden: 0,
            },
            {
                apiname: 'Trailing.',
                achieved: 0,
                unlocktime: 0,
                displayName: 'Trailing Period',
                description: 'Trailing period.',
                icon: 'https://cdn.example.com/apps/10/trail.jpg',
                icongray: 'https://cdn.example.com/apps/10/trail_gray.jpg',
                hidden: 0,
            },
        ],
    },
};

await fs.writeFile(
    path.join(steamDir, 'achievements.json'),
    JSON.stringify(FAKE_ACHIEVEMENTS)
);

const TOTAL_GAME_IMAGES = FAKE_GAMES.length * 6;

// ── Game images ───────────────────────────────────────────────────────────────

describe('steam-images — game images', () => {
    let originalFetch;

    beforeAll(() => {
        originalFetch = global.fetch;
        global.fetch = vi.fn(async (url) => {
            const u = String(url);
            // logo has no fallback and is missing; background_raw is missing but page_bg fallback succeeds
            if (u.includes('logo') || u.includes('background_raw')) {
                return { ok: false, status: 404, statusText: 'Not Found' };
            }
            return {
                ok: true,
                arrayBuffer: async () => Buffer.from('fake-image-data').buffer,
            };
        });
    });

    afterAll(() => { global.fetch = originalFetch; });

    it('syncGameImages downloads available types, falls back for background, records logo as missing', async () => {
        const result = await syncGameImages({ force: true });
        assert.equal(result.total,      TOTAL_GAME_IMAGES);
        assert.equal(result.missing,    2);  // logo × 2 games
        assert.equal(result.downloaded, TOTAL_GAME_IMAGES - 2);
        assert.equal(result.skipped,    0);
    });

    it('syncGameImages skips already-present files when force=false', async () => {
        global.fetch.mockClear();
        const result = await syncGameImages({ force: false });
        assert.equal(result.skipped,    TOTAL_GAME_IMAGES - 2);
        assert.equal(result.downloaded, 0);
        assert.equal(result.missing,    2);

        // Only the still-missing logo is retried, but 'logo' has three candidate
        // URLs (library_logo on each CDN, then logo.png) and all 404 here — so the
        // 2 missing logos cost 3 requests each.
        const urls = global.fetch.mock.calls.map((c) => String(c[0]));
        assert.ok(urls.every((u) => u.includes('logo')), `only logo URLs retried, got ${urls}`);
        assert.equal(urls.length, 6);
    });

    it('syncGameImages re-downloads everything when force=true', async () => {
        global.fetch.mockClear();
        const result = await syncGameImages({ force: true });
        assert.equal(result.downloaded, TOTAL_GAME_IMAGES - 2);
        assert.equal(result.skipped,    0);
    });
});

// ── Screenshot images ─────────────────────────────────────────────────────────

describe('steam-images — screenshot images', () => {
    let originalFetch;

    beforeAll(async () => {
        const storeDir = path.join(tmpDir, 'relay', 'steam', 'store');
        await fs.mkdir(storeDir, { recursive: true });
        await fs.writeFile(path.join(storeDir, '10.json'), JSON.stringify({
            steam_appid: 10,
            name: 'Game One',
            screenshots: [
                { id: 0, path_thumbnail: 'https://cdn.example.com/ss_0.thumb.jpg', path_full: 'https://cdn.example.com/ss_0.full.jpg' },
                { id: 1, path_thumbnail: 'https://cdn.example.com/ss_1.thumb.jpg', path_full: 'https://cdn.example.com/ss_1.full.jpg' },
            ],
        }));
        await fs.writeFile(path.join(storeDir, '20.json'), JSON.stringify({
            steam_appid: 20,
            name: 'Game Two',
            screenshots: [
                { id: 0, path_thumbnail: 'https://cdn.example.com/ss_0.thumb.jpg', path_full: 'https://cdn.example.com/ss_0.full.jpg' },
            ],
        }));

        originalFetch = global.fetch;
        global.fetch = vi.fn(async () => ({
            ok: true,
            arrayBuffer: async () => Buffer.from('fake-screenshot').buffer,
        }));
    });

    afterAll(() => { global.fetch = originalFetch; });

    it('syncScreenshotImages downloads all path_full URLs', async () => {
        const result = await syncScreenshotImages({ force: true });
        assert.equal(result.total,      3);
        assert.equal(result.downloaded, 3);
        assert.equal(result.skipped,    0);
        assert.equal(result.missing,    0);
    });

    it('stores screenshots under images/screenshots/{appid}/{id}.jpg', async () => {
        const files10 = await fs.readdir(path.join(tmpDir, 'relay', 'steam', 'images', 'screenshots', '10'));
        const files20 = await fs.readdir(path.join(tmpDir, 'relay', 'steam', 'images', 'screenshots', '20'));
        assert.deepEqual(files10.sort(), ['0.jpg', '1.jpg']);
        assert.deepEqual(files20.sort(), ['0.jpg']);
    });

    it('skips existing files when force=false', async () => {
        global.fetch.mockClear();
        const result = await syncScreenshotImages({ force: false });
        assert.equal(result.skipped,    3);
        assert.equal(result.downloaded, 0);
        assert.equal(global.fetch.mock.calls.length, 0);
    });
});

// ── Achievement images ────────────────────────────────────────────────────────

describe('steam-images — achievement images', () => {
    let originalFetch;

    beforeAll(() => {
        originalFetch = global.fetch;
        global.fetch = vi.fn(async () => ({
            ok: true,
            arrayBuffer: async () => Buffer.from('fake-icon-data').buffer,
        }));
    });

    afterAll(async () => {
        global.fetch = originalFetch;
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('syncAchievementImages reads icon URLs from achievements.json', async () => {
        const result = await syncAchievementImages({ force: true });
        assert.equal(result.total,      8);
        assert.equal(result.downloaded, 8);
        assert.equal(result.skipped,    0);
    });

    it('sanitizes Windows-invalid characters, reserved names, and trailing periods', async () => {
        const achDir = path.join(tmpDir, 'relay', 'steam', 'images', 'achievements', '10');
        const files  = await fs.readdir(achDir);

        assert.equal(files.some((f) => f.includes('?')), false);
        assert.ok(files.some((f) => f.startsWith('Who_Let_This_Dog_Out!__color')));
        assert.ok(files.some((f) => f.startsWith('_NUL_color')));
        assert.ok(files.some((f) => f.startsWith('Trailing__color')));
    });

    it('syncAchievementImages skips existing files when force=false', async () => {
        global.fetch.mockClear();
        const result = await syncAchievementImages({ force: false });
        assert.equal(result.skipped,    8);
        assert.equal(result.downloaded, 0);
        assert.equal(global.fetch.mock.calls.length, 0);
    });

    it('syncAchievementImages with appids filter only processes specified games', async () => {
        global.fetch.mockClear();
        // Force-download only appid 10; any other appids in the cache should be ignored
        const result = await syncAchievementImages({ force: true, appids: [10] });
        // appid 10 has 4 achievements × 2 variants = 8 icons; no other appids in test data
        assert.equal(result.total,      8);
        assert.equal(result.downloaded, 8);
    });

    it('syncAchievementImages with empty appids array downloads nothing', async () => {
        global.fetch.mockClear();
        const result = await syncAchievementImages({ force: true, appids: [] });
        assert.equal(result.total,      0);
        assert.equal(result.downloaded, 0);
        assert.equal(global.fetch.mock.calls.length, 0);
    });
});
