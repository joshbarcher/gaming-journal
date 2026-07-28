# Interactive Maps (viewer)

Offline viewer for a downloaded game map, shown as a **Map** mode inside the guide viewer. Tiles, marker icons and `map.json` all come off the NAS through `/relay/guides-map` — no request leaves the box. Two sources are supported with one renderer: IGN (Map Genie) and Game8. See [map-sources.md](map-sources.md) for how they differ and [server/guides/maps.md](../../server/guides/maps.md) for downloading.

## Data flow

1. `GuideViewer.loadMeta()` probes `/relay/guides-map/{appid}/{source}/{guideId}/_maps/_index.json` alongside its meta fetch. A 404 is normal — most guides have no map.
2. The **Guide | Map** toggle renders when `maps.length || source === 'ign'`. Clicking Map mounts `GuideMap` and hides `.gv-body` (hidden, not unmounted, so the guide keeps its page and scroll).
3. `GuideMap` loads `{mapSlug}/map.json`, then `tiles.json` **only if** `projection !== 'Simple'`.
4. Saved filters load from `GET /relay/api/guides/{appid}/{source}/{guideId}/maps/{mapSlug}/prefs` and override `type.defaultOn`.
5. Leaflet initialises: `CRS.EPSG3857` + `L.tileLayer` for tiled maps, or `CRS.Simple` + `L.imageOverlay` over a `grid × grid` square.
6. Icons resolve to a `DrawSpec` — a sprite window (IGN) or a whole PNG (Game8) — and one canvas layer draws both.
7. Filter changes call `savePrefs()`, debounced 600 ms, flushed on unmount.

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/journal/guide/GuideMap.svelte` | Viewer: Leaflet init, filter tree, search, popup, discovery panel |
| `src/lib/js/ign-map-markers.ts` | Canvas marker layer, `DrawSpec` factories, hit-testing |
| `src/lib/svelte/journal/guide/GuideViewer.svelte` | Guide/Map toggle, `_index.json` probe, collapse handle |
| `src/lib/server/relay/guides/map-prefs.service.js` | Server-persisted per-map filters |
| `src/routes/relay/guides-map/[...file]/+server.ts` | Static serving of tiles/images/icons/json |
| `public/css/guide-viewer.css` | `.gv-header-modes`, `.gv-mapbody`, collapse overrides |

## Layout

`GuideMap` mirrors `.gv-body`'s `1fr 300px` grid, so the map sits in the content column and the layer list lands in the same column the TOC uses. Both modes share one skeleton; the header heading switches **Contents ↔ Layers**.

Collapse is the shared `tocCollapsed` state, passed in as the `collapsed` prop. Collapsed shows a 40px rail of the enabled layers' icons, each clickable to switch that layer off.

## Rendering

Markers are painted onto **one canvas** in the overlay pane, not as `L.Marker`s — Palworld has 11,138 markers with 43 layers on by default. Off-screen markers (plus 96px pad) are culled per frame. The canvas is backed at `devicePixelRatio`. Hit-testing walks the drawn set back-to-front so a click selects the marker on top.

## Common questions

**Q: Why is the collapse handle invisible on the map but fine on the guide?**
It isn't missing — it's painted under. Leaflet stacks panes/controls at z-index 400–1000, which competed with `.gv-toc-gutter-btn` (z-index 2) in the shared root context. Fixed with `isolation: isolate` on `.gv-mapbody`, which confines Leaflet's z-indexes to its subtree. Don't fix this by raising the button's z-index — that would put it over modals and the lightbox.

**Q: Why do markers vanish when I search?**
Search filters the drawn set, not just the results list. `visibleMarkers` intersects the enabled layers with the query.

**Q: Are "found" markers saved to the server?**
No. Found state is `localStorage` only, keyed `ign-map-found:{appid}:{guideId}:{mapSlug}`. **Filters** are server-side; found markers are not, so they don't follow you between machines.

**Q: A map shows "Zoom z8–15 of 16 available". Is it broken?**
No. The viewer clamps `maxZoom` to what's on disk. Either the download is still running, or the source doesn't render the level it declares (see [map-sources.md](map-sources.md)).

**Q: Is Game8's popup HTML safe to render?**
It's sanitised at **fetch** time, not render time, so what's on disk has already been through the allowlist. See `sanitizePopupHtml` in `game8/map-fetcher.js`.

## Gotchas

- **Leaflet caches container size.** Any layout change needs `invalidateSize()` afterwards — collapse (260 ms, past the 220 ms transition) and fullscreen (120 ms) both do. Without it the tile grid keeps its old dimensions and leaves a blank strip.
- **The map is mounted only while active.** Leaflet measures its container on creation, so keeping it alive behind `display:none` gives it a zero-size viewport.
- **`enabled: null` ≠ `enabled: []`** in saved prefs. `null` means never saved and falls back to the source's defaults; `[]` is a deliberate all-off and must be honoured. Collapsing them switches every layer back on for anyone who cleared them.
- **Prefs save from the toggle handlers, not an `$effect`.** An effect would also fire when defaults are applied during load, immediately overwriting the user's stored filters. A `prefsLoaded` guard backs this up.
- **Debounced saves capture URL and body at call time.** Switching maps inside the 600 ms window would otherwise PUT one map's filters to the next map's key.
- **`tiles.json` is only fetched for tiled maps.** Asking before knowing the projection cost a guaranteed 404 on every single-image map.
- **Icon sizing differs per source.** IGN sprite windows are 33×44 by construction; Game8 ships whatever resolution the artist uploaded, so `imageSpecFactory` scales to a fixed 26px height. Drawing Game8 icons 1:1 buries the map under its own markers.
