// @ts-nocheck — verbatim port of relay-server node:test suites over untyped .js services;
// assertions are byte-identical to the originals and runtime-verified by vitest.
// Ported from relay-server src/tests/nexus/nexus.service.test.js (node:test → vitest).
// Contract tests — behavior must match the relay exactly (docs/relay-fold-in.md
// §6: parity is the correctness definition during migration, so assertions are
// carried over unmodified).
//
// DATA_DIR must point at a temp dir, never the NAS (.env's DATA_DIR). The
// service reads env at call time via featureDir(), so module-scope assignment
// is safe despite import hoisting. Every network call injects fetchFn; the
// author-images scrape (fire-and-forget inside getModDetail) is disabled via
// NEXUS_SCRAPE_AUTHOR_IMAGES=false — same as the relay's .env.test — so no
// Puppeteer browser is ever launched.
import { describe, test, beforeAll, beforeEach, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

process.env.DATA_DIR = path.join(os.tmpdir(), `gj-relay-test-nexus-${process.pid}`);
delete process.env.RELAY_DATA_ROOT;   // featureDir() must derive from DATA_DIR
process.env.NEXUS_API_KEY = 'test-key';
process.env.NEXUS_MOD_COUNT = '6';
process.env.NEXUS_SYNC_INTERVAL_HOURS = '168';
process.env.NEXUS_SCRAPE_AUTHOR_IMAGES = 'false';   // relay .env.test line 20

import {
    normalizeName,
    matchGame,
    shapeMod,
    shapeModDetail,
    modPageUrl,
    buildSort,
    getEntry,
    getIndex,
    syncOne,
    getModsPage,
    getModDetail,
    startDeepPull,
    getDeep,
    _resetCaches,
} from '../../lib/server/relay/nexus/nexus.service.js';

const NEXUS_DIR = path.join(process.env.DATA_DIR, 'relay', 'nexus');

// ── Fixtures ────────────────────────────────────────────────────────────────

const GAMES = [
    { id: 1704, name: 'Skyrim Special Edition', domain_name: 'skyrimspecialedition' },
    { id: 110,  name: 'Skyrim',                 domain_name: 'skyrim' },
    { id: 1151, name: 'Fallout 4',              domain_name: 'fallout4' },
    { id: 3333, name: 'Cyberpunk 2077',         domain_name: 'cyberpunk2077' },
];

function modNode(overrides = {}) {
    return {
        modId: 12604, gameId: 1704, name: 'SkyUI',
        summary: 'Elegant UI', version: '6.9', author: 'SkyUI Team',
        uploader: { name: 'schlangster', avatar: 'https://avatars/28794/100' },
        pictureUrl: 'https://img/pic.png', thumbnailUrl: 'https://img/thumb.png',
        downloads: 24_000_000, endorsements: 494_000, adult: false,
        status: 'published', category: 'User Interface',
        createdAt: '2017-10-01T11:55:43Z', updatedAt: '2026-05-05T22:41:21Z',
        ...overrides,
    };
}

const noHeaders = { get: () => null };

// A fetch mock that answers the REST games list, the GraphQL mods query, and
// image (thumb/full) downloads from the fixture CDN host.
function mockFetch({ nodes = [modNode()], totalCount = 134_802 } = {}) {
    const calls = { games: 0, graphql: 0, image: 0 };
    const fn = async (url, opts = {}) => {
        const u = String(url);
        if (u.endsWith('/games.json')) {
            calls.games++;
            return { ok: true, headers: noHeaders, json: async () => GAMES };
        }
        if (u.includes('/graphql')) {
            calls.graphql++;
            return { ok: true, headers: noHeaders, json: async () => ({ data: { mods: { nodes, totalCount } } }) };
        }
        if (u.startsWith('https://img/')) {
            calls.image++;
            return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
        }
        throw new Error(`unexpected url: ${url}`);
    };
    fn.calls = calls;
    return fn;
}

async function cleanup() {
    _resetCaches();   // module-level in-memory caches persist across tests
    await fs.rm(process.env.DATA_DIR, { recursive: true, force: true });
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

describe('normalizeName', () => {
    test('lowercases and strips punctuation/space', () => {
        assert.equal(normalizeName('The Elder Scrolls V: Skyrim'), 'theelderscrollsvskyrim');
    });
    test('strips diacritics', () => {
        assert.equal(normalizeName('Pokémon'), 'pokemon');
    });
    test('handles null', () => {
        assert.equal(normalizeName(null), '');
    });
});

describe('matchGame', () => {
    test('exact name match', () => {
        assert.deepEqual(matchGame('Fallout 4', GAMES),
            { domainName: 'fallout4', gameId: 1151, nexusName: 'Fallout 4' });
    });
    test('franchise-prefixed Steam title picks the most specific edition', () => {
        // Both "Skyrim" and "Skyrim Special Edition" are substrings — the longer wins.
        assert.deepEqual(matchGame('The Elder Scrolls V: Skyrim Special Edition', GAMES),
            { domainName: 'skyrimspecialedition', gameId: 1704, nexusName: 'Skyrim Special Edition' });
    });
    test('base game resolves to base, not the edition', () => {
        assert.deepEqual(matchGame('The Elder Scrolls V: Skyrim', GAMES),
            { domainName: 'skyrim', gameId: 110, nexusName: 'Skyrim' });
    });
    test('no match returns null', () => {
        assert.equal(matchGame('Some Unrelated Indie Game', GAMES), null);
    });
    test('empty name returns null', () => {
        assert.equal(matchGame('', GAMES), null);
    });
});

describe('shapeMod', () => {
    test('maps API node onto the stored shape with a constructed url', () => {
        const m = shapeMod(modNode(), 'skyrimspecialedition');
        assert.equal(m.modId, 12604);
        assert.equal(m.uploaderName, 'schlangster');
        assert.equal(m.imageUrl, 'https://img/pic.png');
        assert.equal(m.thumbUrl, 'https://img/thumb.png');
        assert.equal(m.url, 'https://www.nexusmods.com/skyrimspecialedition/mods/12604');
        assert.equal(m.adult, false);
        assert.equal(m.localThumb, null, 'local paths are filled later by syncOne, not shapeMod');
        assert.equal(m.localImage, null);
    });
    test('tolerates missing optional fields', () => {
        const m = shapeMod({ modId: 5, name: 'X' }, 'fallout4');
        assert.equal(m.uploaderName, null);
        assert.equal(m.downloads, 0);
        assert.equal(m.endorsements, 0);
        assert.equal(m.adult, false);
        assert.equal(m.url, 'https://www.nexusmods.com/fallout4/mods/5');
    });
});

test('modPageUrl builds the canonical link', () => {
    assert.equal(modPageUrl('cyberpunk2077', 42), 'https://www.nexusmods.com/cyberpunk2077/mods/42');
});

// ── syncOne (disk + injected fetch) ─────────────────────────────────────────────

describe('syncOne', () => {
    beforeAll(cleanup);
    beforeEach(cleanup);
    afterAll(cleanup);

    test('resolves, fetches, and persists a full entry', async () => {
        const fetchFn = mockFetch();
        const r = await syncOne(489830, 'The Elder Scrolls V: Skyrim Special Edition', { fetchFn });
        assert.equal(r.fetched, 1);

        const e = await getEntry(489830);
        assert.equal(e.domainName, 'skyrimspecialedition');
        assert.equal(e.gameId, 1704);
        assert.equal(e.gameUrl, 'https://www.nexusmods.com/skyrimspecialedition');
        assert.equal(e.totalMods, 134_802);
        assert.equal(e.mods.length, 1);
        assert.equal(e.mods[0].url, 'https://www.nexusmods.com/skyrimspecialedition/mods/12604');
    });

    test('writes a sentinel (no mods/image calls) when the game is not on Nexus', async () => {
        const fetchFn = mockFetch();
        await syncOne(999999, 'Totally Unknown Game', { fetchFn });

        const e = await getEntry(999999);
        assert.equal(e.domainName, null);
        assert.deepEqual(e.mods, []);
        assert.equal(fetchFn.calls.graphql, 0, 'must not query mods for an unmatched game');
        assert.equal(fetchFn.calls.image, 0, 'must not download images for an unmatched game');
    });

    test('mirrors mod images to disk and stores local web paths', async () => {
        const fetchFn = mockFetch();
        await syncOne(489830, 'Skyrim Special Edition', { fetchFn });

        const e   = await getEntry(489830);
        const mod = e.mods[0];
        assert.equal(mod.localThumb, '/images/nexus/489830/12604_thumb.png');
        assert.equal(mod.localImage, '/images/nexus/489830/12604.png');
        assert.ok(fetchFn.calls.image >= 2, 'downloaded thumb + full image');

        // files actually landed on disk under the images subfolder
        await fs.access(path.join(NEXUS_DIR, 'images', '489830', '12604_thumb.png'));
        await fs.access(path.join(NEXUS_DIR, 'images', '489830', '12604.png'));
    });

    test('re-downloads an image only when its upstream URL changes', async () => {
        const first = mockFetch();
        await syncOne(489830, 'Skyrim Special Edition', { fetchFn: first });
        const afterFirst = first.calls.image;

        // Same URLs, force a re-sync → images already cached, no re-download.
        const second = mockFetch();
        await syncOne(489830, 'Skyrim Special Edition', { force: true, fetchFn: second });
        assert.equal(second.calls.image, 0, 'unchanged image URLs are not re-fetched');

        // Changed thumbnail URL → that image (and only it) re-downloads.
        const moved = mockFetch({ nodes: [modNode({ thumbnailUrl: 'https://img/thumb-v2.png' })] });
        await syncOne(489830, 'Skyrim Special Edition', { force: true, fetchFn: moved });
        assert.equal(moved.calls.image, 1, 'only the changed thumbnail re-downloads');
    });

    test('a second sync within TTL skips the API', async () => {
        const fetchFn = mockFetch();
        await syncOne(489830, 'Skyrim Special Edition', { fetchFn });
        const graphqlAfterFirst = fetchFn.calls.graphql;

        const r2 = await syncOne(489830, 'Skyrim Special Edition', { fetchFn });
        assert.equal(r2.skipped, 1);
        assert.equal(fetchFn.calls.graphql, graphqlAfterFirst, 'TTL-fresh entry must not refetch');
    });

    test('force overrides the TTL', async () => {
        const fetchFn = mockFetch();
        await syncOne(489830, 'Skyrim Special Edition', { fetchFn });
        const before = fetchFn.calls.graphql;
        await syncOne(489830, 'Skyrim Special Edition', { force: true, fetchFn });
        assert.equal(fetchFn.calls.graphql, before + 1);
    });

    test('index reflects persisted entries', async () => {
        const fetchFn = mockFetch();
        await syncOne(489830, 'Skyrim Special Edition', { fetchFn });
        const index = await getIndex();
        const row = index.find(x => x.appid === 489830);
        assert.ok(row);
        assert.equal(row.domainName, 'skyrimspecialedition');
        assert.equal(row.modCount, 1);
    });
});

describe('buildSort', () => {
    test('maps known keys with sensible directions', () => {
        assert.deepEqual(buildSort('downloads'), [{ downloads: { direction: 'DESC' } }]);
        assert.deepEqual(buildSort('name'),      [{ name: { direction: 'ASC' } }]);
        assert.deepEqual(buildSort('updated'),   [{ updatedAt: { direction: 'DESC' } }]);
    });
    test('unknown key falls back to endorsements', () => {
        assert.deepEqual(buildSort('bogus'), [{ endorsements: { direction: 'DESC' } }]);
    });
});

describe('shapeModDetail', () => {
    test('maps rich fields incl. tags / category / vortex', () => {
        const node = modNode({ modCategory: { name: 'Bug Fixes' }, tags: [{ name: 'A' }, { name: 'B' }], description: 'hello', supportsVortex: true });
        const d = shapeModDetail(node, 'skyrimspecialedition');
        assert.equal(d.category, 'Bug Fixes');
        assert.deepEqual(d.tags, ['A', 'B']);
        assert.equal(d.description, 'hello');
        assert.equal(d.supportsVortex, true);
        assert.equal(d.url, 'https://www.nexusmods.com/skyrimspecialedition/mods/12604');
    });
});

describe('getModsPage', () => {
    beforeAll(cleanup); beforeEach(cleanup); afterAll(cleanup);

    test('resolves domain from the cached entry and returns a shaped page', async () => {
        const fetchFn = mockFetch();
        await syncOne(489830, 'Skyrim Special Edition', { fetchFn });
        const page = await getModsPage(489830, { sort: 'downloads', offset: 6, limit: 3, fetchFn });
        assert.equal(page.domainName, 'skyrimspecialedition');
        assert.equal(page.offset, 6);
        assert.equal(page.limit, 3);
        assert.ok(page.totalCount > 0);
        assert.ok(page.mods.length >= 1);
        assert.equal(page.mods[0].url, 'https://www.nexusmods.com/skyrimspecialedition/mods/12604');
    });

    test('unmatched game returns an empty page', async () => {
        const fetchFn = mockFetch();
        await syncOne(999999, 'Totally Unknown Game', { fetchFn });
        const page = await getModsPage(999999, { fetchFn });
        assert.equal(page.domainName, null);
        assert.deepEqual(page.mods, []);
    });

    test('queries resolve from memory, not the NAS (survive on-disk deletion)', async () => {
        const fetchFn = mockFetch();
        await syncOne(489830, 'Skyrim Special Edition', { fetchFn });   // seeds memory + disk
        // Remove the on-disk entry: a query that still resolves proves it never re-read disk.
        await fs.rm(path.join(NEXUS_DIR, '489830.json'), { force: true });
        const page = await getModsPage(489830, { limit: 2, fetchFn });
        assert.equal(page.domainName, 'skyrimspecialedition');
    });
});

describe('getModDetail', () => {
    beforeAll(cleanup); beforeEach(cleanup); afterAll(cleanup);

    test('fetches, shapes, caches, and mirrors the hero image', async () => {
        const fetchFn = mockFetch({ nodes: [modNode({ description: 'Full desc', modCategory: { name: 'Bug Fixes' }, tags: [{ name: 'Lore' }] })] });
        await syncOne(489830, 'Skyrim Special Edition', { fetchFn });
        const d = await getModDetail(489830, 12604, { fetchFn });
        assert.equal(d.name, 'SkyUI');
        assert.equal(d.description, 'Full desc');
        assert.equal(d.category, 'Bug Fixes');
        assert.deepEqual(d.tags, ['Lore']);
        assert.equal(d.localImage, '/images/nexus/489830/12604.png');
        assert.ok(d.fetchedAt);
    });

    test('second call is served from cache (no refetch)', async () => {
        const fetchFn = mockFetch();
        await syncOne(489830, 'Skyrim Special Edition', { fetchFn });
        const d1 = await getModDetail(489830, 12604, { fetchFn });
        const graphqlAfter = fetchFn.calls.graphql;
        const d2 = await getModDetail(489830, 12604, { fetchFn });
        assert.equal(d2.fetchedAt, d1.fetchedAt);
        assert.equal(fetchFn.calls.graphql, graphqlAfter, 'cached detail must not refetch');
    });
});

describe('deep pull', () => {
    beforeAll(cleanup); beforeEach(cleanup); afterAll(cleanup);

    const poll = async (appid) => {
        let d;
        for (let i = 0; i < 100; i++) {
            await new Promise(r => setTimeout(r, 10));
            d = await getDeep(appid);
            if (d?.status === 'done' || d?.status === 'error') return d;
        }
        return d;
    };

    test('crawls the catalogue, includes adult mods, mirrors thumbnails, finishes done', async () => {
        const fetchFn = mockFetch({ nodes: [
            modNode(),
            modNode({ modId: 999, name: 'Adult Mod', adult: true }),
        ], totalCount: 2 });
        await syncOne(489830, 'Skyrim Special Edition', { fetchFn });

        const start = await startDeepPull(489830, { fetchFn });
        assert.equal(start.status, 'running');

        const d = await poll(489830);
        assert.equal(d.status, 'done');
        assert.equal(d.pulled, 2);
        assert.equal(d.total, 2);
        assert.equal(d.capped, false);
        assert.equal(d.mods.filter(m => m.adult).length, 1, 'adult mods are included');
        assert.ok(d.mods.every(m => m.localThumb), 'thumbnails mirrored for every mod');
    });

    test('unmatched game writes a done/empty dataset', async () => {
        const fetchFn = mockFetch();
        await syncOne(777777, 'Totally Unknown Game', { fetchFn });   // sentinel, domainName null
        await startDeepPull(777777, { fetchFn });
        const d = await poll(777777);
        assert.equal(d.status, 'done');
        assert.deepEqual(d.mods, []);
    });
});
