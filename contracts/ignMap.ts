// Contract for the normalized IGN interactive-map payload written to
//   {steamId}/ign/{guideId}/_maps/{mapSlug}/map.json
// and served verbatim over /relay/guides-map/… .
//
// Confirmed against the live Palworld map (/maps/palworld/palpagos-islands,
// mapId 580, 51 types / 11,138 markers) rather than inferred: IGN's map pages
// are Next.js SSR and embed the ENTIRE map — config, type tree and every marker
// — in the `__NEXT_DATA__` script tag. There is no separate markers API to call,
// so one HTTP GET of the map page yields the whole dataset.
//
// IGN maps are white-labelled Map Genie (`mapType: "mapgenie"`). Tiles and the
// marker sprite live on mapgenie CDNs and are served unauthenticated.
import { z } from 'zod'

// A sprite window. Every marker icon on a map is one rectangle of a single
// sprite sheet (`sprite.png`) — the `url` IGN ships alongside is a 1x1-ish
// placeholder ("…/defaults/markers/blank.png"), identical for all 51 types, so
// it is deliberately NOT carried through: drawing uses offsetX/offsetY only.
//
// `anchorX`/`anchorY` are the pixel inside the icon that sits on the marker's
// lat/lng (typically bottom-centre, e.g. 16.5/44 for a 33x44 pin). They are
// absent on the `legend` variant, which is drawn as a static swatch and never
// anchored to the map.
export const MapIconSchema = z.object({
    width: z.number(),
    height: z.number(),
    offsetX: z.number(),
    offsetY: z.number(),
    anchorX: z.number().optional(),
    anchorY: z.number().optional(),
    pixelRatio: z.number().default(1),
})

// One marker type — a filterable layer. Types form a two-level tree: 8 parents
// (Locations, Items, Enemies, …) each holding child types that actually carry
// markers. Parents have `markerCount: 0` and exist only to group the filter UI.
export const MapTypeSchema = z.object({
    typeSlug: z.string(),
    typeName: z.string(),
    parentTypeSlug: z.string().nullable(),
    // Sprite window used when drawing this type's markers on the map.
    // Null on Game8 maps, which use `iconFile` instead of a sheet.
    icon: MapIconSchema.nullable(),
    // Sprite window used for the filter-list swatch. Same artwork, no anchor.
    legend: MapIconSchema.nullable(),
    // Game8 only: a standalone icon PNG for this layer, relative to the map dir
    // ("icons/blue-chest.png"). Downloaded once per classification rather than
    // per marker — Crimson Desert has 1,610 markers over 107 icons.
    iconFile: z.string().nullable().optional(),
    markerCount: z.number(),
    // Child type slugs, in the source's own order. Empty for leaf types.
    children: z.array(z.string()),
    // Whether the source shows this layer on first load. IGN takes it from
    // `map.initialTypes`; Game8 shows everything, so all leaves are true.
    defaultOn: z.boolean(),
})

// One marker. Flat and self-contained — no lookups needed beyond `typeSlug`.
//
// `checklistTaskId` is IGN's server-side "found it" identifier. We never call
// their checklist API (it needs a logged-in IGN account); the id is retained so
// local found/not-found state has a stable key that survives a re-fetch, in the
// same spirit as guide pins keying off a parsed slug.
//
// `wikiPage` links a marker to a page of the same game's IGN wiki guide. It is
// null for every Palworld marker but populated on other maps, so it is carried
// through and left for the viewer to resolve against the downloaded guide.
export const MapMarkerSchema = z.object({
    id: z.string(),
    lat: z.number(),
    lng: z.number(),
    name: z.string(),
    slug: z.string(),
    typeSlug: z.string(),
    iconSlug: z.string().nullable(),
    regionId: z.number().nullable(),
    wikiPage: z.string().nullable(),
    checklistTaskId: z.number().nullable(),

    // ── Game8 extras ─────────────────────────────────────────────────────────
    // Optional so IGN markers are unaffected.
    description: z.string().nullable().optional(),
    // Rich popup markup, sanitised at fetch time — never Game8's raw HTML. See
    // the fetcher's clean pass; rendering unsanitised source markup would be an
    // injection hole in a page that also holds the user's own journal data.
    html: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
})

// Leaflet view parameters, passed straight through from IGN's map config.
// Tiles are ordinary Web Mercator XYZ (verified: the tile covering
// initialLat/initialLng computes identically under EPSG:3857), so the viewer
// uses Leaflet's default CRS rather than CRS.Simple.
export const MapViewSchema = z.object({
    minZoom: z.number(),
    maxZoom: z.number(),
    initialZoom: z.number(),
    initialLat: z.number(),
    initialLng: z.number(),
    backgroundColor: z.string().nullable(),
})

// Local tile pyramid stats. `template` is relative to the map directory so the
// viewer only has to prefix its own /relay/guides-map/… base — nothing in
// map.json points at a remote host at render time.
//
// The pyramid is a strict quadtree: at zoom z the map is a solid rectangle of
// tiles, and every tile's four children exist at z+1. `byZoom` records the
// per-level count actually written so a partial download is detectable.
export const MapTilesSchema = z.object({
    template: z.string(),            // "tiles/{z}/{x}/{y}.jpg"
    ext: z.string(),                 // ".jpg"
    minZoom: z.number(),
    maxZoom: z.number(),
    count: z.number(),
    bytes: z.number(),
    byZoom: z.record(z.string(), z.number()),
    // [[south, west], [north, east]] of the tiles actually written. A game map
    // covers a tiny patch of the Mercator world, so the viewer clamps panning to
    // this — without it you can drag off into empty grey and lose the map.
    // Derived from the base zoom level, so it is exact rather than inferred from
    // where markers happen to sit. Null only on a metadata-only fetch.
    bounds: z.tuple([
        z.tuple([z.number(), z.number()]),
        z.tuple([z.number(), z.number()]),
    ]).nullable(),
    // Kept for diagnostics / re-fetch. Map Genie versions tileset paths
    // ("…/1-0/default-v1/…"); a sudden 403 storm means the version moved.
    remoteTemplate: z.string(),
    // False when a --max-zoom cap or download failures left the pyramid short
    // of `view.maxZoom` — the viewer clamps its maxZoom to what exists.
    complete: z.boolean(),
})

// tiles.json — the small sidecar the viewer polls while a pyramid is still
// downloading. Rewritten after every completed zoom level, so it stays a few
// hundred bytes; map.json is ~2.4mb (nearly all markers) and would be absurd to
// poll for one number.
//
// `maxZoom` below `minZoom` means no level has completed yet. `tilesExpected` is
// exact rather than estimated: once the base level is counted the whole pyramid
// is determined, since each level quadruples.
export const IgnMapTileStatusSchema = MapTilesSchema.partial({
    template: true, ext: true, remoteTemplate: true,
}).extend({
    updatedAt: z.string(),
    targetMaxZoom: z.number().optional(),
    tilesExpected: z.number().optional(),
    tilesDone: z.number().optional(),
})

// A single base image, used instead of a tile pyramid. Game8's maps are one
// image per area rather than a pyramid (`tileLayerMode: false`), so there is
// nothing to descend and `tiles` is absent entirely.
//
// `width`/`height` are the image's natural pixel size, recorded at download time
// so the viewer can size its overlay without waiting for the image to decode.
export const MapImageSchema = z.object({
    file: z.string(),                // "base.gif", relative to the map dir
    remoteUrl: z.string(),
    width: z.number(),
    height: z.number(),
})

export const IgnMapSchema = z.object({
    schemaVersion: z.literal(1),
    id: z.string(),                  // "palworld:palpagos-islands"
    mapSlug: z.string(),
    mapName: z.string(),
    objectSlug: z.string(),
    objectName: z.string(),
    // The IGN wiki slug for the same game. Equal to objectSlug on every map
    // checked, which is what makes map discovery from an already-downloaded
    // wiki guide a pure string substitution rather than a lookup.
    wikiSlug: z.string().nullable(),
    sourceUrl: z.string(),
    fetchedAt: z.string(),

    // ── Source / projection ──────────────────────────────────────────────────
    // Defaulted rather than required so every map.json written before Game8
    // support stays valid as-is — an already-downloaded IGN map must not need a
    // re-fetch (Palworld alone is 87,381 tiles).
    source: z.enum(['ign', 'game8']).default('ign'),
    // How to read marker lat/lng. IGN serves ordinary Web Mercator slippy tiles.
    // Game8 uses a fixed square grid with no geographic meaning, which Leaflet
    // renders via CRS.Simple.
    projection: z.enum(['EPSG3857', 'Simple']).default('EPSG3857'),
    // Side of the virtual coordinate square, for `Simple` only. Game8's own
    // bundle converts with `coord * (imageSize / 256)`, hence 256.
    grid: z.number().optional(),

    view: MapViewSchema,
    // Exactly one of `tiles` / `image` is present: a pyramid to descend, or a
    // single base image. Both are optional so neither source has to carry a
    // meaningless placeholder for the other's mode.
    tiles: MapTilesSchema.optional(),
    image: MapImageSchema.optional(),
    // IGN windows every marker icon out of one sprite sheet. Game8 ships a PNG
    // per classification instead, carried on each type as `iconFile`, so there
    // is no sheet to reference.
    sprite: z.object({
        file: z.string(),            // "sprite.png", relative to the map dir
        remoteUrl: z.string(),
    }).optional(),
    types: z.array(MapTypeSchema),
    markers: z.array(MapMarkerSchema),
})

// GET/PUT /relay/api/guides/:steamId/:source/:guideId/maps/:mapSlug/prefs —
// server-persisted marker-layer filters for one map, so it reopens as it was left
// (and does so on any machine, unlike localStorage).
//
// Stored under the user's journal data, NOT in the map's own directory: a map
// re-download rewrites map.json/tiles.json and must never take the user's filters
// with it. Keyed per map because one game can ship many with unrelated layer sets.
//
// `enabled: null` means never saved, which is deliberately distinct from `[]`
// (every layer switched off on purpose). The client needs that difference — null
// falls back to IGN's own defaults, `[]` must be honoured as-is.
export const IgnMapPrefsSchema = z.object({
    enabled: z.array(z.string()).nullable(),
    collapsedGroups: z.array(z.string()),
    updatedAt: z.string().nullable(),
})

// _maps/_index.json — every map downloaded for one guide, so the viewer can
// offer a switcher without stat-ing the directory tree.
export const IgnMapIndexSchema = z.array(z.object({
    mapSlug: z.string(),
    mapName: z.string(),
    markerCount: z.number(),
    tileCount: z.number(),
    sizeBytes: z.number(),
    fetchedAt: z.string(),
}))
