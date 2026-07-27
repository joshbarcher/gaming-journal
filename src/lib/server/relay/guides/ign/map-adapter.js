/**
 * IGN interactive-map adapter — pulls the map payload out of a map page and
 * normalises it to the shape in contracts/ignMap.ts.
 *
 * IGN's map pages (/maps/{objectSlug}/{mapSlug}) are Next.js SSR and embed the
 * complete map in their `__NEXT_DATA__` script tag: config, the marker type
 * tree, and every marker. There is no markers API to page through — one GET of
 * the page is the whole dataset. For Palworld that is a 4.4mb document holding
 * 11,138 markers across 51 types.
 *
 * IGN maps are white-labelled Map Genie (`map.mapType === 'mapgenie'`), so the
 * tiles and the marker sprite come from mapgenie CDNs rather than ignimgs.
 *
 * No parsing of rendered HTML happens here — unlike the wiki adapter there are
 * no selectors to keep up with, only the JSON contract.
 */

// ── __NEXT_DATA__ extraction ──────────────────────────────────────────────────

const NEXT_DATA_RE =
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i;

/**
 * Pull and parse the __NEXT_DATA__ blob from a map page's HTML.
 *
 * @param {string} html
 * @returns {object} the parsed Next.js payload
 */
export function extractNextData(html) {
    const m = html.match(NEXT_DATA_RE);
    if (!m) {
        throw new Error(
            'IGN map adapter: no __NEXT_DATA__ script found. ' +
            'The page may be a bot-block interstitial, or IGN changed its rendering.'
        );
    }
    try {
        return JSON.parse(m[1]);
    } catch (err) {
        throw new Error(`IGN map adapter: __NEXT_DATA__ was not valid JSON — ${err.message}`);
    }
}

/**
 * Thrown for a map this adapter cannot read. Distinct from a fetch failure so a
 * guide download can skip the map and still succeed.
 *
 * IGN serves two unrelated map backends behind the same URL shape:
 *   mapType 'mapgenie' — white-labelled Map Genie. Tiles at {z}/{x}/{y} on
 *                        tiles.mapgenie.io, one sprite sheet for all markers,
 *                        deep pyramids (Palworld z8-16). This is what we support.
 *   mapType 'ign'      — IGN's own system. Tiles at {z}/{x}-{y} on ignimgs
 *                        (note the dash), no sprite sheet at all — each marker
 *                        type carries its own icon PNG — and shallow pyramids
 *                        (Cyberpunk 2077 is z2-5). Needs its own fetcher.
 */
export class UnsupportedMapError extends Error {
    constructor(message) {
        super(message);
        this.name = 'UnsupportedMapError';
        this.unsupported = true;
    }
}

/** The map object inside a parsed __NEXT_DATA__ payload, or throw. */
export function mapNodeFrom(nextData) {
    const page = nextData?.props?.pageProps?.page;
    const map  = page?.map;
    if (!map?.tilesets?.length) {
        throw new Error(
            'IGN map adapter: page has no map with tilesets. ' +
            'Check the URL is a /maps/{game}/{map} page and not the /maps index.'
        );
    }
    return { page, map };
}

/**
 * List the maps a game offers, from any one of its map pages.
 * `page.maps` carries every sibling map, so a single fetch enumerates them all.
 *
 * @returns {Array<{mapSlug: string, mapName: string, premium: boolean}>}
 */
export function listMaps(nextData) {
    const { page } = mapNodeFrom(nextData);
    return (page.maps ?? []).map(m => ({
        mapSlug: m.mapSlug,
        mapName: m.mapName,
        premium: Boolean(m.premium),
        markerCount: m.markerCount ?? null,
    }));
}

/**
 * List a game's maps from its /maps/{objectSlug} INDEX page.
 *
 * The index is a different shape from a map page — no `page.map`, no tilesets,
 * and the list lives at `page.mapData.maps`. It is also two orders of magnitude
 * smaller (~140kb vs ~3.8mb for Palworld, which inlines all 11k markers), so it
 * is the right thing to hit when all you need is "does this game have a map".
 *
 * Returns [] when the page carries no map list, which is how a game with no
 * interactive map presents — IGN serves the route regardless.
 *
 * @returns {Array<{mapSlug, mapName, premium, markerCount}>}
 */
export function extractMapIndex(nextData) {
    const maps = nextData?.props?.pageProps?.page?.mapData?.maps;
    if (!Array.isArray(maps)) return [];
    return maps
        .filter(m => m?.mapSlug)
        .map(m => ({
            mapSlug:     m.mapSlug,
            mapName:     m.mapName ?? m.mapSlug,
            premium:     Boolean(m.premium),
            markerCount: m.markerCount ?? null,
        }));
}

// ── Normalisation ─────────────────────────────────────────────────────────────

// IGN ships a `url` on every MapIcon pointing at a blank placeholder PNG
// (identical across all 51 Palworld types). The real artwork is the sprite sheet
// at `map.markerSpriteUrl`, windowed by offsetX/offsetY — so the url is dropped
// and only the geometry kept.
function normalizeIcon(icon) {
    if (!icon) return null;
    const out = {
        width:      icon.width,
        height:     icon.height,
        offsetX:    icon.offsetX,
        offsetY:    icon.offsetY,
        pixelRatio: icon.pixelRatio ?? 1,
    };
    // Absent on the `legend` variant, which is drawn unanchored as a swatch.
    if (typeof icon.anchorX === 'number') out.anchorX = icon.anchorX;
    if (typeof icon.anchorY === 'number') out.anchorY = icon.anchorY;
    return out;
}

/**
 * Build the type tree.
 *
 * `map.overlays` is the richest source — same fields as `map.types` plus the
 * resolved icon, child list and the markers themselves — so types are derived
 * from it and `map.types` is used only where an overlay is missing.
 * `map.initialTypes` lists the layers IGN switches on at first load.
 */
function normalizeTypes(map) {
    const overlays  = map.overlays ?? [];
    const defaultOn = new Set((map.initialTypes ?? []).map(String));
    const bySlug    = new Map(overlays.map(o => [String(o.typeSlug), o]));

    // Fall back to map.types for any type IGN lists but ships no overlay for.
    for (const t of map.types ?? []) {
        const slug = String(t.typeSlug);
        if (!bySlug.has(slug)) bySlug.set(slug, t);
    }

    return [...bySlug.values()].map(o => ({
        typeSlug:       String(o.typeSlug),
        typeName:       o.typeName ?? String(o.typeSlug),
        parentTypeSlug: o.parentTypeSlug == null ? null : String(o.parentTypeSlug),
        icon:           normalizeIcon(o.markerIcon),
        legend:         normalizeIcon(o.legend),
        // markerCount is 0 on parent types; trust the array we actually got.
        markerCount:    Array.isArray(o.markers) ? o.markers.length : (o.markerCount ?? 0),
        // `childTypes` is an array on the 8 parent types and literal `false` on
        // the 43 leaves — not absent, so a `?? []` default doesn't catch it.
        children:       Array.isArray(o.childTypes) ? o.childTypes.map(String) : [],
        defaultOn:      defaultOn.has(String(o.typeSlug)),
    }));
}

/** Flatten overlays[].markers into one array, deduped by marker id. */
function normalizeMarkers(map) {
    const seen = new Set();
    const out  = [];
    for (const overlay of map.overlays ?? []) {
        for (const mk of overlay.markers ?? []) {
            const id = String(mk.id);
            if (seen.has(id)) continue;
            seen.add(id);
            out.push({
                id,
                lat:             mk.lat,
                lng:             mk.lng,
                name:            mk.markerName ?? '',
                slug:            String(mk.markerSlug ?? ''),
                // Prefer the marker's own type over the overlay it arrived in —
                // they agree today, but the marker is the authoritative field.
                typeSlug:        String(mk.typeSlug ?? overlay.typeSlug),
                iconSlug:        mk.iconSlug ?? null,
                regionId:        mk.regionId ?? null,
                wikiPage:        mk.wikiPage ?? null,
                checklistTaskId: mk.checklistTaskId ?? null,
            });
        }
    }
    return out;
}

/**
 * Normalise a fetched map page into the map.json contract, minus the `tiles`
 * block — the fetcher fills that in once the pyramid is on disk.
 *
 * @param {object} nextData - parsed __NEXT_DATA__
 * @param {string} sourceUrl
 * @returns {{ map: object, remoteTileTemplate: string, spriteUrl: string }}
 */
export function normalizeMap(nextData, sourceUrl) {
    const { page, map } = mapNodeFrom(nextData);

    // Gate on the backend before reading anything else — an 'ign'-type map parses
    // far enough to look plausible and then produces a broken tile path.
    if (map.mapType && map.mapType !== 'mapgenie') {
        throw new UnsupportedMapError(
            `Map "${map.mapSlug}" uses IGN's own map backend (mapType: "${map.mapType}"), ` +
            `not Map Genie. Its tiles use a {z}/{x}-{y} path and it has per-type icon ` +
            `files rather than a sprite sheet, so it needs a separate fetcher.`
        );
    }

    const remoteTileTemplate = map.tilesets[0];
    const spriteUrl          = map.markerSpriteUrl;
    if (!spriteUrl) {
        throw new UnsupportedMapError(`Map "${map.mapSlug}" has no marker sprite sheet — markers would be invisible.`);
    }

    const types   = normalizeTypes(map);
    const markers = normalizeMarkers(map);

    return {
        remoteTileTemplate,
        spriteUrl,
        map: {
            schemaVersion: 1,
            id:         map.id,
            mapSlug:    map.mapSlug,
            mapName:    map.mapName,
            objectSlug: map.objectSlug,
            objectName: map.objectName,
            // Equal to objectSlug on every map checked — this is what lets a
            // downloaded wiki guide find its map without a lookup.
            wikiSlug:   map.object?.wikiSlug ?? page.wikiSlug ?? null,
            sourceUrl,
            fetchedAt:  new Date().toISOString(),
            view: {
                minZoom:         map.minZoom,
                maxZoom:         map.maxZoom,
                initialZoom:     map.initialZoom,
                initialLat:      map.initialLat,
                initialLng:      map.initialLng,
                backgroundColor: map.backgroundColor ?? null,
            },
            sprite: { file: 'sprite.png', remoteUrl: spriteUrl },
            types,
            markers,
        },
    };
}

// ── Tile geometry ─────────────────────────────────────────────────────────────

/**
 * Web Mercator (EPSG:3857) lat/lng → XYZ tile coordinate.
 *
 * Map Genie serves ordinary slippy tiles: the tile computed here for a map's
 * initialLat/initialLng is exactly the one its viewer requests, which is why the
 * client can use Leaflet's default CRS rather than CRS.Simple.
 */
export function tileForLatLng(lat, lng, z) {
    const n = 2 ** z;
    const r = (lat * Math.PI) / 180;
    return {
        x: Math.floor(((lng + 180) / 360) * n),
        y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n),
    };
}

/** Expand a remote tile template. */
export function tileUrl(template, z, x, y) {
    return template
        .replace('{z}', String(z))
        .replace('{x}', String(x))
        .replace('{y}', String(y));
}

/** The four child tiles of a tile, at the next zoom level down. */
export function childTiles(x, y) {
    return [
        [x * 2,     y * 2    ],
        [x * 2 + 1, y * 2    ],
        [x * 2,     y * 2 + 1],
        [x * 2 + 1, y * 2 + 1],
    ];
}

/** File extension of a tile template, e.g. ".jpg". */
export function tileExt(template) {
    const m = template.match(/\.([a-z0-9]+)(?:\?|$)/i);
    return m ? `.${m[1].toLowerCase()}` : '.jpg';
}

/** Inverse of tileForLatLng — the north-west corner of tile (x, y) at zoom z. */
function latLngForTile(x, y, z) {
    const n = 2 ** z;
    const lngDeg = (x / n) * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
    return { lat: (latRad * 180) / Math.PI, lng: lngDeg };
}

/**
 * Geographic bounds of a rectangle of tiles, as [[south, west], [north, east]].
 *
 * A game map covers a tiny patch of the Web Mercator world (Palworld is a single
 * tile at z8), so without this the viewer lets you pan off into empty grey and
 * lose the map entirely. Derived from the tiles actually written rather than
 * guessed from marker spread, which would crop anything unmarked.
 *
 * @param {Array<[number, number]>} tiles - [x, y] pairs at zoom `z`
 */
export function boundsForTiles(tiles, z) {
    if (!tiles.length) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of tiles) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    // +1 walks to the far edge of the last tile — tile coords name corners.
    const nw = latLngForTile(minX, minY, z);
    const se = latLngForTile(maxX + 1, maxY + 1, z);
    return [[se.lat, nw.lng], [nw.lat, se.lng]];
}
