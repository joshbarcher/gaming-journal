# Home Page Mosaic — Architecture & Implementation

## Overview

The home page has three mosaic cards (Library, Wishlist, Discover Games). Each shows a grid of
game images that animate with a 3D card-flip effect. Every 8 seconds a new set of images flips in.
Clicking an individual tile navigates to that game's page. Clicking the central label button
navigates to the section page (library / wishlist / discover).

---

## Mosaic layout

| Card     | Grid        | Image type | Aspect ratio |
|----------|-------------|------------|--------------|
| Library  | 3 col × 2 row | poster.jpg | Portrait (2:3) |
| Wishlist | 3 col × 2 row | poster.jpg | Portrait (2:3) |
| Discover | 2 col × 3 row | header.jpg | Landscape (16:9) |

Discover uses header images because only ~14.5% of discovered games have a poster.jpg cached,
versus 99.9% for header.jpg.

---

## Image pipeline

### Library and wishlist

The relay server pre-builds a queued pool of 50-game batches using `poster-pool.service.js`.
Only games confirmed to have `poster.jpg` on disk are included. On startup the pool loads from
`poster-index.json` (persistent, never expires for confirmed-present games). Missing entries are
re-checked every 24 hours.

```
GET /api/games/posters?source=library&n=50
GET /api/games/posters?source=wishlist&n=50
→ [{ appid, poster: "/relay/images/steam/games/{appid}/poster.jpg" }]
```

### Discover

The relay's `/api/discover/featured` endpoint returns featured Steam store items. The discover
controller (`discover.controller.js`) rewrites each item's image URLs to local relay paths
before responding. It uses `hasPoster(appid)` from `poster-pool.service.js` to pick:

- `poster.jpg` if confirmed on disk
- `header.jpg` otherwise (99.9% coverage)

The `+page.server.ts` `sampleDiscover()` function picks the `headerImage` field (always the
landscape header relay path) and returns `{ appid, poster }` for the discover mosaic.

### Image caching (discovered games)

Images for discovered games are downloaded to the NAS by `ensureDiscoveryImages()` in
`images.service.js` using 8 concurrent workers with EAGAIN retry/backoff. This runs:

- On server startup: background warm of all 2000+ items in featured history
- After each hourly poll: synchronously downloads new items before poll completes
- Fire-and-forget after each `/api/discover/featured` request for any new items

The `poster-index.json` at `DATA_DIR/relay/steam/poster-index.json` tracks which appids have
`poster.jpg` confirmed. The migration tool backfills it:

```
node --env-file=.env src/tools/sync-discovery-images.js
```

Results after initial migration (2026-06-18):
- poster.jpg: 291 / 2001 (14.5%)
- header.jpg: 1999 / 2001 (99.9%)

---

## NAS image coverage (library + wishlist, 2026-06-18)

| Image type    | Coverage  |
|---------------|-----------|
| header.jpg    | 99.9%     |
| capsule.jpg   | 99.9%     |
| background    | 99.7%     |
| hero.jpg      | 91.0%     |
| poster.jpg    | 89.7%     |
| logo.png      | 88.8%     |

Total: ~2,989 game folders on NAS.

---

## Mosaic animation

`HomeMosaic.svelte` maintains 6 visible slots and an available pool. Every 8 seconds `tick()`
picks 6 new images (excluding current fronts to prevent visible duplicates), triggers flip
animations with random stagger delays (0–450ms), and returns old fronts to the pool in
`onFlipEnd()` once each animation completes.

**Preloading**: On mount, the first 12 available images are preloaded immediately. After each
tick, 12 more candidates are preloaded via `new Image()` 2 seconds into the 8-second interval
(well before the next flip). A `Set` prevents duplicate preload requests.

**Clickability**: Each mosaic cell is an `<a href="/game/{appid}">` pointing to the game
currently showing on its front face. The href updates automatically when a flip completes. The
central label is a separate `<a>` navigating to the section page.

---

## Key files

### Gaming journal (`c:\dev\gaming-journal`)

| File | Role |
|------|------|
| `src/routes/+page.server.ts` | SSR: fetches poster batches and discover items; `sampleDiscover()` picks 50 header images |
| `src/lib/svelte/home/Home.svelte` | Card layout; passes `cols` prop to differentiate discover mosaic |
| `src/lib/svelte/home/HomeMosaic.svelte` | Flip animation, pool management, preloading, per-tile `<a>` links |
| `public/css/home.css` | Grid layout, flip keyframes, per-tile hover, landscape modifier |

### Relay server (`c:\dev\relay-server`)

| File | Role |
|------|------|
| `src/services/games/poster-pool.service.js` | Pre-built batches; persistent `poster-index.json`; `hasPoster()` |
| `src/services/games/games.service.js` | Triggers `refreshPosterPool()` after cache rebuild |
| `src/services/steam/images.service.js` | `ensureDiscoveryImages()` — downloads poster+header with 8 workers, EAGAIN retry |
| `src/services/steam/featured-history.service.js` | `getAllItems()` — flattens all discovery history for bulk warm |
| `src/services/steam/featured-poller.js` | Startup warm + hourly poll; awaits image downloads before completing |
| `src/controllers/games/games.controller.js` | `handleGetPosters` — returns pre-built batch from pool |
| `src/controllers/steam/discover.controller.js` | `rewriteItems()` picks single best URL per game; fire-and-forget image caching |
| `src/tools/sync-discovery-images.js` | One-time migration: downloads all history images, writes `poster-index.json` |

---

## EAGAIN / NAS concurrency

The NAS mount (NFS/SMB at `/mnt/data-dir`) returns `EAGAIN` under heavy concurrent `stat()`
load. Both paths that do bulk file checks use a `statRetry()` helper (up to 4 retries with
linear backoff: 200ms, 400ms, 600ms, 800ms) and are capped at 8 concurrent workers.

---

## Pending improvements

- **Page state on back-navigation**: clicking a tile and returning replays the SSR state from
  scratch (new random shuffle, animations restart). Ideal fix: persist mosaic state in
  `sessionStorage` and restore it on mount so the user sees the same layout they left.

- **Stable game selection across refreshes**: the 50-game pool is re-shuffled on every page
  load (SSR). Ideal fix: derive the selection from a daily seed (e.g. `Date.now() / 86400000 | 0`)
  so the same games show for the day and only change periodically.
