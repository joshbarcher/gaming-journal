# Wishlist

Local wishlist page at `/wishlist`. Separate from Steam's wishlist — games are added/removed via the app and enriched with ITAD pricing data.

**Key distinction**: the local wishlist (`/api/local-wishlist`) is entirely independent of the user's Steam wishlist. Adding a game here does not add it to Steam, and vice versa.

## Data source

- `GET /api/local-wishlist` — all locally wishlisted games (returns `SteamGame[]` with wishlist metadata attached)
- Each game record includes `wishlist.priority`, `wishlist.dateAdded`, and `itad.bestPrice` (price/cut from ITAD)

## Sort options

| Option | Field sorted on |
|--------|----------------|
| Priority | `wishlist.priority` (lower number = higher priority) |
| Price | `itad.bestPrice.price` |
| Discount | `itad.bestPrice.cut` |
| Date Added | `wishlist.dateAdded` |
| Release Date | `store.releaseDateIso` |

Default sort: Priority ascending. Sort + direction stored in plain `localStorage` (`gj_wl_sort`, `gj_wl_dir`). Page, scroll, and letter filter use `setWithTTL`.

## Controls

Same A-Z letter filter and text search (200ms debounce) as the library page.

**Hide Unavailable** toggle (`hideUnavailable`) — filters out games where `store.unavailable === true` (delisted/removed from Steam store). This is a session-only toggle; not persisted.

## Setting priority

Priority is set on the game page via the wishlist panel. Lower numbers = higher priority. Games without an explicit priority sort last (default `9999`).

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/wishlist/WishlistPage.svelte` | Wishlist component |
| `src/routes/wishlist/+page.svelte` | Route shell |
| `src/routes/api/local-wishlist/[appid]/+server.ts` | Add/remove wishlist entries |

## Common questions

**Q: How do I add a game to the wishlist?**
From the game page via the wishlist toggle in the FlagsBar or wishlist panel — not from the wishlist page itself. The wishlist page is read-only (display + sort/filter only).

**Q: A game I wishlisted shows "unavailable." What does that mean?**
`store.unavailable === true` means the game was removed from the Steam store (delisted, taken down, regional restriction resolved, etc.). The game stays in your local wishlist. Toggle "Hide Unavailable" to filter these out.

**Q: Prices aren't showing for some games.**
ITAD data is fetched per-game by the relay and may not be available for all titles. ITAD doesn't index every game on Steam. If a game has no ITAD entry, `itad.bestPrice` will be null and the price columns show "—".

## Gotchas

- **`hideUnavailable` set in two places**: the Settings page has a "Hide Unavailable Games" toggle (ON = hide, stored directly as `hideUnavailable = checked`), while the wishlist page has a "Hide Unavailable" button that sets `hideUnavailable = true`. The Settings value persists; the wishlist button is session-only.
- **Sort by Release Date**: coming-soon games with no known date sort as `9999-99-99` (last when ascending, first when descending). Games with `store.comingSoon = true` but no ISO date also sort as `9999-99-99`.
