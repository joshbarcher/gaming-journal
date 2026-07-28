/**
 * Game8 interactive-map adapter — normalises Game8's map API into the same
 * shape the IGN adapter produces, so one viewer renders both.
 *
 * Game8 maps are NOT Map Genie. The whole map comes from one JSON endpoint:
 *
 *   GET game8.co/api/tool_structural_mappings/{toolId}.json
 *
 * The tool id is not derivable from the article URL — it has to be observed
 * from the page's own network traffic (see map-fetcher.js). Everything else is
 * in that single payload: areas, markers, classifications and icon URLs.
 *
 * Three structural differences from IGN, all of which the normalized output
 * flattens away for the viewer:
 *
 *  1. Coordinates are a fixed 256x256 virtual grid, not Web Mercator. Game8's
 *     own bundle converts with `coord * (imageSize / 256)`, which is where the
 *     256 comes from — it is their constant, not an inference from the data.
 *  2. A map is split into `areas` (Crimson Desert's six regions, Elliot's four
 *     "Age of" states). Each area has its own base image and its own markers,
 *     so each becomes a separate map — exactly how IGN's sibling maps already
 *     work, which means the map switcher and per-map filters apply unchanged.
 *  3. Icons are per-classification PNGs rather than one sprite sheet.
 *
 * `tileLayerMode` selects between a single base image per area and a tile
 * pyramid. Both observed games are image-mode, but the tiled fields are clearly
 * live, so both are handled.
 */

// Game8's virtual coordinate grid. From their `cursorPinCalculation` chunk:
//   toPixels(coord, imageSize) = coord * (imageSize / 256)
//   toCoord(pixels, imageSize) = pixels * (256 / imageSize)
export const GAME8_GRID = 256;

// ── Helpers ───────────────────────────────────────────────────────────────────

export function slugify(text) {
    return String(text ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'map';
}

/**
 * Image extension from a URL.
 *
 * Deliberately NOT taken from the payload's `fileExtension`: that field
 * describes TILE files, and Crimson Desert declares "jpg" while serving its
 * area images as .gif. Trusting it writes .jpg files holding GIF bytes.
 */
export function extFromUrl(url, fallback = '.png') {
    try {
        const m = new URL(url).pathname.match(/\.([a-z0-9]+)(?:\/|$)/i);
        return m ? `.${m[1].toLowerCase()}` : fallback;
    } catch {
        return fallback;
    }
}

/**
 * Parse a `"x,y"` coordinate string into Leaflet CRS.Simple lat/lng.
 *
 * Leaflet's lat axis points up while image y points down, so lat is flipped
 * against the grid height. Storing it pre-flipped keeps the marker shape
 * identical to IGN's — the viewer plots `[lat, lng]` either way and only the
 * CRS differs.
 *
 * @returns {{lat: number, lng: number}|null} null when unparseable
 */
export function parseCoordinate(raw, grid = GAME8_GRID) {
    if (typeof raw !== 'string') return null;
    const parts = raw.split(',');
    if (parts.length < 2) return null;
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { lat: grid - y, lng: x };
}

// ── Payload access ────────────────────────────────────────────────────────────

export class UnsupportedGame8MapError extends Error {
    constructor(message) {
        super(message);
        this.name = 'UnsupportedGame8MapError';
        this.unsupported = true;
    }
}

/** Validate the payload far enough to fail with something diagnosable. */
export function assertMapping(payload) {
    const coords = payload?.coordinateArraySchema?.coordinates;
    if (!Array.isArray(coords)) {
        throw new UnsupportedGame8MapError(
            'Game8 mapping has no coordinateArraySchema.coordinates — not an interactive map.'
        );
    }
    if (!Array.isArray(payload.areas) || payload.areas.length === 0) {
        throw new UnsupportedGame8MapError('Game8 mapping declares no areas.');
    }
    return payload;
}

/**
 * Build the classification -> group lookup.
 *
 * `classificationGroups` is the authoritative two-level tree (Crimson Desert:
 * 7 groups over 107 classifications). A classification a marker uses but no
 * group claims is surfaced under a synthetic "Other" parent rather than
 * dropped, so no marker becomes unreachable through the filter UI.
 */
export function buildTypeTree(payload, markersForArea) {
    const groups = Array.isArray(payload.classificationGroups) ? payload.classificationGroups : [];

    const groupOf = new Map();          // classification -> group name
    for (const g of groups) {
        for (const c of g.classifications ?? []) groupOf.set(c, g.groupName);
    }

    // Only classifications with markers IN THIS AREA get a row — Crimson Desert
    // declares 107 across the whole game but any one region uses far fewer, and
    // listing empty layers makes the filter list useless.
    const counts = new Map();
    const iconOf = new Map();
    for (const m of markersForArea) {
        counts.set(m.classification, (counts.get(m.classification) ?? 0) + 1);
        if (!iconOf.has(m.classification) && m.pinIcon) iconOf.set(m.classification, m.pinIcon);
    }

    const types = [];
    const seenParents = new Set();

    // Parents first, in the payload's own order, so the UI matches Game8's.
    for (const g of groups) {
        const used = (g.classifications ?? []).filter(c => counts.has(c));
        if (!used.length) continue;
        const parentSlug = `g-${slugify(g.groupName)}`;
        seenParents.add(parentSlug);
        types.push({
            typeSlug:       parentSlug,
            typeName:       g.groupName,
            parentTypeSlug: null,
            markerCount:    0,
            children:       used.map(c => slugify(c)),
            defaultOn:      false,
            iconUrl:        null,
        });
        for (const c of used) {
            types.push({
                typeSlug:       slugify(c),
                typeName:       c,
                parentTypeSlug: parentSlug,
                markerCount:    counts.get(c),
                children:       [],
                // Game8 shows everything on load; there is no per-layer default.
                defaultOn:      true,
                iconUrl:        iconOf.get(c) ?? null,
            });
        }
    }

    // Classifications no group claims.
    const orphans = [...counts.keys()].filter(c => !groupOf.has(c));
    if (orphans.length) {
        const parentSlug = 'g-other';
        if (!seenParents.has(parentSlug)) {
            types.push({
                typeSlug: parentSlug, typeName: 'Other', parentTypeSlug: null,
                markerCount: 0, children: orphans.map(c => slugify(c)),
                defaultOn: false, iconUrl: null,
            });
        }
        for (const c of orphans) {
            types.push({
                typeSlug: slugify(c), typeName: c, parentTypeSlug: parentSlug,
                markerCount: counts.get(c), children: [], defaultOn: true,
                iconUrl: iconOf.get(c) ?? null,
            });
        }
    }

    return types;
}

/**
 * Normalise one Game8 payload into one map per area.
 *
 * Returns descriptors rather than finished map.json documents: the fetcher
 * fills in local asset paths and image dimensions once it has downloaded them.
 *
 * @param {object} payload  parsed tool_structural_mappings JSON
 * @param {object} meta     { sourceUrl, toolId }
 * @returns {Array<object>} one entry per area
 */
export function normalizeGame8Map(payload, { sourceUrl, toolId } = {}) {
    assertMapping(payload);

    const grid  = GAME8_GRID;
    const tiled = Boolean(payload.tileLayerMode);
    const all   = payload.coordinateArraySchema.coordinates;

    // Markers whose area matches no declared area would vanish silently, so they
    // are attached to the first area rather than dropped.
    const areaTitles = new Set(payload.areas.map(a => a.title));
    const unclaimed  = all.filter(m => !areaTitles.has(m.area));

    return payload.areas.map((area, index) => {
        const mine = all.filter(m => m.area === area.title);
        const markersRaw = index === 0 ? [...mine, ...unclaimed] : mine;

        const markers = [];
        // Game8 does ship the occasional marker with an empty `coordinate`
        // (Crimson Desert has one). It cannot be placed, so it is skipped — but
        // counted, so the fetcher can say so rather than quietly losing content.
        const skipped = [];
        for (const m of markersRaw) {
            const pos = parseCoordinate(m.coordinate, grid);
            if (!pos) { skipped.push({ id: String(m.id), title: String(m.title ?? '') }); continue; }
            markers.push({
                id:              String(m.id),
                lat:             pos.lat,
                lng:             pos.lng,
                name:            String(m.title ?? ''),
                slug:            String(m.id),
                typeSlug:        slugify(m.classification),
                iconSlug:        m.classification ?? null,
                regionId:        null,
                wikiPage:        null,
                checklistTaskId: null,
                // Game8-only extras. `html` is rich popup markup and must be
                // cleaned before rendering — see the fetcher's sanitise pass.
                description:     m.description ? String(m.description) : null,
                html:            m.htmlContent ? String(m.htmlContent) : null,
                url:             m.url || null,
            });
        }

        const types = buildTypeTree(payload, markersRaw.filter(m => parseCoordinate(m.coordinate, grid)));

        return {
            areaTitle:  area.title,
            mapSlug:    slugify(area.title),
            mapName:    area.title || payload.headingText || 'Map',
            // Falls back to the payload heading for single-area maps whose area
            // title is blank (Elliot's tileMaps entry is an empty string).
            remoteImageUrl: area.url ?? null,
            imageExt:   extFromUrl(area.url, '.jpg'),
            tiled,
            // Only meaningful in tiled mode; carried through so a tiled Game8 map
            // can be fetched without re-reading the payload.
            tileDirectory: payload.tileMaps?.[index]?.mapDirectoryName || null,
            tileExt:       payload.fileExtension ? `.${String(payload.fileExtension).toLowerCase()}` : '.jpg',
            maxZoom:       Number.isFinite(payload.maxZoom) ? payload.maxZoom : 5,
            grid,
            types,
            markers,
            skipped,
            sourceUrl:  sourceUrl ?? null,
            toolId:     toolId ?? null,
            headingText: payload.headingText ?? null,
        };
    });
}

/**
 * Every distinct icon URL a normalized map set references, so the fetcher can
 * download each once rather than per marker (Crimson Desert: 107 icons across
 * 1,610 markers).
 */
export function collectIconUrls(maps) {
    const urls = new Set();
    for (const m of maps) {
        for (const t of m.types) if (t.iconUrl) urls.add(t.iconUrl);
    }
    return [...urls];
}
