# Home Page

The landing page at `/`. The top row is a **fixed three-slot grid** that is always full (no reflow) — **Sale** (left), a priority-resolved **Middle** card, and **Session** (right) — above three mosaic panels for quick navigation to Library, Wishlist, and Discover.

## The three top cards

Each slot always renders something, so the row never collapses to fewer than three columns.

### Left — Sale (streamed, three-tier fallback)

Resolved in `resolveSale()` (`+page.server.ts`), streamed as a Promise so it doesn't block first paint:
1. **On Sale** — a random sales-watch (alert-flagged) game currently discounted → `On Sale −X%`.
2. **Waiting for Sale** — else a random sales-watch game not yet discounted.
3. **On Your Wishlist** — else (nothing on the sales watch) a random wishlist title; its name is fetched from `GET {relay}/api/games/{appid}`.

Sources come from `getAlerts()` which already returns `{ onSale, watching }`; tier 3 uses the wishlist poster list. All tiers are filtered through `shouldShow`.

### Middle — priority resolver (first match wins)

Resolved in `resolveMiddle()`:
1. **Released Today** — a wishlisted game released today (`relay.release`).
2. **Just Bought** — a random library game acquired in the last 7 days (`relay.justBought`, `shouldShow`-filtered).
3. **Guide** — if the session game has a downloaded guide (`GET {relay}/api/guides/{appid}` is non-empty), the most-recently-used one; links straight to the guide viewer. Fetched only when tiers 1–2 miss.
4. **Activity Stats** — the evergreen floor, so the slot is never empty. A rolling-30-day stat card: big hours number + `unlocked / rated / added / wishlisted`.

### Right — Session (last played, filter-aware)

The most-recently-played title that **passes the filter toggles**. The relay returns `recentPlayed[]` (ranked most-recent-first, up to 10) and the client picks the first `shouldShow`-allowed entry, so a child-locked / filtered last game never leaks onto the home page. Shows playtime + achievement progress (`unlocked/total 🏆`) + "last played".

## Legacy

Earlier versions used a variable-width `repeat(N, 1fr)` row of up to three *conditional* cards (Released Today / On Sale / Resume) that reflowed as the streamed sale card resolved. That reflow is gone — the grid is now fixed at three columns.

## Server-side data loading

The home page uses a SvelteKit **page server** (`+page.server.ts`) to load data before render:

6 parallel fetches on the server:
1. `GET {relay}/api/home` → `HomeData`: `resume` (last played game) + `release` (wishlist game released today) + poster lists
2. `GET {relay}/api/games/posters?source=library&n=50` → 50 library game poster images
3. `GET {relay}/api/games/posters?source=wishlist&n=50` → 50 wishlist poster images
4. `GET {relay}/api/discover/featured` → featured discover sections (for Discover mosaic)
5. `getAllFlags()` — all game flags (for filtering hidden/child-locked/filtered games)
6. `getSettings()` — user settings (showChildLocked, showFiltered, titleBlocklist, etc.)

After loading, `makeShouldShow(flags, settings)` builds a predicate that excludes:
- Software games (`flag.software`)
- Child-locked games (if `settings.showChildLocked === false`)
- Filtered games (if `settings.showFiltered === false`)

All poster lists are filtered through `shouldShow`. Discover posters also filter against `settings.titleBlocklist`.

`saleGame` is returned as a **Promise** (not awaited server-side) so it can be streamed to the client while the rest of the page renders (see `resolveSale()` tiers above). `session` and `middle` are resolved server-side before render; the middle **guide** tier issues an extra `GET /api/guides/{appid}` only when the release and just-bought tiers both miss. Recent-30-day **ratings** for the stats card are counted app-side from `getAllLocalReviews()` (local reviews live in the app, not the relay).

### Relay data (`GET {relay}/api/home`)

`home.service.js` returns, in addition to `release`/`libPosters`/`wlPosters`:
- `recentPlayed[]` — ranked most-recent-first (up to 10), each with `hours`, `daysAgo`, and `achievements: { unlocked, total } | null`. Drives the filter-aware session card.
- `justBought[]` — library games whose `firstSeen` is within 7 days. `firstSeen` is stamped in `provisionNewGames()` (Steam owns no purchase date) and written to `relay/steam/library-firstseen.json`. Days on which more than 10 games were first seen are treated as a **library import** and excluded, so a fresh install / re-sync doesn't flag everything.
- `stats` — rolling-30-day totals: `hours` (summed session minutes), `achievements` (unlocks whose `unlocktime` is in-window), `added` (library `firstSeen` in-window, import batches excluded), `wishlisted` (wishlist `dateAdded` in-window). Ratings are added app-side.
- `resume` — kept for backward compatibility; the client now uses `recentPlayed` instead.

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
| `src/routes/+page.server.ts` | Server data loading + `resolveSale()` / `resolveMiddle()` / session backfill |
| `src/lib/svelte/home/Home.svelte` | Fixed 3-up top row (sale / middle / session) + mosaic row |
| `src/lib/svelte/home/HomeMosaic.svelte` | Animated flip mosaic component |
| `public/css/home.css` | Card, chip, stats-card, and pending-placeholder styles |
| `relay-server/src/services/home/home.service.js` | `GET /api/home`: recentPlayed, justBought, stats, release |
| `relay-server/src/services/provision.service.js` | `firstSeen` stamping + `getLibraryFirstSeen()` for "Just Bought" |
| `relay-server/src/controllers/alerts/alerts.controller.js` | Sales-watch alerts feeding the sale card tiers |

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

- **`saleGame` is a streamed Promise** — the sale slot shows a shimmer `.home-card--pending` placeholder until it resolves. Because the grid is fixed at three columns, the placeholder holds the slot and the layout does **not** reflow (unlike the old variable-width row).
- **`firstSeen` is forward-looking** — it's stamped the first time `provisionNewGames` sees a new owned appid. Pre-existing library games have no stamp, so "Just Bought" and the `added` stat only reflect acquisitions after this feature deployed. A fresh `DATA_DIR` stamps everything on the first sync, which the >10-per-day import guard filters out.
- **`makeShouldShow` runs server-side** — the shouldShow function and flag/settings data are evaluated at server render time, not in the browser. This means the poster/recentPlayed lists are already filtered before they reach the browser. Changes to flags/settings don't update the home page until the next navigation (no live reactivity).
- **Discover posters use `sampleDiscover()`** — it shuffles the full featured list and samples 50 that pass shouldShow + titleBlocklist. Running the same route twice may give different poster images for the Discover mosaic.
- **Mosaic requires 12+ posters** — if either the library or wishlist has fewer than 12 games (after shouldShow filtering), that mosaic panel doesn't animate. It stays static with whatever initial slots are populated.
