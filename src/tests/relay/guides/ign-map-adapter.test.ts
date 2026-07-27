// @ts-nocheck — the guides services are untyped .js, same as the sibling suites.
//
// Covers the IGN map adapter's normalization and tile geometry. The fixtures are
// synthetic but shaped from the live Palworld map (/maps/palworld/palpagos-islands),
// including the two quirks that broke a naive reading of the payload: `childTypes`
// arriving as `false` on leaf types, and an @2x sprite sheet declaring pixelRatio 1.
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
    extractNextData, normalizeMap, listMaps, mapNodeFrom, extractMapIndex,
    tileForLatLng, childTiles, tileExt, tileUrl, boundsForTiles,
} from '../../../lib/server/relay/guides/ign/map-adapter.js';

const TILE_TPL = 'https://tiles.mapgenie.io/games/palworld/1-0/default-v1/{z}/{x}/{y}.jpg';

const icon = (offsetX, offsetY) => ({
    __typename: 'MapIcon',
    width: 33, height: 44, offsetX, offsetY,
    anchorX: 16.5, anchorY: 44, pixelRatio: 1,
    url: 'https://oyster.ignimgs.com/ignmedia/wikimaps/defaults/markers/blank.png',
});

const marker = (id, typeSlug, extra = {}) => ({
    __typename: 'MapMarker',
    id, lat: 0.61, lng: -0.67,
    markerName: `Marker ${id}`, markerSlug: String(id),
    typeSlug, iconSlug: 'dungeon', regionId: 2359,
    wikiPage: null, checklistTaskId: 64695948,
    mapSlug: 'palpagos-islands', objectSlug: 'palworld',
    ...extra,
});

function payload({ overlays, types, initialTypes = [], maps = null } = {}) {
    const map = {
        __typename: 'Map',
        id: 'palworld:palpagos-islands',
        mapSlug: 'palpagos-islands', mapName: 'Palpagos Islands',
        objectSlug: 'palworld', objectName: 'Palworld',
        minZoom: 8, maxZoom: 16, initialZoom: 14,
        initialLat: 0.60779727, initialLng: -0.69693416,
        backgroundColor: null,
        tilesets: [TILE_TPL],
        markerSpriteUrl: 'https://cdn.mapgenie.io/images/games/palworld/markers@2x.png?MTgwODQx',
        object: { wikiSlug: 'palworld' },
        overlays, types: types ?? overlays, initialTypes,
    };
    return {
        props: { pageProps: { page: {
            wikiSlug: 'palworld',
            map,
            maps: maps ?? [{ mapSlug: 'palpagos-islands', mapName: 'Palpagos Islands', premium: false }],
        } } },
    };
}

// ── extractNextData ───────────────────────────────────────────────────────────

describe('extractNextData', () => {
    it('pulls and parses the __NEXT_DATA__ blob', () => {
        const html = `<html><body><script id="__NEXT_DATA__" type="application/json">{"a":1}</script></body></html>`;
        assert.deepEqual(extractNextData(html), { a: 1 });
    });

    it('throws a diagnosable error when the blob is absent (bot interstitial)', () => {
        assert.throws(() => extractNextData('<html><body>Just a moment…</body></html>'), /no __NEXT_DATA__/);
    });

    it('throws when the blob is present but malformed', () => {
        const html = `<script id="__NEXT_DATA__" type="application/json">{nope</script>`;
        assert.throws(() => extractNextData(html), /not valid JSON/);
    });
});

describe('mapNodeFrom', () => {
    it('rejects a page with no tilesets (e.g. the /maps index)', () => {
        const nd = { props: { pageProps: { page: {} } } };
        assert.throws(() => mapNodeFrom(nd), /no map with tilesets/);
    });
});

// ── normalizeMap ──────────────────────────────────────────────────────────────

describe('normalizeMap', () => {
    const nd = payload({
        overlays: [
            // Parent: real childTypes array, no markers of its own.
            { typeSlug: 1690, typeName: 'Locations', parentTypeSlug: null, markerIcon: null,
              legend: null, markerCount: 0, markers: [], childTypes: ['10308'], hasChildren: true },
            // Leaf: childTypes is literal `false`, not an empty array.
            { typeSlug: 10308, typeName: 'Dungeon', parentTypeSlug: 1690, markerIcon: icon(264, 44),
              legend: icon(264, 44), markerCount: 2, markers: [marker('a', 10308), marker('b', 10308)],
              childTypes: false, hasChildren: false },
        ],
        initialTypes: ['10308'],
    });

    const { map, remoteTileTemplate, spriteUrl } = normalizeMap(nd, 'https://www.ign.com/maps/palworld/palpagos-islands');

    it('carries the tileset template and sprite url out for the fetcher', () => {
        assert.equal(remoteTileTemplate, TILE_TPL);
        assert.match(spriteUrl, /markers@2x\.png/);
    });

    it('treats childTypes:false as no children rather than throwing', () => {
        const leaf = map.types.find(t => t.typeSlug === '10308');
        assert.deepEqual(leaf.children, []);
        const parent = map.types.find(t => t.typeSlug === '1690');
        assert.deepEqual(parent.children, ['10308']);
    });

    it('coerces every slug to a string so marker and type keys join', () => {
        assert.ok(map.types.every(t => typeof t.typeSlug === 'string'));
        assert.ok(map.markers.every(m => typeof m.typeSlug === 'string'));
        const known = new Set(map.types.map(t => t.typeSlug));
        assert.ok(map.markers.every(m => known.has(m.typeSlug)));
    });

    it('drops the blank placeholder icon url, keeping only sprite geometry', () => {
        const leaf = map.types.find(t => t.typeSlug === '10308');
        assert.equal(leaf.icon.url, undefined);
        assert.equal(leaf.icon.offsetX, 264);
        assert.equal(leaf.icon.anchorY, 44);
    });

    it('marks defaultOn from initialTypes', () => {
        assert.equal(map.types.find(t => t.typeSlug === '10308').defaultOn, true);
        assert.equal(map.types.find(t => t.typeSlug === '1690').defaultOn, false);
    });

    it('trusts the real markers array over a stale markerCount', () => {
        const stale = payload({
            overlays: [{ typeSlug: 10308, typeName: 'Dungeon', parentTypeSlug: null, markerIcon: icon(0, 0),
                         legend: null, markerCount: 999, markers: [marker('a', 10308)], childTypes: false }],
        });
        const out = normalizeMap(stale, 'u').map;
        assert.equal(out.types[0].markerCount, 1);
    });

    it('flattens overlays into one marker array, deduped by id', () => {
        const dupe = payload({
            overlays: [
                { typeSlug: 1, typeName: 'A', parentTypeSlug: null, markerIcon: icon(0, 0), legend: null,
                  markerCount: 1, markers: [marker('shared', 1)], childTypes: false },
                { typeSlug: 2, typeName: 'B', parentTypeSlug: null, markerIcon: icon(0, 0), legend: null,
                  markerCount: 1, markers: [marker('shared', 2)], childTypes: false },
            ],
        });
        const out = normalizeMap(dupe, 'u').map;
        assert.equal(out.markers.length, 1);
        // The marker's own typeSlug wins over the overlay it arrived in.
        assert.equal(out.markers[0].typeSlug, '1');
    });

    it('keeps the wiki slug that links a map back to its guide', () => {
        assert.equal(map.wikiSlug, 'palworld');
    });

    it('passes the view block through unchanged', () => {
        assert.deepEqual(map.view, {
            minZoom: 8, maxZoom: 16, initialZoom: 14,
            initialLat: 0.60779727, initialLng: -0.69693416, backgroundColor: null,
        });
    });

    it('throws when the sprite sheet is missing — markers would be invisible', () => {
        const nd2 = payload({ overlays: [] });
        nd2.props.pageProps.page.map.markerSpriteUrl = null;
        assert.throws(() => normalizeMap(nd2, 'u'), err => err.unsupported && /sprite sheet/.test(err.message));
    });

    // IGN runs two unrelated map backends behind one URL shape. An 'ign'-type map
    // (Cyberpunk 2077's Night City) parses far enough to look plausible and then
    // yields a broken tile path — {z}/{x}-{y} on ignimgs, with per-type icon files
    // instead of a sprite. It must be refused as unsupported, not half-read, and
    // the error must be typed so a guide download can skip it and still succeed.
    it('refuses an IGN-native map rather than half-reading it', () => {
        const nd2 = payload({ overlays: [] });
        nd2.props.pageProps.page.map.mapType = 'ign';
        assert.throws(() => normalizeMap(nd2, 'u'), err => err.unsupported && /mapType: "ign"/.test(err.message));
    });
});

describe('listMaps', () => {
    it('enumerates sibling maps from any one map page', () => {
        const nd = payload({
            overlays: [],
            maps: [
                { mapSlug: 'a', mapName: 'A', premium: false },
                { mapSlug: 'b', mapName: 'B', premium: true },
            ],
        });
        assert.deepEqual(listMaps(nd), [
            { mapSlug: 'a', mapName: 'A', premium: false, markerCount: null },
            { mapSlug: 'b', mapName: 'B', premium: true,  markerCount: null },
        ]);
    });
});

// ── extractMapIndex ───────────────────────────────────────────────────────────

// /maps/{game} is an INDEX page, not a redirect to the primary map: it carries no
// `page.map` and no tilesets, and its list lives at `page.mapData.maps`. Reading it
// is how discovery stays cheap — ~140kb against ~3.8mb for a map page.
describe('extractMapIndex', () => {
    const index = (maps) => ({ props: { pageProps: { page: { mapData: { maps } } } } });

    it('reads the map list off an index page', () => {
        assert.deepEqual(
            extractMapIndex(index([
                { mapSlug: 'palpagos-islands', mapName: 'Palpagos Islands', premium: false, markerCount: 11138 },
            ])),
            [{ mapSlug: 'palpagos-islands', mapName: 'Palpagos Islands', premium: false, markerCount: 11138 }],
        );
    });

    it('returns [] for a game with no interactive map', () => {
        assert.deepEqual(extractMapIndex(index(undefined)), []);
        assert.deepEqual(extractMapIndex({ props: { pageProps: { page: {} } } }), []);
        assert.deepEqual(extractMapIndex({}), []);
    });

    it('skips malformed entries rather than emitting slugless maps', () => {
        assert.deepEqual(
            extractMapIndex(index([{ mapName: 'No slug' }, { mapSlug: 'ok', mapName: 'Ok' }])),
            [{ mapSlug: 'ok', mapName: 'Ok', premium: false, markerCount: null }],
        );
    });
});

// ── Tile geometry ─────────────────────────────────────────────────────────────

describe('tileForLatLng', () => {
    // Verified against the live CDN: these coordinates return 200 JPEGs, and the
    // neighbours outside the map's extent return 403. Standard Web Mercator, which
    // is why the viewer can use Leaflet's default CRS.
    it('matches the tiles Map Genie actually serves for the Palworld centre', () => {
        assert.deepEqual(tileForLatLng(0.60779727, -0.69693416, 8),  { x: 127,  y: 127  });
        assert.deepEqual(tileForLatLng(0.60779727, -0.69693416, 10), { x: 510,  y: 510  });
        assert.deepEqual(tileForLatLng(0.60779727, -0.69693416, 14), { x: 8160, y: 8164 });
    });

    it('places 0,0 at the middle of the world grid', () => {
        assert.deepEqual(tileForLatLng(0, 0, 1), { x: 1, y: 1 });
    });
});

describe('childTiles', () => {
    it('returns the four children one zoom level down', () => {
        assert.deepEqual(childTiles(127, 127), [[254, 254], [255, 254], [254, 255], [255, 255]]);
    });
});

describe('tileUrl', () => {
    it('expands z/x/y into the template', () => {
        assert.equal(
            tileUrl(TILE_TPL, 14, 8160, 8164),
            'https://tiles.mapgenie.io/games/palworld/1-0/default-v1/14/8160/8164.jpg',
        );
    });
});

describe('tileExt', () => {
    it('reads the extension off the template', () => {
        assert.equal(tileExt(TILE_TPL), '.jpg');
        assert.equal(tileExt('https://x/{z}/{x}/{y}.PNG'), '.png');
    });

    it('falls back to .jpg for a template with no extension', () => {
        assert.equal(tileExt('https://x/{z}/{x}/{y}'), '.jpg');
    });
});

describe('boundsForTiles', () => {
    it('returns null for an empty tile set', () => {
        assert.equal(boundsForTiles([], 8), null);
    });

    it('wraps a single tile in its own corners, not a point', () => {
        const [[south, west], [north, east]] = boundsForTiles([[127, 127]], 8);
        // Tile 127/127 at z8 spans lng -1.40625..0 and lat 0..~1.406.
        assert.ok(Math.abs(west - -1.40625) < 1e-9, `west ${west}`);
        assert.ok(Math.abs(east - 0) < 1e-9, `east ${east}`);
        assert.ok(south < north, 'south must be below north');
        assert.ok(Math.abs(south - 0) < 1e-9, `south ${south}`);
        assert.ok(north > 1.4 && north < 1.41, `north ${north}`);
    });

    it('spans the full extent of a multi-tile rectangle', () => {
        const tiles = [[254, 254], [255, 254], [254, 255], [255, 255]];
        const [[south, west], [north, east]] = boundsForTiles(tiles, 9);
        // The same ground area as tile 127/127 at z8 — one level up, four tiles.
        assert.ok(Math.abs(west - -1.40625) < 1e-9, `west ${west}`);
        assert.ok(Math.abs(east - 0) < 1e-9, `east ${east}`);
        assert.ok(Math.abs(south - 0) < 1e-9, `south ${south}`);
        assert.ok(north > 1.4 && north < 1.41, `north ${north}`);
    });
});
