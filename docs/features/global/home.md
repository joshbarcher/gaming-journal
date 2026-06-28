# Home Page

The landing page at `/`. Surfaces contextually useful information: a "resume" card for the most recently played game, a release notification for wishlisted games released today, an alert for on-sale wishlist games, and three mosaic panels for quick navigation to Library, Wishlist, and Discover.

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

`saleGame` is returned as a **Promise** (not awaited server-side) so it can be streamed to the client while the rest of the page renders. It resolves to a random on-sale wishlist game from `getAlerts()`.

## Home component (`Home.svelte`)

### Conditional cards row

A top row with up to 3 cards (shown only if at least one is present):
- **Released Today** — a wishlisted game that released today (`data.release`)
- **On Sale** (streamed) — a random game from the on-sale alerts list (`data.saleGame`, wrapped in `{#await}`)
- **Resume** — the most recently played game (`data.resume`); shows hours played and "X days ago" or "Today"/"Yesterday"

The row uses `grid-template-columns: repeat(N, 1fr)` where N = number of present cards. The Resume and Release cards appear immediately; the Sale card appears after the `saleGame` Promise resolves (the layout reflows at that point).

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
| `src/routes/+page.server.ts` | Server data loading: resume, release, posters, saleGame |
| `src/lib/svelte/home/Home.svelte` | Home layout: conditional cards row + mosaic row |
| `src/lib/svelte/home/HomeMosaic.svelte` | Animated flip mosaic component |
| `relay-server/src/controllers/home/home.controller.js` | `GET /api/home` (resume + release) |
| `relay-server/src/controllers/alerts/alerts.controller.js` | On-sale alerts for saleGame |

## Common questions

**Q: The "Resume" card shows the wrong game.**
`resume` comes from `GET /relay/api/home` which reads the most recently played game from the relay's session data. If the relay's session cache is stale, the wrong game may show. The relay's session data updates when Steam polling detects a session.

**Q: The "On Sale" card never appears.**
It's streamed — the `{#await data.saleGame}` block initially renders without it. If `getAlerts()` returns no on-sale games (no wishlisted games on sale), `saleGame` resolves to `null` and the card is omitted. Check the alerts service on the relay.

**Q: The "Released Today" card shows a game I already own.**
Release detection only checks if a wishlisted/discovered game has a `releaseDateIso` matching today's date. It doesn't check library ownership — a game can appear here even if you already bought it.

**Q: The mosaic shows broken images.**
Posters are relay-proxied images (`/relay/images/...`). If the relay isn't running or the game doesn't have a poster, the image breaks. Missing posters don't prevent the mosaic from running — they just show a broken image in that slot.

## Gotchas

- **`saleGame` is a streamed Promise** — this means the home page server response includes a deferred chunk. The conditional cards row initially renders with only `release` and `resume`, then reflows when `saleGame` resolves. On slow connections this reflow is visible.
- **`makeShouldShow` runs server-side** — the shouldShow function and flag/settings data are evaluated at server render time, not in the browser. This means the poster lists are already filtered before they reach the browser. Changes to flags/settings don't update the home page until the next navigation (no live reactivity).
- **Discover posters use `sampleDiscover()`** — it shuffles the full featured list and samples 50 that pass shouldShow + titleBlocklist. Running the same route twice may give different poster images for the Discover mosaic.
- **Mosaic requires 12+ posters** — if either the library or wishlist has fewer than 12 games (after shouldShow filtering), that mosaic panel doesn't animate. It stays static with whatever initial slots are populated.
