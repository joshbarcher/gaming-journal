# IGN Interactive Maps

Downloads an IGN interactive map for fully-offline use: the map definition, the marker sprite sheet, and the complete tile pyramid.

Unlike guide fetching there is **no separate parse phase** — `fetch-map.js` writes the normalized `map.json` itself, because normalization is a pure JSON transform with no DOM selectors to keep up with.

## When it runs

A map is **its own `mode: 'map'` job — never a phase of a guide download.** A deep pyramid is ~87k tiles and over an hour (Palworld), which would hold guide availability hostage to an optional extra and stall every re-download queued behind it. Guides and maps are independent: a guide is usable the moment it parses, and a map can be fetched, resumed or abandoned without touching it.

Jobs are queued from the map view's download button (`POST /relay/api/guides/:steamId/:source/:guideId/maps`), and appear on the Downloads page tagged **Map**. A map job has no parse or index phase, so it renders a single **Tiles** bar rather than three.

`fetch-map.js` can also be run directly for one-off or capped pulls.

Discovery is a separate, cheap call — see `GET .../maps?probe=1`, which reads the index page rather than a map page.

## Progressive availability

Tiles are published **as each zoom level completes**, not at the end:

1. `map.json` and `_maps/_index.json` are written **before any tile is fetched**, so the map opens immediately — markers, filters, legend and the base tiles are all usable while the deep levels are still arriving.
2. After every completed level, `tiles.json` is rewritten with the depth now on disk, and `map.json`'s tile block is updated to match so a cold load sees the same thing.
3. The viewer polls `tiles.json` (5s) while `complete` is false and raises Leaflet's zoom ceiling as levels land.

`tiles.json` is a separate few-hundred-byte file precisely so it can be polled — `map.json` is ~2.4mb for Palworld, nearly all of it markers, and polling that to learn one number would be absurd.

This matters because the pyramid is back-loaded: z8–z13 is 1,365 tiles (about a minute) while z16 alone is 65,536. A map is genuinely usable at zoom 13 long before the last level finishes.

`tilesExpected` in the sidecar is exact rather than estimated — once the base level is counted the whole pyramid is determined, since each level quadruples.

## What IGN maps actually are

IGN maps are white-labelled **Map Genie** (`map.mapType === 'mapgenie'`). Two consequences:

- Tiles and the marker sprite come from `tiles.mapgenie.io` / `cdn.mapgenie.io`, not from ignimgs.
- The map page (`/maps/{objectSlug}/{mapSlug}`) is Next.js SSR and embeds the **entire** map — config, marker type tree, and every marker — in its `__NEXT_DATA__` script tag. There is no markers API to page through, so **one GET is the whole dataset**. Palworld's Palpagos Islands is a 3.8mb document carrying 11,138 markers across 51 types.

Because the payload is in the SSR'd HTML, no browser is needed. Puppeteer is kept only as a fallback for when a bare `fetch` comes back without `__NEXT_DATA__` (bot interstitial / challenge page).

Everything is served unauthenticated. `map.object.paywall` is `true` on Palworld while `map.premium` is `false` — IGN gates some map *features* behind a subscription in their own UI, but the tiles and marker JSON are not gated.

## Data flow

1. Job queue (or a direct run) invokes `fetch-map.js --url <u> --steam-id <id> [--guide-id <slug>] [--all-maps] [--max-zoom N] [--skip-tiles] [--reparse] [--force] [--progress-bar <name>]`.
2. A bare `/maps/{game}` URL is resolved to a concrete map slug first (`resolveMapTarget`), so output always lands in the right directory rather than a placeholder that has to be moved.
3. `fetchMapPageHtml` GETs the page (plain `fetch`; Puppeteer fallback), `extractNextData` pulls the JSON blob, and it is saved verbatim to `_raw/_next.json` so `--reparse` can re-normalize without re-hitting the site.
4. `normalizeMap` flattens `overlays[].markers` into one deduped array and builds the type tree.
5. The sprite sheet is downloaded once (a single PNG, ~143kb).
6. `downloadTiles` walks the pyramid (see below) into `tiles/{z}/{x}/{y}.jpg`.
7. `map.json` is written, then `_maps/_index.json` is rebuilt from whatever map dirs exist.

## Tile pyramid

Tiles are ordinary Web Mercator XYZ — the tile computed for a map's `initialLat`/`initialLng` under EPSG:3857 is exactly the one IGN's own viewer requests, which is why the client uses Leaflet's **default CRS** and not `CRS.Simple`.

Discovery is a **quadtree descent**, not a bounding-box scan. The pyramid is a solid rectangle at every level and each existing tile's four children exist one level down, so descending from the tiles found at `minZoom` visits exactly the tiles that exist. This adapts to any map's extent without hardcoding bounds and wastes no probes on empty space.

The base level is found by probing a growing ring around the centre tile (`seedLevel`), which keeps expanding only while the outermost ring is still productive — so a map wider than one tile at `minZoom` isn't truncated.

Once the base level count is known the whole pyramid is determined (each level quadruples), so the progress percentage is exact rather than a guess.

Palworld, z8–z16:

| Zoom | Grid | Tiles |
|------|------|-------|
| 8 | 1×1 | 1 |
| 12 | 16×16 | 256 |
| 14 | 64×64 | 4,096 |
| 15 | 128×128 | 16,384 |
| 16 | 256×256 | 65,536 |
| **total** | | **87,381** (~280mb) |

**A missing tile answers `403`, not `404`** — the CDN is an S3 bucket without `ListBucket` permission, so `AccessDenied` is its "no such key". Both are treated as "does not exist" and are never retried; only 5xx/429/transport errors back off and repeat.

### Resume

A re-run skips tiles already on disk. Resume indexes each level with **one `readdir` per x-directory** (`scanLevel`) rather than a `stat` per tile — 87k stats over SMB is minutes of nothing. Cached tiles also skip the inter-request pacing, so a resumed run doesn't crawl through work it isn't doing.

## Politeness

Pacing lives in `guides/config.js` under `map`, next to the page-crawl delays:

| Setting | Default | Role |
|---------|---------|------|
| `tileConcurrency` | 6 | parallel tile downloads |
| `tileDelayMinMs` / `tileDelayMaxMs` | 120 / 320 | jittered pause **per worker** between its own requests |
| `tileRetries` | 3 | 5xx/429/network only |
| `retryBackoffMs` | 800 | doubles per attempt; a `Retry-After` header overrides it |
| `pageDelayMinMs` / `pageDelayMaxMs` | 1500 / 3800 | between map pages under `--all-maps` (matches the wiki crawler) |

`concurrency × (pace + latency)` is the real throttle — the defaults hold the sustained rate near 20 req/s, roughly what a person panning the live map produces, rather than saturating the CDN.

## Storage layout

Maps live **inside the wiki guide for the same game**, because IGN keys both off one slug (`map.object.wikiSlug === objectSlug`) — so a downloaded guide always knows where to find its map without a lookup.

```
guides/{steamId}/ign/{guideId}/_maps/
    _index.json                     ← every map downloaded for this guide
    {mapSlug}/
        _raw/_next.json             ← raw __NEXT_DATA__ (re-normalize without refetch)
        map.json                    ← normalized — contracts/ignMap.ts
        sprite.png                  ← single marker sprite sheet
        tiles/{z}/{x}/{y}.jpg
```

## Gotchas

- **The sprite sheet is @2x while every icon reports `pixelRatio: 1`.** Palworld's sheet is 660×792 for a 330×396 icon coordinate space. Trusting the reported ratio slices the wrong rectangle and every marker renders as a quarter of itself plus its neighbours. The client measures the real scale instead (`spriteScaleFor`), comparing sheet pixels against the furthest declared icon rectangle.
- **`childTypes` is `false`, not `[]`, on leaf types** (43 of Palworld's 51). A `?? []` default does not catch it — `Array.isArray` does.
- **Every icon's `url` is a blank placeholder** (`…/defaults/markers/blank.png`), identical across all types. The real artwork is the sprite windowed by `offsetX`/`offsetY`, so the url is dropped during normalization.
- **Tile paths are versioned** (`…/1-0/default-v1/…`). `map.json` keeps `tiles.remoteTemplate` for diagnostics — a sudden 403 storm means Map Genie re-versioned the tileset and the map needs re-fetching.
- `map.json` records `tiles.bounds` (derived from the base level, so exact). Without it the viewer lets you pan off into empty grey and lose the map entirely.

## Key files

| File | Role |
|------|------|
| `guides/tools/fetch-map.js` | CLI entry; arg parsing, map resolution, `--all-maps` loop |
| `guides/ign/map-fetcher.js` | page fetch, sprite, pyramid descent, `map.json` + index writing |
| `guides/ign/map-adapter.js` | `__NEXT_DATA__` extraction, normalization, tile geometry |
| `contracts/ignMap.ts` | `IgnMapSchema` / `IgnMapIndexSchema` |
| `routes/relay/guides-map/[...file]/+server.ts` | static serving of tiles/sprite/json |
