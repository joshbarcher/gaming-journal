# Home Page Images — Architecture & Known Issues

## Overview

The home page mosaic cards (Library, Wishlist, Discover Games) each display a 3×2 grid of game
poster images that animate with a 3D card-flip effect every 4 seconds. Each mosaic is fed a pool
of 50 images so the animation has variety without repeating.

This document covers how images are sourced, how they flow from the relay server to the browser,
what is currently broken, and what needs to be fixed.

---

## Image pipeline by game type

### Library and wishlist games

Games with `source = 'library' | 'wishlist' | 'both'` in the games service use **local relay paths**
constructed by `mediaUrls()` in `relay-server/src/services/games/games.service.js`:

```
/relay/images/steam/games/{appid}/poster.jpg
/relay/images/steam/games/{appid}/header.jpg
/relay/images/steam/games/{appid}/capsule.jpg
/relay/images/steam/games/{appid}/hero.jpg
/relay/images/steam/games/{appid}/background.jpg
/relay/images/steam/games/{appid}/logo.png
```

These are **relative URLs** designed to be used in the browser. They resolve through the gaming
journal's `/relay/[...path]` proxy route (`src/routes/relay/[...path]/+server.ts`), which forwards
requests to the relay server over a persistent connection pool. The relay server then serves the
files from the NAS via Express static middleware:

```
DATA_DIR/relay/steam/images/games/{appid}/{type}
```

Images are downloaded from the Steam CDN by `syncGameImages()` in
`relay-server/src/services/steam/images.service.js`. This sync reads `games.json` (library) and
`wishlist.json` (wishlist-only games) and downloads all six image types for every game. It tries
multiple CDN URLs per type (`cdn.akamai.steamstatic.com` and `shared.akamai.steamstatic.com`) and
records which URL succeeded in `sources.json` to skip re-downloads.

**The relay server does NOT embed these `/relay/images/...` paths in the game objects until the
relay itself is called through the gaming journal proxy.** The paths are constructed once in
`games.service.js` and are always local-relay-relative.

### Discovered games

Games with `source = 'discovered'` (games appearing in the Discover section that are not owned or
wishlisted) use `mediaUrlsDiscovered()` instead:

```js
{
  header:  store?.header_image ?? `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`,
  capsule: store?.capsule_image ?? null,
  poster:  null,         // no local poster for discovered games
  hero:    null,
  background: store?.background_raw ?? store?.background ?? null,
  logo:    null,
}
```

All image URLs here are **raw Steam CDN URLs** — there is no local cache for discovered games.

The `/api/discover/featured` endpoint returns featured Steam store items with:
- `headerImage` — CDN URL (`cdn.akamai.steamstatic.com` or `shared.akamai.steamstatic.com`)
- `posterImage` — CDN URL (`shared.akamai.steamstatic.com/store_item_assets/steam/apps/{appid}/library_600x900_2x.jpg`)

Neither has a local cached copy.

---

## NAS image coverage

Scanned `\\192.168.86.74\app-data\relay\steam\images\games` on 2026-06-18.

| Image type   | Folders present | Coverage |
|--------------|-----------------|----------|
| header.jpg   | 2,985 / 2,989   | 99.9%    |
| capsule.jpg  | 2,985 / 2,989   | 99.9%    |
| background   | 2,979 / 2,989   | 99.7%    |
| hero.jpg     | 2,719 / 2,989   | 91.0%    |
| **poster.jpg** | **2,680 / 2,989** | **89.7%** |
| logo.png     | 2,653 / 2,989   | 88.8%    |

**Total folders: 2,989** — these represent library + wishlist games that have been through
`syncGameImages`. Wishlist-only games added after the last sync run will not have a folder yet.

`header.jpg` and `capsule.jpg` are by far the most reliable fallbacks at 99.9%. `poster.jpg` is
missing for ~309 games, which directly causes blank mosaic tiles.

---

## How the mosaic gets its images

### Library and wishlist mosaics

The gaming journal's `+page.server.ts` calls the relay at startup (SSR):

```
GET /api/games/posters?source=library&n=50
GET /api/games/posters?source=wishlist&n=50
```

This hits `handleGetPosters` in
`relay-server/src/controllers/games/games.controller.js`. It reads from the in-memory games cache
(no disk I/O), filters by source, Fisher-Yates shuffles, and returns the first 50 as:

```json
[{ "appid": 12345, "header": "/relay/images/steam/games/12345/poster.jpg" }]
```

**Current bug**: the `header` field always contains the `poster.jpg` path (which is missing for
~10% of games). There is no server-side fallback. When `poster.jpg` 404s, the client `onerror`
handler just hides the image — it does not try `header.jpg`.

**Fix needed**: `handleGetPosters` should return both `poster` and `header` (or `capsule`) so the
component can try poster first and fall back to header on error. Alternatively, return `appid` and
let the component construct fallback URLs itself.

### Discover mosaic

`+page.server.ts` calls:

```
GET /api/discover/featured
```

The response contains featured Steam store items. `sampleDiscover()` currently extracts
`posterImage` (CDN URL) as the image source, falling back to `headerImage` (also CDN URL).

**Current bug**: both URLs are raw Steam CDN URLs (`shared.akamai.steamstatic.com`). The browser
blocks these with `OpaqueResponseBlocking` (CORS). No images load for the Discover mosaic.

**Fix needed**: for each discover item, construct a local relay path
`/relay/images/steam/games/{appid}/poster.jpg` instead of using the CDN URL. Discover games that
happen to be in the user's library or wishlist (and are therefore cached on the NAS) will load
correctly. Discover-only games that are not cached will produce blank tiles — this is acceptable
and silent (no CORS errors, `onerror` hides).

The proper long-term solution is an on-demand image proxy in the relay: when a game image is
requested and not found locally, fetch it from CDN, cache it, and serve it. This would give 100%
coverage for discover games after first load.

---

## Known issues summary

| # | Issue | Affected mosaic | Root cause | Fix |
|---|-------|----------------|------------|-----|
| 1 | ~10% of tiles blank | Library, Wishlist | `poster.jpg` missing for ~309 games; no client fallback | Return both `poster` + `header` from endpoint; use `onerror` fallback chain |
| 2 | All tiles blank (CORS) | Discover | `sampleDiscover` returns raw CDN URLs | Construct local relay path from `appid` instead |
| 3 | Wishlist fully blank at times | Wishlist | Wishlist-only games added after last `syncGameImages` run have no NAS folder | Re-run `POST /api/steam/images/games/sync`; or run on-demand per game |
| 4 | Duplicate tiles at animation start | All | First tick fires before available pool is larger than 6 slots | Guard: only start interval if `posters.length > 12` |

---

## Data flow diagram

```
Browser
  │
  ├─ <img src="/relay/images/steam/games/{appid}/poster.jpg">
  │       │
  │       ▼
  │   Gaming Journal (SvelteKit)
  │   /relay/[...path] proxy
  │       │
  │       ▼
  │   Relay Server (Express)
  │   app.use('/images/steam', express.static(imagesRoot))
  │       │
  │       ▼
  │   NAS: \\192.168.86.74\app-data\relay\steam\images\games\{appid}\poster.jpg
  │
  └─ <img src="https://shared.akamai.steamstatic.com/..."> ← BROKEN (CORS)
```

---

## Files involved

| File | Role |
|------|------|
| `gaming-journal/src/routes/+page.server.ts` | Fetches 50 posters per category at SSR time |
| `gaming-journal/src/lib/svelte/home/Home.svelte` | Renders home layout, passes posters to HomeMosaic |
| `gaming-journal/src/lib/svelte/home/HomeMosaic.svelte` | 3×2 grid with CSS animation flip; `onerror` hides broken images |
| `gaming-journal/src/routes/relay/[...path]/+server.ts` | Proxy: gaming journal → relay server |
| `gaming-journal/public/css/home.css` | Mosaic grid layout and flip keyframe animations |
| `relay-server/src/controllers/games/games.controller.js` | `handleGetPosters` — returns 50 shuffled poster URLs |
| `relay-server/src/routers/games/games.router.js` | Registers `GET /api/games/posters` |
| `relay-server/src/services/games/games.service.js` | `mediaUrls()` / `mediaUrlsDiscovered()` — constructs image paths |
| `relay-server/src/services/steam/images.service.js` | `syncGameImages()` — downloads images from CDN to NAS |
| `relay-server/src/services/home/home.service.js` | Builds mosaic tile sets for `GET /api/home` (6 tiles, used for resume/release; NOT for animation pool) |
| `relay-server/src/server.js` | Mounts `/images/steam` as static file server from NAS |

---

## Pending work

- [ ] Fix `handleGetPosters` to return a fallback image URL alongside the poster URL
- [ ] Fix `HomeMosaic.svelte` `onerror` to try header/capsule before hiding
- [ ] Fix `sampleDiscover` to use local relay paths instead of CDN URLs
- [ ] (Long-term) Add on-demand image proxy to relay for discovered games
- [ ] Investigate if wishlist-only games consistently have a lower NAS coverage rate than library games
