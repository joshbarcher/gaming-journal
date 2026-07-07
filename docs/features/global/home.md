# Home Page

The landing page at `/`. The top row is a **fixed three-slot grid** that is always full (no reflow) — **Sale** (left), a priority-resolved **Middle** card, and **Session** (right) — above three mosaic panels for quick navigation to Library, Wishlist, and Discover.

## The three top cards

Each slot always renders something, so the row never collapses to fewer than three columns.

### Left — Sale (three-tier fallback)

Resolved in `resolveSale()` (`+page.server.ts`) from candidate lists the **relay precomputes** (`sale.onSale` / `sale.watching` / `sale.wishlist`):
1. **On Sale** — a random sales-watch (alert-flagged) game currently discounted → `On Sale −X%`.
2. **Waiting for Sale** — else a random sales-watch game not yet discounted.
3. **On Your Wishlist** — else (nothing on the sales watch) a random wishlist title.

All tiers are filtered through `shouldShow` and picked synchronously (no `getAlerts()` round-trips, no streaming — the candidates arrive in the cached `/api/home` payload).

### Middle — priority resolver (first match wins)

Resolved in `resolveMiddle()`:
1. **Released Today** — a wishlisted game released today (`relay.release`).
2. **Just Bought** — a random library game acquired in the last 7 days (`relay.justBought`, `shouldShow`-filtered).
3. **Guide** — if the game you're playing has a downloaded guide (relay attaches `guide` to each recent-played entry). A distinct card: **source icon + label**, the **guide title in the gold shimmer** (same treatment as the guide index page, `gl-title-shimmer`), and a **guide screenshot** filling the lower band (from the guide's `coverImages`; GameFAQs text guides have none and fall back to the game header). Links straight to the guide viewer.
4. **Activity Stats** — the evergreen floor, so the slot is never empty. A rolling-30-day stat card: big hours number + `unlocked / rated / added / wishlisted`.

### Right — Session (last played, filter-aware)

The most-recently-played title that **passes the filter toggles**. The relay returns `recentPlayed[]` (ranked most-recent-first, up to 10) and the client picks the first `shouldShow`-allowed entry, so a child-locked / filtered last game never leaks onto the home page. Shows playtime + achievement progress (`unlocked/total 🏆`) + "last played".

## Legacy

Earlier versions used a variable-width `repeat(N, 1fr)` row of up to three *conditional* cards (Released Today / On Sale / Resume) that reflowed as the streamed sale card resolved. That reflow is gone — the grid is now fixed at three columns.

## Server-side data loading

The home page uses a SvelteKit **page server** (`+page.server.ts`). Because the relay precomputes the whole card payload (see below), `load()` is **thin** — it does no per-request file reads, guide lookups, or alerts round-trips. It just fetches, filters with `shouldShow`, and picks.

Parallel fetches on the server:
1. `GET {relay}/api/home` → the **precomputed** payload (recentPlayed+guide, justBought, stats, sale candidates, release)
2. `GET {relay}/api/games/posters?source=library&n=50` → 50 library poster images (for the 12+ tile mosaic)
3. `GET {relay}/api/games/posters?source=wishlist&n=50` → 50 wishlist poster images
4. `GET {relay}/api/discover/featured` → featured discover sections (Discover mosaic)
5. `getAllFlags()` — all game flags (filtering hidden/child-locked/filtered games)
6. `getSettings()` — user settings (showChildLocked, showFiltered, titleBlocklist, …)

`makeShouldShow(flags, settings)` builds a predicate that excludes software (`flag.software`), child-locked (if `showChildLocked === false`), and filtered (if `showFiltered === false`) games. All candidate/poster lists are filtered through it; Discover also filters against `titleBlocklist`.

`session`, `middle`, and `sale` are all resolved **synchronously** from the fetched payload — nothing is streamed.

### Relay data (`GET {relay}/api/home`) — precomputed + cached

`home.service.js` builds the full payload in `buildPayload()` and caches it in memory for `PAYLOAD_TTL_MS` (60 s), so the landing page never waits on the filesystem/ITAD reads that assemble it. The payload contains:
- `recentPlayed[]` — ranked most-recent-first (up to 10), each with `hours`, `daysAgo`, `achievements: { unlocked, total } | null`, and (top 6) an attached `guide` (`{ source, guideId, title, screenshot, screenshots, sourceUrl, pageCount } | null`) resolved by `guide-card.service.js`. Drives the filter-aware session card **and** the middle guide tier.
- `justBought[]` — library games whose `firstSeen` is within 7 days. `firstSeen` is stamped in `provisionNewGames()` (Steam owns no purchase date) and written to `relay/steam/library-firstseen.json`. Days on which more than 10 games were first seen are treated as a **library import** and excluded, so a fresh install / re-sync doesn't flag everything.
- `stats` — rolling-30-day totals: `hours`, `achievements`, `added`, `wishlisted`, and `ratings` (read from the shared `gaming-journal/local-reviews.json`).
- `sale` — `{ onSale, watching, wishlist }` candidate lists computed from the local ITAD + flags caches (no HTTP), feeding the three sale tiers.
- `release` — a wishlisted game released today.
- `resume` — kept for backward compatibility; the client uses `recentPlayed` instead.

## Home component (`Home.svelte`)

### Top cards row

A fixed `grid-template-columns: 1fr 1fr 1fr` row: Sale (`{#await data.saleGame}`, with a shimmer `.home-card--pending` placeholder while it streams), the resolved `middle` card, and the `session` card (or a pending placeholder if there's no unfiltered play history). See "The three top cards" above for the resolution logic.

### Mosaic row

Three panels side-by-side, each containing a `HomeMosaic` + a navigation link label:

| Panel | Link | Poster source | Cols |
|-------|------|---------------|------|
| View Library | `/library` | `libPosters` | 3×2 grid |
| View Wishlist | `/wishlist` | `wlPosters` | 3×2 grid |
| Discover Games | `/discover` | `discPosters` | 2×3 grid |

## HomeMosaic

An animated 6-cell CSS-flip mosaic (3×2 or 2×3 grid). Requires at least 12 posters to start.

### How it works

1. All posters are shuffled; first 6 go to `slots`, rest to `available`
2. Every 8 seconds (`INTERVAL`): picks 6 new posters from `available` (excluding current front images to prevent visible duplicates)
3. Each tile gets a random stagger delay (0–450ms) and a random flip axis (X or Y) — creates a "breeze over water" effect
4. `onAnimationEnd` fires per-tile: promotes `back` to `front`, returns old `front` to `available`
5. Next batch of posters is preloaded 2 seconds into the current flip animation (`PRELOAD_AT`)

Each tile links to `/game/{appid}`.

## Key files

| File | Role |
|------|------|
| `src/routes/+page.server.ts` | Thin `load()`: fetch payload, `shouldShow`-filter, `resolveSale()` / `resolveMiddle()` / session pick |
| `src/lib/svelte/home/Home.svelte` | Fixed 3-up top row (sale / middle / session) + mosaic row |
| `src/lib/svelte/home/HomeMosaic.svelte` | Animated flip mosaic component |
| `public/css/home.css` | Card, chip, guide-card, stats-card, and pending-placeholder styles |
| `relay-server/src/services/home/home.service.js` | `buildPayload()` (cached): recentPlayed+guide, justBought, stats, sale, release |
| `relay-server/src/services/home/guide-card.service.js` | Best-guide-per-appid resolver (title from `_search.json`, screenshot from `_meta.json` coverImages) |
| `relay-server/src/services/provision.service.js` | `firstSeen` stamping + `getLibraryFirstSeen()` for "Just Bought" |

## Common questions

**Q: The Session card shows the wrong game.**
It comes from `recentPlayed` in `GET /relay/api/home` (relay session data). If the relay's session cache is stale, the wrong game may show. The client picks the most-recent entry that passes the filter toggles, so a hidden game is skipped rather than shown.

**Q: The sale card shows "Waiting for Sale" / a wishlist game instead of a discount.**
That's the three-tier fallback working: nothing on the sales watch is currently discounted (tier 2), or nothing is on the sales watch at all (tier 3). If the relay/ITAD is down, deals resolve empty and everything falls to tier 2/3.

**Q: The "Just Bought" card never appears.**
It needs a library game with a `firstSeen` stamp inside 7 days. `firstSeen` is only recorded going forward (in `provisionNewGames`), so games owned before this feature shipped won't have one — buy something new and it appears. Big same-day batches are excluded as library imports.

**Q: The stats card shows zeros.**
`hours`/`achievements`/`added`/`wishlisted` come from the relay; if it's down they read 0. `rated` is app-side (local reviews) and still shows. Otherwise the window is genuinely empty (no activity in 30 days).

**Q: The "Released Today" card shows a game I already own.**
Release detection only checks if a wishlisted/discovered game has a `releaseDateIso` matching today's date. It doesn't check library ownership — a game can appear even if you already bought it.

**Q: The mosaic shows broken images.**
Posters are relay-proxied images (`/relay/images/...`). If the relay isn't running or the game doesn't have a poster, the image breaks. Missing posters don't stop the mosaic — they just show a broken slot.

## Gotchas

- **The `/api/home` payload is cached on the relay for 60 s** (`PAYLOAD_TTL_MS`). This is what keeps the landing page fast — the guide-meta / ITAD / local-reviews reads that assemble it happen at most once a minute, not per request. Consequences: a just-opened session's live playtime and a brand-new guide/purchase can lag up to ~60 s on the home page. The old design did those reads per request (via `getAlerts()` + `getAllLocalReviews()` + a `/api/guides` fetch) and was noticeably slow; that work now lives behind this cache.
- **Nothing is streamed anymore** — `session`, `middle`, and `sale` all resolve synchronously server-side. The sale slot only shows a `.home-card--pending` placeholder if the relay is unreachable (empty payload). Because the grid is fixed at three columns, the layout never reflows.
- **Guide screenshots come from `coverImages`** — HTML-source guides (IGN, Fandom, Game8, GamerGuides, Neoseeker, Steam) have them; GameFAQs text FAQs don't, so those guide cards fall back to the game header (`.home-guide-shot--fallback`). Images are served as `.webp` at `/relay/guides-img/{appid}/{source}/{guideId}/{section}/img/{NNN}.webp`.
- **`firstSeen` is forward-looking** — it's stamped the first time `provisionNewGames` sees a new owned appid. Pre-existing library games have no stamp, so "Just Bought" and the `added` stat only reflect acquisitions after this feature deployed. A fresh `DATA_DIR` stamps everything on the first sync, which the >10-per-day import guard filters out.
- **`makeShouldShow` runs server-side** — the shouldShow function and flag/settings data are evaluated at server render time, not in the browser. This means the poster/recentPlayed lists are already filtered before they reach the browser. Changes to flags/settings don't update the home page until the next navigation (no live reactivity).
- **Discover posters use `sampleDiscover()`** — it shuffles the full featured list and samples 50 that pass shouldShow + titleBlocklist. Running the same route twice may give different poster images for the Discover mosaic.
- **Mosaic requires 12+ posters** — if either the library or wishlist has fewer than 12 games (after shouldShow filtering), that mosaic panel doesn't animate. It stays static with whatever initial slots are populated.
