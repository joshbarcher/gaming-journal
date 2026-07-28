// @ts-nocheck — the guides services are untyped .js, same as the sibling suites.
//
// Game8's map API normalised into the shape the IGN adapter already produces.
// Fixtures are synthetic but shaped from the two live maps checked during this
// work: The Adventures of Elliot (4 "Age of" areas, 666 markers) and Crimson
// Desert (6 regions, 1,610 markers, 107 classifications). The cases pinned here
// are the ones those two maps actually disagreed on.
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
    normalizeGame8Map, buildTypeTree, parseCoordinate, extFromUrl,
    slugify, collectIconUrls, assertMapping, GAME8_GRID,
} from '../../../lib/server/relay/guides/game8/map-adapter.js';
import { sanitizePopupHtml } from '../../../lib/server/relay/guides/game8/map-fetcher.js';

const marker = (over = {}) => ({
    id: '1', title: 'A chest', description: '', url: '',
    area: 'Age of Magic', pinIcon: 'https://img.game8.co/1/a.png/show',
    coordinate: '100,50', classification: 'Blue Chest', htmlContent: '<div>x</div>',
    ...over,
});

const payload = (over = {}) => ({
    toolKey: 'k', headingText: 'Test Map',
    tileLayerMode: false, maxZoom: 5, fileExtension: 'jpg',
    tileMaps: [{ title: '', mapDirectoryName: '' }],
    areas: [{ title: 'Age of Magic', url: 'https://img.game8.co/1/a.jpeg/original' }],
    classificationGroups: [{ groupName: 'Collectibles', classifications: ['Blue Chest', 'Red Chest'] }],
    coordinateArraySchema: { coordinates: [marker()] },
    ...over,
});

// ── Coordinates ───────────────────────────────────────────────────────────────

describe('parseCoordinate', () => {
    // Game8's own bundle converts with coord * (imageSize / 256), so the grid is
    // 256 — and Leaflet's lat axis points up while image y points down.
    it('flips y against the 256 grid for CRS.Simple', () => {
        assert.deepEqual(parseCoordinate('100,50'), { lat: GAME8_GRID - 50, lng: 100 });
        assert.deepEqual(parseCoordinate('0,0'), { lat: 256, lng: 0 });
    });

    it('handles decimals as shipped', () => {
        assert.deepEqual(parseCoordinate('101.52,109.52'), { lat: 256 - 109.52, lng: 101.52 });
    });

    // Crimson Desert ships exactly one marker with an empty coordinate.
    it('returns null for unplottable coordinates rather than placing at 0,0', () => {
        assert.equal(parseCoordinate(''), null);
        assert.equal(parseCoordinate('100'), null);
        assert.equal(parseCoordinate('a,b'), null);
        assert.equal(parseCoordinate(null), null);
        assert.equal(parseCoordinate(undefined), null);
    });
});

// ── Image extension ───────────────────────────────────────────────────────────

describe('extFromUrl', () => {
    // The payload's `fileExtension` describes TILES. Crimson Desert declares
    // "jpg" while serving .gif area images, so the URL is the only truth.
    it('reads the extension from the URL, through a trailing path segment', () => {
        assert.equal(extFromUrl('https://img.game8.co/1/a.gif/original'), '.gif');
        assert.equal(extFromUrl('https://img.game8.co/1/a.jpeg/original'), '.jpeg');
        assert.equal(extFromUrl('https://img.game8.co/1/a.png/show'), '.png');
    });

    it('falls back when there is no usable extension', () => {
        assert.equal(extFromUrl('https://img.game8.co/1/a', '.jpg'), '.jpg');
        assert.equal(extFromUrl(null, '.jpg'), '.jpg');
    });
});

describe('slugify', () => {
    it('produces stable slugs for area and classification names', () => {
        assert.equal(slugify('Age of Safekeeping'), 'age-of-safekeeping');
        assert.equal(slugify("Faie's Ignite Required"), 'faie-s-ignite-required');
        assert.equal(slugify('The Abyss'), 'the-abyss');
    });

    it('never yields an empty slug', () => {
        assert.equal(slugify(''), 'map');
        assert.equal(slugify('---'), 'map');
    });
});

// ── Areas become maps ─────────────────────────────────────────────────────────

describe('normalizeGame8Map', () => {
    it('splits each area into its own map, partitioning the markers', () => {
        const p = payload({
            areas: [
                { title: 'Age of Magic', url: 'https://img.game8.co/1/a.jpeg/original' },
                { title: 'Age of Budding', url: 'https://img.game8.co/2/b.jpeg/original' },
            ],
            coordinateArraySchema: { coordinates: [
                marker({ id: '1', area: 'Age of Magic' }),
                marker({ id: '2', area: 'Age of Budding' }),
                marker({ id: '3', area: 'Age of Budding' }),
            ] },
        });
        const maps = normalizeGame8Map(p, {});
        assert.equal(maps.length, 2);
        assert.deepEqual(maps.map(m => m.mapSlug), ['age-of-magic', 'age-of-budding']);
        assert.equal(maps[0].markers.length, 1);
        assert.equal(maps[1].markers.length, 2);
    });

    it('keeps every plottable marker across the split', () => {
        const coords = [];
        for (let i = 0; i < 50; i++) coords.push(marker({ id: String(i), area: i % 2 ? 'A' : 'B' }));
        const p = payload({
            areas: [{ title: 'A', url: 'https://x/a.jpg/original' }, { title: 'B', url: 'https://x/b.jpg/original' }],
            coordinateArraySchema: { coordinates: coords },
        });
        const maps = normalizeGame8Map(p, {});
        assert.equal(maps.reduce((a, m) => a + m.markers.length, 0), 50);
    });

    it('reports skipped markers instead of silently losing them', () => {
        const p = payload({ coordinateArraySchema: { coordinates: [
            marker({ id: '1' }),
            marker({ id: '2', coordinate: '' }),
        ] } });
        const maps = normalizeGame8Map(p, {});
        assert.equal(maps[0].markers.length, 1);
        assert.equal(maps[0].skipped.length, 1);
        assert.equal(maps[0].skipped[0].id, '2');
    });

    // A marker naming an area that doesn't exist would otherwise vanish.
    it('rehomes markers whose area matches no declared area', () => {
        const p = payload({ coordinateArraySchema: { coordinates: [
            marker({ id: '1', area: 'Age of Magic' }),
            marker({ id: '2', area: 'Nowhere' }),
        ] } });
        const maps = normalizeGame8Map(p, {});
        assert.equal(maps[0].markers.length, 2);
    });

    it('takes the image extension from the area url, not fileExtension', () => {
        // Crimson Desert's exact combination: fileExtension "jpg", .gif images.
        const p = payload({
            fileExtension: 'jpg',
            areas: [{ title: 'Hernand', url: 'https://img.game8.co/1/a.gif/original' }],
            coordinateArraySchema: { coordinates: [marker({ area: 'Hernand' })] },
        });
        assert.equal(normalizeGame8Map(p, {})[0].imageExt, '.gif');
    });

    it('carries tiled mode and its fields through', () => {
        const p = payload({
            tileLayerMode: true, maxZoom: 7, fileExtension: 'jpg',
            tileMaps: [{ title: 'Hernand', mapDirectoryName: 'Hernand' }],
            areas: [{ title: 'Hernand', url: null }],
            coordinateArraySchema: { coordinates: [marker({ area: 'Hernand' })] },
        });
        const m = normalizeGame8Map(p, {})[0];
        assert.equal(m.tiled, true);
        assert.equal(m.tileDirectory, 'Hernand');
        assert.equal(m.maxZoom, 7);
        assert.equal(m.tileExt, '.jpg');
    });

    it('rejects a payload that is not an interactive map', () => {
        assert.throws(() => assertMapping({}), err => err.unsupported);
        assert.throws(() => assertMapping({ coordinateArraySchema: { coordinates: [] }, areas: [] }),
            err => err.unsupported);
    });
});

// ── Type tree ─────────────────────────────────────────────────────────────────

describe('buildTypeTree', () => {
    const groups = [
        { groupName: 'Collectibles', classifications: ['Blue Chest', 'Red Chest'] },
        { groupName: 'Shrines', classifications: ['Mystic Shrine'] },
    ];

    it('builds parents over the classifications actually present', () => {
        const types = buildTypeTree({ classificationGroups: groups }, [
            marker({ classification: 'Blue Chest' }),
            marker({ classification: 'Blue Chest' }),
        ]);
        const parents = types.filter(t => !t.parentTypeSlug);
        const leaves = types.filter(t => t.parentTypeSlug);
        assert.equal(parents.length, 1);              // Shrines has no markers here
        assert.equal(leaves.length, 1);
        assert.equal(leaves[0].markerCount, 2);
    });

    // Crimson Desert declares 107 classifications; any one region uses a fraction.
    // Listing the unused ones would make the filter list unusable.
    it('omits classifications with no markers in this area', () => {
        const types = buildTypeTree({ classificationGroups: groups }, [marker({ classification: 'Red Chest' })]);
        assert.deepEqual(types.filter(t => t.parentTypeSlug).map(t => t.typeName), ['Red Chest']);
    });

    it('surfaces ungrouped classifications under Other rather than dropping them', () => {
        const types = buildTypeTree({ classificationGroups: groups }, [marker({ classification: 'Mystery' })]);
        const other = types.find(t => t.typeSlug === 'g-other');
        assert.ok(other, 'expected a synthetic Other group');
        assert.ok(types.some(t => t.typeName === 'Mystery' && t.parentTypeSlug === 'g-other'));
    });

    it('takes each layer icon from its first marker', () => {
        const types = buildTypeTree({ classificationGroups: groups }, [
            marker({ classification: 'Blue Chest', pinIcon: 'https://img/one.png/show' }),
            marker({ classification: 'Blue Chest', pinIcon: 'https://img/two.png/show' }),
        ]);
        assert.equal(types.find(t => t.typeSlug === 'blue-chest').iconUrl, 'https://img/one.png/show');
    });

    it('produces no duplicate type slugs', () => {
        const types = buildTypeTree({ classificationGroups: groups }, [
            marker({ classification: 'Blue Chest' }), marker({ classification: 'Red Chest' }),
            marker({ classification: 'Mystic Shrine' }),
        ]);
        const slugs = types.map(t => t.typeSlug);
        assert.equal(new Set(slugs).size, slugs.length);
    });
});

// ── Popup HTML sanitising ─────────────────────────────────────────────────────

// Every Game8 marker carries rich markup, which the viewer renders with {@html}.
// It is sanitised once at FETCH time so what lands on disk is already safe — a
// different consumer of map.json cannot bypass it. These are the cases that
// matter; the allowlist is deny-by-default, so anything unlisted is dropped.
describe('sanitizePopupHtml', () => {
    it('keeps the table markup the popups are built from', () => {
        const out = sanitizePopupHtml(`<div><table class="a-table"><tr><td colspan="2">Drop</td></tr></table></div>`);
        assert.match(out, /<table>/);
        assert.match(out, /colspan="2"/);
        assert.match(out, /Drop/);
        assert.doesNotMatch(out, /class=/);          // presentational attrs dropped
    });

    it('removes scripts and their contents', () => {
        assert.equal(sanitizePopupHtml('<div>ok<script>alert(1)</script></div>'), '<div>ok</div>');
    });

    it('strips every event handler', () => {
        for (const attr of ['onclick', 'onerror', 'onload', 'onmouseover']) {
            const out = sanitizePopupHtml(`<div ${attr}="evil()">text</div>`);
            assert.doesNotMatch(out, /evil/);
            assert.doesNotMatch(out, new RegExp(attr, 'i'));
        }
    });

    it('drops non-http URLs on links and images', () => {
        assert.doesNotMatch(sanitizePopupHtml('<a href="javascript:alert(1)">x</a>'), /javascript/i);
        assert.doesNotMatch(sanitizePopupHtml('<img src="data:text/html,evil" alt="a">'), /data:/i);
        assert.doesNotMatch(sanitizePopupHtml('<a href="vbscript:evil">x</a>'), /vbscript/i);
    });

    it('keeps http(s) links but denies them opener access', () => {
        const out = sanitizePopupHtml('<a href="https://game8.co/x">x</a>');
        assert.match(out, /href="https:\/\/game8\.co\/x"/);
        assert.match(out, /rel="noopener noreferrer"/);
        assert.match(out, /target="_blank"/);
    });

    it('removes embedded frames and forms entirely', () => {
        assert.equal(sanitizePopupHtml('<iframe src="//evil"></iframe>keep'), 'keep');
        assert.doesNotMatch(sanitizePopupHtml('<form><input name="p"></form>text'), /input|form/i);
    });

    it('unwraps unknown tags rather than losing their text', () => {
        assert.equal(sanitizePopupHtml('<marquee>text</marquee>'), 'text');
    });

    it('returns null for empty input so the popup renders nothing', () => {
        assert.equal(sanitizePopupHtml(''), null);
        assert.equal(sanitizePopupHtml(null), null);
        assert.equal(sanitizePopupHtml('<script></script>'), null);
    });
});

describe('collectIconUrls', () => {
    it('dedupes icons across every area', () => {
        const maps = [
            { types: [{ iconUrl: 'a' }, { iconUrl: 'b' }] },
            { types: [{ iconUrl: 'b' }, { iconUrl: null }] },
        ];
        assert.deepEqual(collectIconUrls(maps).sort(), ['a', 'b']);
    });
});
