# Interactive Maps

Offline viewer for a downloaded IGN interactive map, shown as a **Map** mode inside the guide viewer. Everything it renders — tile pyramid, marker sprite, `map.json` — comes off the NAS through `/relay/guides-map`. No request leaves the box.

The Map toggle appears on **every IGN guide**. Non-IGN sources have no maps at all and never see it.

Downloading a map is a **separate, explicit action** — a button in Map mode, never part of the guide download. A deep pyramid runs over an hour (Palworld: 87k tiles), so it is queued as its own job, shown on the Downloads page tagged **Map**, and can be started, resumed or abandoned without affecting guide availability or updates. Nothing about the guide waits on it.

The map is usable **while it downloads**. Levels are published as they complete, so the map opens at whatever depth exists so far and gets deeper as tiles land — no waiting for all 87k. Resuming is the same button as starting: the fetcher skips whatever is already on disk.

## URL / entry

There is no separate route. `GuideViewer` probes `/relay/guides-map/{appid}/{source}/{guideId}/_maps/_index.json` alongside its meta fetch; a 404 is the normal "nothing downloaded yet" case and simply leaves `maps` empty.

Discovery itself is opt-in: `GET .../maps?probe=1` costs one request to ign.com, so it only fires when the user clicks **Check IGN for a map** — never on a normal guide load. `POST .../maps` with a `mapSlug` queues the download.

## Fullscreen

The fullscreen button (top-right of the map) requests fullscreen on the component root, so the filter rail travels with the map rather than being left behind. Leaflet caches its container size, so `invalidateSize()` runs after the transition — without it the tile grid keeps its pre-fullscreen dimensions and leaves the new area blank. Esc exits, and the button reflects state via a `fullscreenchange` listener rather than assuming its own click succeeded.

When Map mode is on, the guide body is **hidden rather than unmounted**, so returning to the guide keeps the loaded page and scroll position. The map itself is mounted only while active — Leaflet measures its container on creation, so keeping it alive behind `display:none` would give it a zero-size viewport.

## Data flow

1. `GuideMap` fetches `_maps/_index.json` → the list of downloaded maps.
2. It selects the requested `mapSlug` when present and downloaded, else the first map.
3. `{mapSlug}/map.json` and `{mapSlug}/tiles.json` are fetched together → config, 51 marker types, 11,138 markers, plus the live tile depth.
4. Layers default to `type.defaultOn`, which mirrors IGN's own first-load selection (43 of 51 on).
5. Leaflet initialises with the map's `minZoom`/`initialZoom` and `L.CRS.EPSG3857`; tiles come from the local `tiles/{z}/{x}/{y}.jpg` template.
6. The sprite sheet loads once, then the canvas marker layer is added.

`maxZoom` is clamped to the depth actually on disk, so a capped or in-flight download can't zoom into blank tiles.

## While a download runs

`tiles.json` is the live authority on tile depth — a few hundred bytes, rewritten by the fetcher after each completed zoom level. The viewer polls it every 5s while `complete` is false and raises Leaflet's zoom ceiling as levels land, then stops polling. A finished map polls nothing.

A badge shows the depth available (`z8–13 of 16`), with either live download progress or a **Download rest** button. Because the pyramid is back-loaded — z8–13 is 1,365 tiles against 65,536 for z16 alone — a map becomes genuinely usable within about a minute of starting.

Panning is bounded by `tiles.bounds`, applied as soon as the base level publishes it. Without it you can drag off the edge into empty grey and lose the map.

## Marker rendering

Markers are painted onto **one canvas** in Leaflet's overlay pane (`lib/js/ign-map-markers.ts`), not as `L.Marker` instances. With 11k markers and 43 layers on by default, that many DOM nodes is not a panning experience. The canvas keeps IGN's exact sprite artwork — no substituted dots, no clustering that changes what the map looks like.

- Markers outside the viewport (plus a 96px pad) are culled per frame, so cost tracks what's visible rather than the full set.
- The canvas is backed at `devicePixelRatio` so sprite art stays crisp on HiDPI.
- Hit-testing walks the drawn set back-to-front, so a click selects the marker visually on top.
- Selection draws a soft halo rather than scaling the sprite — scaling would resample the artwork and look mushy next to its neighbours.

**The sprite sheet is @2x while every icon reports `pixelRatio: 1`** (Palworld: a 660×792 sheet for a 330×396 coordinate space). The scale is measured at load (`spriteScaleFor`) rather than trusted, because slicing at face value renders every marker as a quarter of itself plus its neighbours.

## Filtering

The 51 types form a two-level tree: 8 parent groups (Locations, Items, Enemies, …) holding the leaf types that carry markers. Parents have `markerCount: 0` and exist only to group the filter UI. A leaf whose parent is missing is surfaced under "Other" rather than dropped, so no layer is unreachable.

Each row shows a legend swatch windowed from the same sprite sheet the canvas draws from, using icon-coordinate units so CSS and canvas agree regardless of the sheet's @Nx scale.

Search filters the drawn set live and lists up to 40 name matches; picking one flies to it and selects it.

## Found markers

Marker "found" state is local-only and persisted to `localStorage` under `ign-map-found:{appid}:{guideId}:{mapSlug}`. Found markers draw at reduced opacity rather than disappearing.

IGN's own `checklistTaskId` is carried through in `map.json` but **never sent anywhere** — their checklist API needs a logged-in IGN account. It is retained so local state has a stable key that survives a re-fetch, in the same spirit as guide pins keying off a parsed slug.

## Key files

| File | Role |
|------|------|
| `lib/svelte/journal/guide/GuideMap.svelte` | viewer: map init, filter tree, search, popup |
| `lib/js/ign-map-markers.ts` | canvas marker layer, sprite scale detection, hit-testing |
| `lib/svelte/journal/guide/GuideViewer.svelte` | Guide/Map mode toggle, `_index.json` probe |
| `public/css/guide-viewer.css` | `.gv-header-modes`, `.gv-mapbody` |

Downloading a map is server-side — see [server/guides/maps.md](../../server/guides/maps.md).
