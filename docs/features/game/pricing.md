# Game Pricing

Two pricing data sources appear on the game page: **ITAD** (IsThereAnyDeal — historical price data and deals) and **GDP** (current store prices, shown in GameHero). Both load in Phase 2 (background).

## ITAD (IsThereAnyDeal)

Historical lowest prices and current deals across storefronts.

### Data flow
1. Phase 2 background fetch: `GET /relay/api/itad/{appid}` (cached) or `GET /relay/api/itad/{appid}?fetch=true&name={name}` for discovered/wishlist games
2. Data stored in relay cache, refreshed on demand
3. `ItadPrices` section renders when `effectiveItad !== undefined`
4. Manual refresh: `refreshItad()` → `POST /relay/api/itad/sync/{appid}?force=true` then re-reads

### What's shown
- All-time lowest price per store
- Current price and cut per store
- "Best current deal" highlight

### Key files

| File | Role |
|------|------|
| `src/lib/svelte/game/sections/ItadPrices.svelte` | ITAD price display, refresh button |
| `relay-server/src/services/itad/itad.service.js` | ITAD API integration + cache |
| `relay-server/src/controllers/itad/itad.controller.js` | `/api/itad/{appid}` endpoints |

## GDP (GameDealsPro / current store prices)

Current price shown in the GameHero alongside the score chips. Compact display.

### Key files

| File | Role |
|------|------|
| `src/lib/svelte/game/sections/GdpPrices.svelte` | Current price chip in GameHero |

## State transitions

Both ITAD and GDP follow the Phase 2 `undefined` / `null` / object pattern:
- `undefined` → still loading → show spinner placeholder
- `null` → fetched, no data (game not found in ITAD, or unavailable) → section hidden
- `{}` (empty object) → fetched successfully but no deals found → section shown with "No deals" state
- object with data → section shown with price data

`effectiveItad` in `GamePage` prefers the Phase 2 background result but falls back to `game.itad` (Phase 1 cache) if Phase 2 isn't needed.

## Common questions

**Q: ITAD shows no data for a game I know is on sale.**
ITAD data is cached on the relay. Click the refresh icon in the Prices section to force a sync with the ITAD API. If still empty, the game may not be indexed by ITAD (common for smaller titles).

**Q: The prices section shows a spinner indefinitely.**
Phase 2 ITAD fetch failed silently. Check relay logs for `/relay/api/itad/{appid}`. On failure the state is set to `{}` (not `null`), so the section appears but may show an empty state.

**Q: Is ITAD shown for all games?**
Yes — `hasItad = true` unconditionally in Phase 2. Unlike HLTB and PCGW which are skipped for coming-soon games, ITAD always loads.

## Gotchas

- **`itadNeeded` is always true** — the ITAD spinner always shows while Phase 2 is loading, regardless of game status. Don't be surprised by the spinner appearing for every game page load.
- **Discovered games use `?fetch=true`** — if a game has `source === 'discovered'` (not from Steam library), Phase 2 fetches ITAD by name rather than assuming a cached entry exists.
- **`effectiveItad` vs `game.itad`**: Phase 1 game data may already include an `itad` cache field. `effectiveItad` returns the Phase 2 fresh result when available, otherwise falls back to this Phase 1 cache. The spinner only shows if `itadNeeded && !game?.itad`.
