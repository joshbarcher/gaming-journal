# Map Sources

Two sites provide interactive maps, with unrelated backends. Both normalise into one `map.json` (`contracts/ignMap.ts`) so a single viewer renders them. This doc is the site-specific reference; see [maps.md](maps.md) for the viewer and [server/guides/maps.md](../../server/guides/maps.md) for the download pipeline.

## The three shapes

| | Base layer | `projection` | Icons |
|---|---|---|---|
| IGN (`mapType: mapgenie`) | XYZ tile pyramid | `EPSG3857` | one sprite sheet |
| Game8, `tileLayerMode: false` | one image per area | `Simple` (256 grid) | PNG per classification |
| Game8, `tileLayerMode: true` | tile pyramid | `Simple` | PNG per classification |

These are independent fields, not one enum. The third row is **not implemented** — `fetchGame8Map` throws `UnsupportedGame8MapError` rather than writing a map whose base layer 404s on every request.

`source` and `projection` are zod-defaulted (`'ign'` / `'EPSG3857'`), so `map.json` written before Game8 support still validates without a re-fetch.

---

## IGN

IGN maps are white-labelled **Map Genie**. The whole map — config, type tree, every marker — is embedded in the page's `__NEXT_DATA__`. One GET is the entire dataset (Palworld: 3.8 MB, 11k markers). No markers API to page through, and no browser needed; Puppeteer is only a fallback for a bot interstitial.

**Where traffic actually goes:** one request to `ign.com` (the page). Tiles come from `tiles.mapgenie.io`, the sprite from `cdn.mapgenie.io`. A 90k-tile download does not touch IGN.

### Gotchas

- **`/maps/{slug}` is an INDEX page, not a map.** It has no `page.map` and no tilesets; its list lives at `page.mapData.maps`. Discovery reads that (~140 KB) rather than a map page (~3.8 MB). Pointing the fetcher at the bare URL and expecting a map throws.
- **`mapType` is not always `mapgenie`.** Cyberpunk 2077 is `mapType: "ign"` — IGN's own backend, with `{z}/{x}-{y}` tile paths on ignimgs, per-type icon files, and shallow pyramids (z2–5). Refused via `UnsupportedMapError`, which `fetch-map.js` exits 0 on.
- **The sprite sheet is @2x while every icon reports `pixelRatio: 1`.** Palworld's sheet is 660×792 for a 330×396 coordinate space. Trusting the reported ratio slices the wrong rectangle and every marker renders as a quarter of itself plus its neighbours. `spriteScaleFor()` measures it instead.
- **`childTypes` is `false`, not `[]`, on leaf types** (43 of Palworld's 51). A `?? []` default does not catch it; `Array.isArray` does.
- **Every icon's `url` is a blank placeholder**, identical across types. The real artwork is the sprite windowed by `offsetX`/`offsetY`, so the url is dropped.
- **Tile coordinate order varies per map.** Palworld is `{z}/{x}/{y}.jpg`, Lego Batman is `{z}/{y}/{x}.jpg`. `tileUrl()` substitutes by name so both work. Local storage is always `tiles/{z}/{x}/{y}`, independent of the remote order.
- **Declared `maxZoom` ≠ rendered.** Lego Batman advertises 16 but its tileset stops at 15 — every z16 tile 403s. See the level probe below.
- **A missing tile answers `403`, not `404`** — the CDN is an S3 bucket without `ListBucket`, so `AccessDenied` is its "no such key". Both mean stop; neither is retried.

---

## Game8

The whole map comes from one JSON endpoint:

```
GET game8.co/api/tool_structural_mappings/{toolId}.json
```

The tool id is **not derivable from the article URL** — discovery loads the page in a browser and watches for its own API call. Game8 answers a bare fetch with 403, so the browser is required anyway. The map mounts lazily below the fold and must be scrolled into view before the call fires.

**Areas become maps.** `areas[]` is the state axis (Elliot's four "Age of" states, Crimson Desert's six regions), and every marker declares its `area`. Each becomes its own map directory, so the existing map switcher and per-map filters apply unchanged.

### Gotchas

- **Coordinates are a fixed 256×256 grid**, not lat/lng. From Game8's own `cursorPinCalculation` chunk: `coord * (imageSize / 256)`. Markers are stored with lat pre-flipped (`256 - y`) because Leaflet's lat axis points up while image y points down — that keeps the marker shape identical to IGN's, so only the CRS differs.
- **`fileExtension` describes TILES, not area images.** Crimson Desert declares `"jpg"` while serving `.gif` area images. Extension must come from the URL or you write `.jpg` files holding GIF bytes.
- **Marker fields vary between games.** Crimson Desert omits six fields Elliot has (`popupImage`, `thumbnail`, `youtubeId`, `timerCron`…). Only `id`/`area`/`coordinate`/`classification` are dependable.
- **Some markers have an empty `coordinate`** (Crimson Desert has exactly one). They can't be placed, so they're skipped — but reported by id and title in `skipped[]`, never silently dropped.
- **Classifications are per-game, not per-area.** Crimson Desert declares 107 across the game; any one region uses a fraction. `buildTypeTree` lists only the ones with markers in that area, or the filter list is unusable.
- **Every marker carries `htmlContent`.** It's sanitised at fetch time by a deny-by-default allowlist — see [maps.md](maps.md).

---

## Common questions

**Q: How do I tell which source a downloaded map came from?**
`map.json` → `source` (`'ign'` | `'game8'`). Absent means IGN, from before the field existed.

**Q: Why does a map stop short of its declared maxZoom?**
The source doesn't render that level. The fetcher probes one parent's four children before committing to a level; if all are absent it stops and marks the pyramid complete anyway. That turns 65,536 futile requests into 4.

**Q: Can Game8 maps be discovered automatically like IGN's?**
Not from the guide id — Game8 maps hang off a specific article. `?probe=1` scans the downloaded guide's `_raw/_manifest.json` for page titles matching `map`/`maps`, which is local and instant. The user confirms, or pastes a URL.

**Q: Elliot's marker count changed between fetches. Bug?**
No — re-fetching pulls current upstream data. Palworld went 11,138 → 11,135 in one day because IGN removed three markers.
