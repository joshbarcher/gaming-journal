# Library Page

The main Steam library view at `/library`. Shows all Steam games in a paginated grid with text search, alphabetical filtering, and sort controls.

## Data source

- `GET /relay/api/steam/games` — full list of games from the Steam library sync
- `loadGameFilter()` — returns a `shouldShow(appid)` predicate from `src/lib/js/views/game-filter.js`; filters out hidden/excluded games before display

Both are fetched in parallel on `onMount`. The raw `json` response handles multiple envelope shapes (plain array, `json.games`, `json.data`, `json.response.games`).

## Grid layout

48 games per page (`PAGE_SIZE = 48`). Each card:
- Image: `/relay/images/steam/games/{appid}/header.jpg` (relay-cached, lazy loaded)
- Game name
- Playtime formatted as `Xh` / `Xm` / "Not played"
- Entire card is a link to `/game/{appid}`

## Controls

### Sort

Dropdown with 6 options (stored as `${sort}-${dir}`):

| Option | sort | dir |
|--------|------|-----|
| Name A → Z | `name` | `asc` |
| Name Z → A | `name` | `desc` |
| Most Played | `playtime` | `desc` |
| Least Played | `playtime` | `asc` |
| Recently Played | `recent` | `desc` |
| Least Recently | `recent` | `asc` |

### Text search

200ms debounced input. Resets to page 1 and clears scroll position on change.

### Letter filter

Row of buttons: `A-Z` (all), `#` (non-alpha), then `A`–`Z`. Buttons are disabled if no games start with that letter in the current search result set. `letter === null` = show all.

### Pagination

Prev/Next buttons shown when `totalPages > 1`. Duplicated at the top and bottom of the page. "↑ Back to top" button at the bottom row.

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `←` | Previous page |
| `→` | Next page |
| `↓` | Scroll down one viewport |
| `↑` | Scroll up one viewport |

Disabled when focus is in an input/textarea/select.

## State persistence

| State | Storage | Key | TTL? |
|-------|---------|-----|------|
| sort | `localStorage` | `gj_lib_sort` | No |
| dir | `localStorage` | `gj_lib_dir` | No |
| page | `setWithTTL` | `gj_lib_page` | Yes |
| scroll position | `setWithTTL` | `gj_lib_scroll` | Yes |
| query | `setWithTTL` | `gj_lib_query` | Yes |
| letter | `setWithTTL` | `gj_lib_letter` | Yes |

Sort and direction use plain `localStorage` (persist indefinitely); page/scroll/query/letter use `setWithTTL`/`getWithTTL` (expire after the TTL window). Scroll position is saved with a 150ms debounce while scrolling and restored on mount via `requestAnimationFrame`.

## Key files

| File | Role |
|------|------|
| `src/lib/svelte/library/LibraryPage.svelte` | Main library component |
| `src/lib/js/views/game-filter.js` | `loadGameFilter()` — hidden/excluded game predicate |
| `src/routes/library/+page.svelte` | Route shell (mounts LibraryPage) |

## Common questions

**Q: A game in my Steam library doesn't appear in the library grid.**
The game may be filtered by `loadGameFilter()`. This excludes hidden or user-excluded games. Check the game filter settings. Also verify the relay `GET /relay/api/steam/games` response includes the game.

**Q: The library shows the wrong page after navigating back.**
Page and scroll position are restored from `setWithTTL` storage on mount. The TTL may have expired, resetting to page 1. Sort and direction (plain localStorage) always persist.

**Q: The letter filter grays out a letter I know I have games for.**
The `available` set recomputes from the current search query. If the query filters out all games starting with that letter, the letter button disables. Clear the query to see all letters.

**Q: How do games get into the library?**
From Steam via `GET /relay/api/steam/games`. The relay syncs the user's Steam library. There is no in-app way to add games to the Steam library — that's managed on Steam itself.

## Gotchas

- **`loadGameFilter` is async** — the library intentionally waits for both the games list and the filter function before rendering, so there's no flash of hidden games.
- **Playtime is Steam's stored value** — it's the `playtime_forever` field from Steam, which can lag behind an active session. See the [sessions doc](../journal/sessions.md) for live playtime logic.
- **The relay image path `/relay/images/steam/games/{appid}/header.jpg` is proxied locally** — images are served from the relay cache, not directly from Steam CDN.
